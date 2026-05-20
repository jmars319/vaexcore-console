import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const baseUrl = "http://127.0.0.1:3434";
const outputDir = join(root, ".local", "visual-smoke");
const targets = [
  ["live-ops", "/?tab=dashboard", "1440,1000"],
  ["stream-control", "/?tab=live-mode", "1440,1000"],
  ["suite", "/?tab=suite", "1440,1000"],
  ["diagnostics", "/?tab=diagnostics", "1440,1000"],
  ["settings", "/?window=settings", "1440,1000"],
  ["giveaway-overlay", "/giveaway-overlay", "1920,1080"],
];

const chrome = findChrome();
mkdirSync(outputDir, { recursive: true });

let server = null;
if (!(await isReachable(baseUrl))) {
  server = spawn("npm", ["run", "setup"], {
    cwd: root,
    detached: true,
    stdio: "ignore",
  });
}

try {
  await waitFor(baseUrl);
  for (const [name, path, windowSize] of targets) {
    const screenshot = join(outputDir, `console-${name}.png`);
    await capture(`${baseUrl}${path}`, screenshot, windowSize);
    assertScreenshot(screenshot);
    console.log(`visual smoke: wrote ${screenshot}`);
  }
  await captureGiveawayOverlayFixtures();
} finally {
  if (server) stop(server);
}

function findChrome() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      "Visual smoke requires Google Chrome, Chromium, or Microsoft Edge in /Applications.",
    );
  }
  return found;
}

async function isReachable(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitFor(url) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (await isReachable(url)) return;
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function capture(url, screenshot, windowSize) {
  const userDataDir = join(tmpdir(), `vaexcore-console-smoke-${Date.now()}`);
  if (existsSync(screenshot)) unlinkSync(screenshot);
  const child = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=2000",
      `--window-size=${windowSize}`,
      `--user-data-dir=${userDataDir}`,
      `--screenshot=${screenshot}`,
      url,
    ],
    { cwd: root, detached: true, stdio: "ignore" },
  );

  try {
    await Promise.race([
      waitForScreenshot(screenshot, 20_000),
      waitForExit(child).then((code) => {
        if (code !== 0) {
          throw new Error(`${chrome} exited with ${code}`);
        }
        return waitForScreenshot(screenshot, 1_000);
      }),
    ]);
  } finally {
    stop(child);
  }
}

function assertScreenshot(path) {
  const size = statSync(path).size;
  if (size < 20_000) {
    throw new Error(`Screenshot ${path} is too small (${size} bytes).`);
  }
}

async function captureGiveawayOverlayFixtures() {
  const setupBundle = resolve(root, "dist-bundle", "setup-server.js");
  if (!existsSync(setupBundle)) {
    console.log(
      "visual smoke: skipped giveaway overlay fixtures; build first.",
    );
    return;
  }

  const tempDir = mkdtempSync(join(tmpdir(), "vaexcore-overlay-visual-"));
  const previousConfigDir = process.env.VAEXCORE_CONFIG_DIR;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.VAEXCORE_CONFIG_DIR = tempDir;
  process.env.DATABASE_URL = `file:${join(tempDir, "data/vaexcore.sqlite")}`;

  const { startSetupServer } = await import(pathToFileURL(setupBundle).href);
  const port = await findFreePort();
  const handle = await startSetupServer({ port });
  const fixtureBaseUrl = handle.url.replace("localhost", "127.0.0.1");

  try {
    await postJson(fixtureBaseUrl, "/api/giveaway/start", {
      title: "Visual Fixture Giveaway",
      keyword: "enter",
      winnerCount: 1,
      itemName: "Sniper Elite: Resistance",
      itemEdition: "Standard Edition",
      gameName: "Sniper Elite: Resistance",
      marketplaceName: "Eneba",
      marketplaceNote: "Key sourced after winner confirms platform/region.",
      supportedPlatforms: ["Steam", "Xbox", "PlayStation", "Epic"],
      minimumFollowAgeDays: 7,
      entryWindowMinutes: 10,
      responseWindowMinutes: 7,
    });
    await captureOverlayFixture(fixtureBaseUrl, "giveaway-overlay-open");
    await postJson(fixtureBaseUrl, "/api/giveaway/add-entrant", {
      login: "alice",
      displayName: "Alice",
      simulatedFollowAgeDays: 21,
    });
    await postJson(fixtureBaseUrl, "/api/giveaway/close");
    await postJson(fixtureBaseUrl, "/api/giveaway/draw", { count: 1 });
    await captureOverlayFixture(fixtureBaseUrl, "giveaway-overlay-pending");
    await postJson(fixtureBaseUrl, "/api/giveaway/expire", {
      username: "alice",
    });
    await captureOverlayFixture(fixtureBaseUrl, "giveaway-overlay-expired");
  } finally {
    await handle.stop();
    restoreEnv("VAEXCORE_CONFIG_DIR", previousConfigDir);
    restoreEnv("DATABASE_URL", previousDatabaseUrl);
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function captureOverlayFixture(fixtureBaseUrl, name) {
  const screenshot = join(outputDir, `console-${name}.png`);
  await capture(`${fixtureBaseUrl}/giveaway-overlay`, screenshot, "1920,1080");
  assertScreenshot(screenshot);
  console.log(`visual smoke: wrote ${screenshot}`);
}

async function postJson(base, path, body = {}) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(`POST ${path} failed: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function findFreePort() {
  const server = createTcpServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (!address || typeof address === "string") {
    throw new Error("Unable to reserve a fixture port.");
  }
  return address.port;
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function waitForScreenshot(path, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(path) && statSync(path).size >= 20_000) {
      const size = statSync(path).size;
      await delay(300);
      if (existsSync(path) && statSync(path).size === size) return;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for screenshot ${path}`);
}

function waitForExit(child) {
  return new Promise((resolveExit, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolveExit(code ?? 0));
  });
}

function stop(child) {
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
