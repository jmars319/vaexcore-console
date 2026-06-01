import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assert } from "./support/smoke-assertions.mjs";
import { setupUiJavaScriptSource } from "./support/setup-ui-source.mjs";
import { assertSetupUiBundle } from "./support/setup-ui-smoke-bundle.mjs";
import { assertSetupConfigAndOperations } from "./support/setup-ui-smoke-config.mjs";
import { createSetupUiSmokeFixtures } from "./support/setup-ui-smoke-fixtures.mjs";
import { assertGiveawayAndOutboundWorkflow } from "./support/setup-ui-smoke-giveaway.mjs";
import {
  createSetupUiSmokeHttp,
  jsonResponse,
  setupUiStyleSource,
} from "./support/setup-ui-smoke-http.mjs";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const tempDir = mkdtempSync(join(tmpdir(), "vaexcore-smoke-"));
const smokeDbPath = join(tempDir, "data/vaexcore.sqlite");
const realFetch = globalThis.fetch;
let mockInvalidClientSecretExchange = false;
process.env.VAEXCORE_CONFIG_DIR = tempDir;
process.env.DATABASE_URL = `file:${smokeDbPath}`;

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;

  if (
    mockInvalidClientSecretExchange &&
    url.startsWith("https://id.twitch.tv/oauth2/token")
  ) {
    return jsonResponse({ status: 403, message: "invalid client secret" }, 403);
  }

  return realFetch(input, init);
};

const { startSetupServer } = await import(
  pathToFileURL(resolve("dist-bundle/setup-server.js")).href
);

const handle = await startSetupServer({ port: 3435 });
const baseUrl = handle.url;
const http = createSetupUiSmokeHttp({ baseUrl, assert });
const fixtures = createSetupUiSmokeFixtures({
  Database,
  tempDir,
  smokeDbPath,
  assert,
});

try {
  await runSmoke();
  console.log("setup UI smoke passed");
} finally {
  await handle.stop();
  globalThis.fetch = realFetch;
  rmSync(tempDir, { recursive: true, force: true });
}

async function runSmoke() {
  await assertPortConflictRejects();

  const shell = await http.text("/");
  assert(shell.includes("/ui/app.js"), "setup shell references app.js");
  assert(shell.includes("/ui/styles.css"), "setup shell references styles.css");
  assert(shell.includes("/ui/logo.jpg"), "setup shell references logo asset");

  const appJs = await setupUiJavaScriptSource(http.text);
  const styles = await setupUiStyleSource(http.text);
  const logo = await http.binary("/ui/logo.jpg");
  const setupServerJs = readFileSync(
    resolve("dist-bundle/setup-server.js"),
    "utf8",
  );
  const liveBotJs = readFileSync(resolve("dist-bundle/live-bot.js"), "utf8");

  assertSetupUiBundle({
    appJs,
    styles,
    logo,
    setupServerJs,
    liveBotJs,
    assert,
  });

  await assertSetupConfigAndOperations({
    assert,
    baseUrl,
    json: http.json,
    waitForLaunchPreparation: http.waitForLaunchPreparation,
    writeLocalSecretsFixture: fixtures.writeLocalSecretsFixture,
    setMockInvalidClientSecretExchange: (value) => {
      mockInvalidClientSecretExchange = value;
    },
  });

  await assertGiveawayAndOutboundWorkflow({
    assert,
    json: http.json,
    expectOk: http.expectOk,
    assertReminderSettingsFixture: fixtures.assertReminderSettingsFixture,
    insertExternalOutboundFixture: fixtures.insertExternalOutboundFixture,
  });
}

async function assertPortConflictRejects() {
  let rejected = false;

  try {
    await startSetupServer({ port: 3435 });
  } catch (error) {
    rejected = true;
    assert(
      error.code === "EADDRINUSE",
      "setup server rejects with EADDRINUSE when port is occupied",
    );
  }

  assert(rejected, "setup server rejects when port is occupied");
}
