import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const tempDir = mkdtempSync(join(tmpdir(), "vaexcore-bot-completion-"));
const smokeDbPath = join(tempDir, "data/vaexcore.sqlite");
const relayConsoleToken = "relay-console-secret";
const relayInstallationId = "relay-installation-1";

process.env.VAEXCORE_CONFIG_DIR = tempDir;
process.env.DATABASE_URL = `file:${smokeDbPath}`;

const fakeRelay = await startFakeRelay();
const { startSetupServer } = await import(
  pathToFileURL(resolve("dist-bundle/setup-server.js")).href
);
const handle = await startSetupServer({ port: 3449 });
const baseUrl = handle.url;

try {
  await runSmoke();
  console.log("bot completion smoke passed");
} finally {
  await handle.stop();
  await fakeRelay.stop();
  rmSync(tempDir, { recursive: true, force: true });
}

async function runSmoke() {
  const appJs = await text("/ui/app.js");
  assert(appJs.includes("Bot Completion"), "Bot Completion card is present");
  assert(appJs.includes("Run dry-run rehearsal"), "rehearsal UI is present");
  assert(
    appJs.includes("Copy bot support bundle"),
    "bot-only support copy action is present",
  );
  assert(
    appJs.includes("Export bot support bundle"),
    "bot-only support export action is present",
  );
  assert(
    appJs.includes("Load action queue"),
    "Discord action queue UI is present",
  );

  const clean = await json("/api/bot/completion");
  assert(clean.ok === true, "bot completion route returns ok");
  assert(
    clean.validation.checklist.length === 10,
    "validation checklist is complete",
  );
  assert(
    clean.sections.some(
      (section) =>
        section.title === "Local pairing" && section.state === "blocked",
    ),
    "bot completion route groups blocked local pairing",
  );
  assertSafePayload(clean);

  const saveResult = await post("/api/config", {
    mode: "live",
    redirectUri: "http://localhost:3434/auth/twitch/callback",
    clientId: "relay-client-id",
    clientSecret: "relay-client-secret",
    broadcasterLogin: "vaexcore",
    botLogin: "vaexcorebot",
    twitchTransportMode: "relay-chatbot",
    relayBaseUrl: `${fakeRelay.url}/`,
    relayInstallationId,
    relayConsoleToken,
  });
  assert(
    saveResult.config.relay.readiness.ready === true,
    "Relay config is saved",
  );

  const callbackRecord = await post("/api/bot/validation-record", {
    key: "twitchCallbackAddedAt",
  });
  assert(
    callbackRecord.validation.records.twitchCallbackAddedAt,
    "callback validation can be recorded",
  );

  const completion = await json("/api/bot/completion");
  assert(
    completion.relayReadinessReport.connected === true,
    "Relay readiness report connects",
  );
  assert(
    completion.checks.some((check) => check.key === "discord-worker-config"),
    "Discord Worker checks are included",
  );
  assert(
    completion.sections.some(
      (section) =>
        section.title === "Twitch credentials" &&
        ["ready", "needs credentials"].includes(section.state),
    ),
    "bot completion route groups Twitch credential work",
  );
  assert(completion.nextActions.length > 0, "completion returns next actions");
  assertSafePayload(completion);

  const rehearsal = await post("/api/bot/rehearsal/run", {});
  assert(
    rehearsal.ok === true && rehearsal.dryRun === true,
    "dry-run rehearsal succeeds",
  );
  assert(
    rehearsal.steps.some((step) => step.key === "discord-commands"),
    "Discord command rehearsal step is included",
  );

  const events = await json("/api/discord/relay/events");
  assert(
    events.events.some((event) => event.commandName === "live"),
    "fake Relay returns announcement actions",
  );

  const bundle = await json("/api/bot/support-bundle");
  assert(bundle.ok === true, "bot support bundle route returns ok");
  assert(
    bundle.queuedDiscordActions.length === 1,
    "support bundle includes queued Discord announcement actions",
  );
  assert(
    bundle.completion.sections.some(
      (section) => section.title === "Support/export",
    ),
    "support bundle includes grouped bot completion sections",
  );
  assertSafePayload(bundle);
}

async function startFakeRelay() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/health") {
      send(response, 200, { ok: true, service: "vaexcore relay smoke" });
      return;
    }

    if (request.headers.authorization !== `Bearer ${relayConsoleToken}`) {
      send(response, 401, { error: "Unauthorized" });
      return;
    }
    if (url.searchParams.get("installationId") !== relayInstallationId) {
      send(response, 404, { error: "Installation missing" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/console/status") {
      send(response, 200, relayStatus());
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/console/readiness-report"
    ) {
      send(response, 200, relayReadinessReport());
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/console/discord/status"
    ) {
      send(response, 200, {
        ok: true,
        readiness: {
          ready: true,
          mode: "relay-discord-interactions",
          interactionUrl: `${stateUrl(server)}/webhooks/discord/interactions`,
          checks: [
            { key: "discord-bot-token", ok: true, detail: "configured" },
            { key: "discord-public-key", ok: true, detail: "configured" },
            { key: "discord-application-id", ok: true, detail: "configured" },
            { key: "discord-guild-id", ok: true, detail: "configured" },
            {
              key: "discord-command-registration",
              ok: false,
              detail: "not registered",
            },
          ],
        },
      });
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/console/discord/events"
    ) {
      send(response, 200, {
        ok: true,
        events: [
          {
            relayEventId: "event-1",
            id: "interaction-1",
            commandName: "live",
            kind: "announcement",
            userId: "user-1",
            username: "moderator",
            guildId: "guild-1",
            channelId: "channel-1",
            options: { title: "Live now" },
            allowed: true,
            receivedAt: "2026-05-13T12:00:00.000Z",
          },
        ],
      });
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/console/discord/suggestions"
    ) {
      send(response, 200, {
        ok: true,
        suggestions: [
          {
            id: "suggestion-1",
            userId: "user-2",
            username: "viewer",
            text: "Play the new map",
            status: "new",
            createdAt: "2026-05-13T12:01:00.000Z",
            updatedAt: "2026-05-13T12:01:00.000Z",
          },
        ],
      });
      return;
    }

    send(response, 404, {
      error: `Unhandled ${request.method} ${url.pathname}`,
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    get url() {
      return stateUrl(server);
    },
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

function relayStatus() {
  return {
    ok: true,
    installation: {
      id: relayInstallationId,
      name: "VaexCore Console",
      botLogin: "vaexcorebot",
      broadcasterLogin: "vaexcore",
    },
    readiness: {
      ready: true,
      mode: "relay-chatbot",
      checks: [
        { key: "bot-grant", ok: true, detail: "Bot grant stored." },
        {
          key: "broadcaster-grant",
          ok: true,
          detail: "Broadcaster grant stored.",
        },
        {
          key: "separate-bot-account",
          ok: true,
          detail: "Bot and broadcaster accounts are separate.",
        },
      ],
    },
  };
}

function relayReadinessReport() {
  const status = relayStatus();
  return {
    ok: true,
    generatedAt: "2026-05-13T12:00:00.000Z",
    installation: status.installation,
    urls: {
      publicBaseUrl: fakeRelay.url,
      twitchCallbackUrl: `${fakeRelay.url}/oauth/twitch/callback`,
      twitchEventSubWebhookUrl: `${fakeRelay.url}/webhooks/twitch/eventsub`,
      discordInteractionUrl: `${fakeRelay.url}/webhooks/discord/interactions`,
    },
    checks: [
      ...status.readiness.checks.map((check) => ({
        ...check,
        state: "ready",
      })),
      {
        key: "latest-eventsub-registration",
        ok: true,
        state: "ready",
        detail: "created",
      },
      {
        key: "latest-outbound-send",
        ok: false,
        state: "todo",
        detail: "not sent",
      },
      {
        key: "discord-bot-token",
        ok: true,
        state: "ready",
        detail: "configured",
      },
      {
        key: "discord-public-key",
        ok: true,
        state: "ready",
        detail: "configured",
      },
      {
        key: "discord-application-id",
        ok: true,
        state: "ready",
        detail: "configured",
      },
      {
        key: "discord-guild-id",
        ok: true,
        state: "ready",
        detail: "configured",
      },
      {
        key: "discord-command-registration",
        ok: false,
        state: "todo",
        detail: "pending",
      },
    ],
    counts: {
      queuedTwitchChatEvents: 0,
      queuedDiscordInteractions: 1,
      suggestions: {
        new: 1,
        reviewed: 0,
        accepted: 0,
        rejected: 0,
        archived: 0,
      },
      outboundSends: {
        queued: 0,
        sent: 0,
        retry: 0,
        failed: 0,
        deadLettered: 0,
      },
    },
    latest: {
      eventSubRegistration: { status: "created" },
      discordCommandRegistration: null,
      outboundSend: null,
    },
  };
}

function stateUrl(server) {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fake Relay server did not bind to a TCP port.");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function text(path) {
  const response = await fetch(`${baseUrl}${path}`);
  assert(response.ok, `${path} returned ${response.status}`);
  return response.text();
}

async function json(path) {
  const response = await fetch(`${baseUrl}${path}`);
  assert(response.ok, `${path} returned ${response.status}`);
  return response.json();
}

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert(response.ok, `${path} returned ${response.status}`);
  return response.json();
}

function send(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function assertSafePayload(payload) {
  const raw = JSON.stringify(payload);
  assert(!raw.includes("relay-console-secret"), "Relay token is not exposed");
  assert(!raw.includes("relay-client-secret"), "client secret is not exposed");
  assert(!raw.includes("Bearer "), "payload does not expose bearer tokens");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Smoke failed: ${message}`);
  }
}
