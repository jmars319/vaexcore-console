import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";

const releaseDir = resolve("release");
const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const productName = packageJson.build?.productName ?? packageJson.name;
const platform = parsePlatform();
const appPath = findPackagedApp(releaseDir, platform);

if (!appPath) {
  throw new Error(`No packaged ${platform} app was found under ${releaseDir}.`);
}

const resourcesDir =
  platform === "mac"
    ? join(appPath, "Contents/Resources")
    : join(appPath, "resources");
const asarPath = join(resourcesDir, "app.asar");
const betterSqliteDir = join(
  resourcesDir,
  "app.asar.unpacked/node_modules/better-sqlite3"
);

assertPath(asarPath, "packaged app.asar");
assertPath(betterSqliteDir, "unpacked better-sqlite3 module");

console.log(`packaged asar smoke passed: ${appPath}`);

function parsePlatform() {
  const index = process.argv.indexOf("--platform");
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return process.platform === "win32" ? "win" : "mac";
}

function assertPath(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${path}`);
  }
}

function findPackagedApp(dir, targetPlatform) {
  if (!existsSync(dir)) {
    return null;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (!entry.isDirectory()) {
      continue;
    }
    if (targetPlatform === "mac" && entry.name === `${productName}.app`) {
      return path;
    }
    if (targetPlatform === "win" && /win.*-unpacked$/i.test(entry.name)) {
      return path;
    }
    const nested = findPackagedApp(path, targetPlatform);
    if (nested) {
      return nested;
    }
  }
  return null;
}
