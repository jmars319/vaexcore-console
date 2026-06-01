import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { electronMainSource } from "./support/electron-source.mjs";
import { setupUiJavaScriptSource } from "./support/setup-ui-source.mjs";

const tempDir = mkdtempSync(join(tmpdir(), "vaexcore-relay-smoke-"));
const smokeDbPath = join(tempDir, "data/vaexcore.sqlite");
const relayConsoleToken = "relay-console-secret";
const relayInstallationId = "relay-installation-1";

process.env.VAEXCORE_CONFIG_DIR = tempDir;
process.env.DATABASE_URL = `file:${smokeDbPath}`;

const fakeRelay = await startFakeRelay();
const { startSetupServer } = await import(
  pathToFileURL(resolve("dist-bundle/setup-server.js")).href
);

const handle = await startSetupServer({ port: 3442 });
const baseUrl = handle.url;

try {
  await runSmoke();
  console.log("relay transport smoke passed");
} finally {
  await handle.stop();
  await fakeRelay.stop();
  rmSync(tempDir, { recursive: true, force: true });
}

async function runSmoke() {
  const appJs = await setupUiJavaScriptSource(text);
  const electronMain = electronMainSource();
  assert(
    appJs.includes("Twitch Chat Transport"),
    "Assisted transport UI exists",
  );
  assert(appJs.includes("Setup Mode"), "setup mode selector exists");
  assert(
    appJs.includes("setup-mode-selector"),
    "segmented setup mode UI exists",
  );
  assert(appJs.includes("Hosted"), "Hosted mode is labeled");
  assert(appJs.includes("Assisted"), "Assisted mode is labeled");
  assert(appJs.includes("Local"), "Local mode is labeled");
  assert(
    appJs.includes("Hosted Relay Bot Setup"),
    "hosted Relay setup UI exists",
  );
  assert(
    appJs.includes(
      "This hosted setup path is the one that can make vaexcorebot appear as a Twitch Chat Bot",
    ),
    "Relay-specific setup guide is present",
  );
  assert(
    appJs.includes("Start hosted setup"),
    "Relay setup guide includes the hosted connect step",
  );
  assert(
    appJs.includes("Log in as vaexcorebot"),
    "Relay setup guide labels the bot OAuth account",
  );
  assert(
    appJs.includes("Log in as broadcaster"),
    "Relay setup guide labels the broadcaster OAuth account",
  );
  assert(
    appJs.includes("Register required EventSub"),
    "Relay setup guide makes EventSub registration a required step",
  );
  assert(
    electronMain.includes("hostedTwitchOAuthKind"),
    "desktop app detects hosted Twitch OAuth windows",
  );
  assert(
    electronMain.includes("persist:vaexcore-twitch-${kind}"),
    "desktop app keeps bot and broadcaster Twitch sessions separate",
  );
  assert(
    appJs.includes("Local OAuth Fallback"),
    "local Twitch credentials are behind an advanced panel",
  );
  assert(appJs.includes("Relay Chat Bot"), "Relay Chat Bot mode is labeled");
  assert(
    appJs.includes("Local chat sends appear as the authorized Twitch user"),
    "local fallback identity warning is visible",
  );
  assert(
    appJs.includes("Local sends through direct OAuth chat"),
    "settings UI explains Local transport",
  );
  assert(
    appJs.includes("Relay Chat Bot identity sends through hosted Relay"),
    "settings UI explains Hosted transport",
  );
  assert(
    appJs.includes(
      "Hosted uses Relay-managed Twitch and Discord service credentials.",
    ),
    "Hosted mode tooltip keeps the hosted path discoverable without main-page prose",
  );
  assert(
    appJs.includes("/api/setup-mode"),
    "mode changes use the setup-mode-only API route",
  );

  const clean = await json("/api/config");
  assert(
    clean.setupMode === "relay-assisted",
    "clean install defaults to Hosted mode",
  );
  assert(
    clean.relay.twitchTransportMode === "relay-chatbot",
    "clean install defaults to hosted Relay chatbot transport",
  );
  assert(
    clean.relay.hasConsoleToken === false,
    "clean install starts without Relay console token",
  );
  assert(
    clean.relay.setupUrls.twitchCallbackUrl ===
      "https://relay.vaexil.tv/oauth/twitch/callback",
    "clean install uses the hosted Relay callback URL",
  );
  assertSafePayload(clean);

  await post("/api/config", {
    mode: "live",
    setupMode: "relay-assisted",
    twitchTransportMode: "relay-chatbot",
    relayBaseUrl: `${fakeRelay.url}/`,
    clientId: "local-client-id",
    clientSecret: "local-client-secret",
    broadcasterLogin: "vaexil",
    botLogin: "vaexcorebot",
  });
  await post("/api/discord/config", {
    botToken: "local-discord-token",
    guildId: "1507100366666203217",
    streamAnnouncementChannelId: "1507100366666203218",
    generalAnnouncementChannelId: "1507100366666203219",
    operatorRoleId: "1507100366666203220",
  });

  const hostedStart = await post("/api/relay/hosted/connect", {});
  assert(hostedStart.ok === true, "hosted Relay connect returns ok");
  assert(
    fakeRelay.installStartCount === 1,
    "fake Relay saw hosted install start",
  );
  assertSafePayload(hostedStart);

  const saved = hostedStart.config;

  assert(saved.setupMode === "relay-assisted", "Hosted setup mode is saved");
  assert(
    saved.relay.twitchTransportMode === "relay-chatbot",
    "Relay chatbot mode is saved",
  );
  assert(saved.relay.baseUrl === fakeRelay.url, "Relay URL is normalized");
  assert(
    saved.relay.installationId === relayInstallationId,
    "Relay installation ID is saved",
  );
  assert(
    saved.relay.hasConsoleToken === true,
    "Relay console token is redacted but marked present",
  );
  assert(
    saved.relay.identityNotice.includes("Chat Bot"),
    "Relay identity notice explains Chat Bot mode",
  );
  assert(
    saved.relay.readiness.ready === true,
    "Relay config readiness passes when all fields are present",
  );
  assert(
    saved.relay.setupUrls.twitchCallbackUrl ===
      `${fakeRelay.url}/oauth/twitch/callback`,
    "Relay Twitch callback URL is surfaced",
  );
  assert(
    saved.relay.setupUrls.twitchBotOAuthUrl ===
      `${fakeRelay.url}/oauth/twitch/start?installationId=${relayInstallationId}&kind=bot`,
    "Relay bot OAuth URL is surfaced",
  );
  assert(
    saved.relay.setupUrls.twitchBroadcasterOAuthUrl ===
      `${fakeRelay.url}/oauth/twitch/start?installationId=${relayInstallationId}&kind=broadcaster`,
    "Relay broadcaster OAuth URL is surfaced",
  );
  assert(
    saved.relay.setupUrls.discordInteractionUrl ===
      `${fakeRelay.url}/webhooks/discord/interactions`,
    "Relay Discord interaction URL is surfaced",
  );
  assertSafePayload(saved);

  const localMode = await post("/api/setup-mode", {
    setupMode: "local-only",
  });
  assert(localMode.config.setupMode === "local-only", "Local mode is saved");
  assert(
    localMode.config.relay.twitchTransportMode === "local-user-token",
    "Local mode derives local user-token transport",
  );
  assert(
    localMode.config.relay.installationId === relayInstallationId,
    "Local mode switch preserves hosted Relay installation ID",
  );
  assert(
    localMode.config.relay.hasConsoleToken === true,
    "Local mode switch preserves hosted Relay console token",
  );
  assert(
    localMode.config.hasClientId && localMode.config.hasClientSecret,
    "Local mode switch preserves local Twitch credentials",
  );
  assert(
    localMode.config.broadcasterLogin === "vaexil" &&
      localMode.config.botLogin === "vaexcorebot",
    "Local mode switch preserves Twitch account settings",
  );
  assert(
    localMode.config.discord.guildId === "1507100366666203217" &&
      localMode.config.discord.hasBotToken,
    "Local mode switch preserves local Discord settings",
  );
  assertSafePayload(localMode);

  const assistedMode = await post("/api/setup-mode", {
    setupMode: "advanced",
  });
  assert(
    assistedMode.config.setupMode === "advanced",
    "Assisted mode is saved",
  );
  assert(
    assistedMode.config.relay.twitchTransportMode === "local-user-token",
    "Assisted mode preserves the current transport",
  );
  assertSafePayload(assistedMode);

  const hostedMode = await post("/api/setup-mode", {
    setupMode: "relay-assisted",
  });
  assert(
    hostedMode.config.setupMode === "relay-assisted",
    "Hosted mode is saved again",
  );
  assert(
    hostedMode.config.relay.twitchTransportMode === "relay-chatbot",
    "Hosted mode derives Relay chatbot transport",
  );
  assert(
    hostedMode.config.relay.installationId === relayInstallationId &&
      hostedMode.config.relay.hasConsoleToken,
    "Hosted mode switch keeps Relay pairing state",
  );
  assert(
    hostedMode.config.discord.guildId === "1507100366666203217" &&
      hostedMode.config.discord.hasBotToken,
    "Hosted mode switch preserves local Discord fallback settings",
  );
  assertSafePayload(hostedMode);

  const setupModeCheck = await post("/api/setup-mode/check", {
    mode: "relay-assisted",
  });
  assert(
    setupModeCheck.check.status === "ready",
    "Hosted setup check stores ready status",
  );
  assert(
    setupModeCheck.config.setupChecks.relay.checkedAt,
    "Hosted setup check stores a timestamp",
  );
  assert(
    setupModeCheck.providerSetup.redacted === true,
    "Hosted setup check returns redacted provider metadata",
  );
  assertSafePayload(setupModeCheck);

  const relayStatus = await json("/api/relay/status");
  assert(relayStatus.ok === true, "Relay status route returns ok");
  assert(relayStatus.connected === true, "Relay status route connects");
  assert(
    relayStatus.readiness.ready === true,
    "Relay remote readiness is surfaced",
  );
  assertSafePayload(relayStatus);

  const eventSub = await post("/api/relay/eventsub/register", {});
  assert(eventSub.ok === true, "Relay EventSub registration returns ok");
  assert(
    fakeRelay.eventSubRegisterCount === 1,
    "fake Relay saw EventSub registration",
  );
  assertSafePayload(eventSub);

  const relayTestSend = await post("/api/relay/test-send", {});
  assert(relayTestSend.ok === true, "Relay test-send route sends chat");
  assert(fakeRelay.chatSendCount === 1, "fake Relay saw direct test chat send");
  assertSafePayload(relayTestSend);

  const genericTestSend = await post("/api/test-send", {});
  assert(
    genericTestSend.ok === true,
    "generic test-send uses Relay mode without local OAuth",
  );
  assert(
    fakeRelay.chatSendCount === 2,
    "fake Relay saw generic test chat send",
  );
  assertSafePayload(genericTestSend);
}

async function startFakeRelay() {
  const state = {
    installStartCount: 0,
    eventSubRegisterCount: 0,
    chatSendCount: 0,
  };

  const server = createServer(async (request, response) => {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );

    if (request.method === "GET" && url.pathname === "/health") {
      send(response, 200, {
        ok: true,
        service: "vaexcore relay smoke",
      });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/console/install/start"
    ) {
      state.installStartCount += 1;
      send(response, 200, {
        ok: true,
        installationId: relayInstallationId,
        consoleToken: relayConsoleToken,
        next: {
          twitchCallbackUrl: `${stateUrl(server)}/oauth/twitch/callback`,
          botOAuthUrl: `${stateUrl(server)}/oauth/twitch/start?installationId=${relayInstallationId}&kind=bot`,
          broadcasterOAuthUrl: `${stateUrl(server)}/oauth/twitch/start?installationId=${relayInstallationId}&kind=broadcaster`,
          twitchEventSubWebhookUrl: `${stateUrl(server)}/webhooks/twitch/eventsub`,
          discordInteractionUrl: `${stateUrl(server)}/webhooks/discord/interactions`,
        },
      });
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
      send(response, 200, {
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
      });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/console/eventsub/register"
    ) {
      state.eventSubRegisterCount += 1;
      send(response, 200, {
        ok: true,
        subscription: { id: "eventsub-subscription-1" },
      });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/console/chat/send"
    ) {
      const body = await readBody(request);
      state.chatSendCount += 1;
      send(response, 200, {
        ok: true,
        messageId: body.message ? "relay-message-1" : "missing-message",
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
    get installStartCount() {
      return state.installStartCount;
    },
    get eventSubRegisterCount() {
      return state.eventSubRegisterCount;
    },
    get chatSendCount() {
      return state.chatSendCount;
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

function assertSafePayload(payload) {
  const raw = JSON.stringify(payload);
  assert(!raw.includes("relay-console-secret"), "Relay token is not exposed");
  assert(!raw.includes("relay-client-secret"), "client secret is not exposed");
  assert(
    !raw.includes("local-client-secret"),
    "local Twitch secret is not exposed",
  );
  assert(
    !raw.includes("local-discord-token"),
    "local Discord token is not exposed",
  );
  assert(!raw.includes("Bearer "), "payload does not expose bearer tokens");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Smoke failed: ${message}`);
  }
}
