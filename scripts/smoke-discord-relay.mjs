import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setupUiJavaScriptSource } from "./support/setup-ui-source.mjs";

const tempDir = mkdtempSync(join(tmpdir(), "vaexcore-discord-relay-smoke-"));
const smokeDbPath = join(tempDir, "data/vaexcore.sqlite");
const relayConsoleToken = "smoke-secret-relay-token";
const relayInstallationId = "relay-installation-1";

process.env.VAEXCORE_CONFIG_DIR = tempDir;
process.env.DATABASE_URL = `file:${smokeDbPath}`;

const fakeRelay = await startFakeRelay();
const { startSetupServer } = await import(
  pathToFileURL(resolve("dist-bundle/setup-server.js")).href
);

const handle = await startSetupServer({ port: 3448 });
const baseUrl = handle.url;

try {
  await runSmoke();
  console.log("discord relay smoke passed");
} finally {
  await handle.stop();
  await fakeRelay.stop();
  rmSync(tempDir, { recursive: true, force: true });
}

async function runSmoke() {
  const appJs = await setupUiJavaScriptSource(text);
  assert(appJs.includes("Relay Slash Commands"), "Discord Relay UI exists");
  assert(
    appJs.includes("Relay Slash Commands And Suggestions"),
    "Discord Relay UI distinguishes slash commands and suggestions",
  );
  assert(
    appJs.includes("Advanced Self-Hosted Discord Connection"),
    "Discord UI labels local setup separately",
  );
  assert(
    appJs.includes("Mark Chat Bot identity live-tested"),
    "Twitch Relay live-validation action is visible",
  );

  const cleanDiscord = await json("/api/discord/status");
  assert(
    cleanDiscord.config.relay.configured === false,
    "clean install starts without Discord Relay config",
  );

  const saved = await post("/api/config", {
    mode: "live",
    redirectUri: "http://localhost:3434/auth/twitch/callback",
    twitchTransportMode: "relay-chatbot",
    relayBaseUrl: fakeRelay.url,
    relayInstallationId,
    relayConsoleToken,
  });
  assert(saved.ok === true, "Relay settings save returns ok");
  assert(
    saved.config.relay.hasConsoleToken === true,
    "Relay token is redacted but marked present",
  );
  assert(
    saved.config.relay.chatbotIdentityLiveValidated === false,
    "Chat Bot identity starts unvalidated",
  );
  assert(
    saved.config.relay.identityNotice.includes("not live-tested yet"),
    "Chat Bot identity warning is surfaced from config",
  );
  assertSafePayload(saved);

  const relayStatus = await json("/api/discord/relay/status");
  assert(relayStatus.ok === true, "Discord Relay status returns ok");
  assert(relayStatus.connected === true, "Discord Relay status connects");
  assert(
    relayStatus.readiness.ready === false,
    "Discord Relay readiness reports blocked missing Worker setup",
  );
  assert(
    relayStatus.readiness.checks.some(
      (check) => check.key === "discord-bot-token" && check.ok === false,
    ),
    "Discord Relay readiness surfaces missing Discord bot token",
  );
  assert(
    relayStatus.relay.interactionUrl ===
      `${fakeRelay.url}/webhooks/discord/interactions`,
    "Discord interaction URL is derived from Relay URL",
  );

  const registered = await post("/api/discord/relay/commands/register", {});
  assert(registered.ok === true, "slash command registration returns ok");
  assert(
    registered.commands.includes("suggest"),
    "slash command registration includes suggest",
  );
  assert(
    fakeRelay.registerCount === 1,
    "fake Relay received slash command registration",
  );

  const suggestions = await json("/api/discord/relay/suggestions");
  assert(suggestions.ok === true, "suggestions load returns ok");
  assert(suggestions.suggestions.length === 1, "suggestion queue is visible");
  assert(suggestions.suggestions[0].status === "new", "suggestion starts new");

  const updated = await post("/api/discord/relay/suggestions/status", {
    id: "suggestion-1",
    status: "accepted",
  });
  assert(updated.ok === true, "suggestion status update returns ok");
  const afterUpdate = await json("/api/discord/relay/suggestions");
  assert(
    afterUpdate.suggestions[0].status === "accepted",
    "suggestion status update is reflected",
  );

  const events = await json("/api/discord/relay/events");
  assert(events.ok === true, "Discord Relay events route returns ok");
  assert(
    events.actions.length === 1 && events.actions[0].status === "queued",
    "Discord Relay announcement actions are persisted locally",
  );

  const approved = await post("/api/discord/relay/actions/status", {
    id: "event-live-1",
    status: "approved",
  });
  assert(
    approved.action.status === "approved",
    "Discord Relay action approval is persisted",
  );
  const actionHistory = await json(
    "/api/discord/relay/actions?status=approved",
  );
  assert(
    actionHistory.actions.length === 1 &&
      actionHistory.actions[0].relayEventId === "event-live-1",
    "Discord Relay action history can be filtered by status",
  );

  const validation = await post("/api/relay/chatbot-identity/validation", {
    confirmed: true,
    note: "smoke validation",
  });
  assert(
    validation.relay.chatbotIdentityLiveValidated === true,
    "manual Chat Bot identity validation is recorded",
  );
  assert(
    validation.relay.chatbotIdentityValidatedAt,
    "validation timestamp saved",
  );
  assertSafePayload(validation);
}

async function startFakeRelay() {
  const state = {
    registerCount: 0,
    suggestions: [
      {
        id: "suggestion-1",
        userId: "discord-user-1",
        username: "Viewer",
        text: "Add a boss fight highlight command",
        status: "new",
        createdAt: "2026-05-09T00:00:00.000Z",
        updatedAt: "2026-05-09T00:00:00.000Z",
      },
    ],
  };

  const server = createServer(async (request, response) => {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );

    if (request.headers.authorization !== `Bearer ${relayConsoleToken}`) {
      send(response, 401, { error: "Unauthorized" });
      return;
    }
    if (url.searchParams.get("installationId") !== relayInstallationId) {
      send(response, 404, { error: "Installation missing" });
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/console/discord/status"
    ) {
      const commandsRegistered = state.registerCount > 0;
      send(response, 200, {
        ok: true,
        readiness: {
          ready: false,
          mode: "relay-discord-interactions",
          interactionUrl: `${stateUrl(server)}/webhooks/discord/interactions`,
          checks: [
            {
              key: "installation",
              ok: true,
              detail: "Relay installation exists.",
            },
            {
              key: "discord-bot-token",
              ok: false,
              detail: "Set DISCORD_BOT_TOKEN with wrangler secret put.",
            },
            {
              key: "discord-public-key",
              ok: false,
              detail: "Set DISCORD_PUBLIC_KEY from the Discord application.",
            },
            {
              key: "discord-application-id",
              ok: false,
              detail: "Set DISCORD_APPLICATION_ID.",
            },
            {
              key: "discord-guild-id",
              ok: false,
              detail:
                "Set DISCORD_GUILD_ID for the target server before live validation.",
            },
            {
              key: "discord-interaction-url",
              ok: true,
              detail: `Use ${stateUrl(server)}/webhooks/discord/interactions as the Discord Interactions Endpoint URL.`,
            },
            {
              key: "discord-command-registration",
              ok: commandsRegistered,
              detail: commandsRegistered
                ? "Slash commands are registered."
                : "Register Discord slash commands from Console.",
            },
          ],
        },
      });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/console/discord/commands/register"
    ) {
      state.registerCount += 1;
      send(response, 200, {
        ok: true,
        scope: "guild",
        registeredAt: "2026-05-09T00:00:00.000Z",
        commands: [
          "suggest",
          "live",
          "late",
          "cancelled",
          "scheduled",
          "setup-status",
        ],
      });
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/console/discord/suggestions"
    ) {
      send(response, 200, { ok: true, suggestions: state.suggestions });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/console/discord/suggestions/status"
    ) {
      const body = await readBody(request);
      state.suggestions = state.suggestions.map((suggestion) =>
        suggestion.id === body.id
          ? {
              ...suggestion,
              status: body.status,
              updatedAt: "2026-05-09T00:00:01.000Z",
            }
          : suggestion,
      );
      send(response, 200, {
        ok: true,
        id: body.id,
        status: body.status,
        updatedAt: "2026-05-09T00:00:01.000Z",
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
            relayEventId: "event-live-1",
            id: "interaction-live-1",
            commandName: "live",
            kind: "announcement",
            userId: "discord-user-2",
            username: "Moderator",
            guildId: "guild-1",
            channelId: "channel-1",
            options: { title: "Live now" },
            allowed: true,
            receivedAt: "2026-05-09T00:00:02.000Z",
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
    get registerCount() {
      return state.registerCount;
    },
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

function stateUrl(server) {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fake Relay server did not bind to a TCP port.");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function json(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      `${options.method || "GET"} ${path} failed ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

async function text(path) {
  const response = await fetch(`${baseUrl}${path}`);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${path} failed ${response.status}: ${body}`);
  }
  return body;
}

function post(path, body) {
  return json(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function send(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertSafePayload(value) {
  const text = JSON.stringify(value);
  assert(
    !text.includes(relayConsoleToken),
    "payload must not expose Relay token",
  );
}
