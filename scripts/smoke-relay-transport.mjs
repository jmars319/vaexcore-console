import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const tempDir = mkdtempSync(join(tmpdir(), "vaexcore-relay-smoke-"));
const smokeDbPath = join(tempDir, "data/vaexcore.sqlite");
const relayConsoleToken = "relay-console-secret";

process.env.VAEXCORE_CONFIG_DIR = tempDir;
process.env.DATABASE_URL = `file:${smokeDbPath}`;

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
  rmSync(tempDir, { recursive: true, force: true });
}

async function runSmoke() {
  const appJs = await text("/ui/app.js");
  assert(appJs.includes("Twitch Chat Transport"), "Relay transport UI exists");
  assert(appJs.includes("Relay Chat Bot"), "Relay Chat Bot mode is labeled");
  assert(
    appJs.includes("will appear as a normal Twitch user"),
    "local fallback identity warning is visible",
  );

  const clean = await json("/api/config");
  assert(
    clean.relay.twitchTransportMode === "local-user-token",
    "clean install defaults to local user-token transport",
  );
  assert(
    clean.relay.hasConsoleToken === false,
    "clean install starts without Relay console token",
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
    relayBaseUrl: "https://vaexcore-relay.example.workers.dev/",
    relayInstallationId: "relay-installation-1",
    relayConsoleToken,
  });
  const saved = saveResult.config;

  assert(
    saved.relay.twitchTransportMode === "relay-chatbot",
    "Relay chatbot mode is saved",
  );
  assert(
    saved.relay.baseUrl === "https://vaexcore-relay.example.workers.dev",
    "Relay URL is normalized",
  );
  assert(
    saved.relay.installationId === "relay-installation-1",
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
  assertSafePayload(saved);
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
