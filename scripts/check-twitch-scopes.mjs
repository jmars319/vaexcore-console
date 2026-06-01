#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const requiredScopes = [
  "user:read:chat",
  "user:write:chat",
  "channel:read:stream_key",
];

const files = [
  "desktop/shared/src/twitch/validate.ts",
  "desktop/shared/src/setup/ui/app.js",
  "desktop/shared/src/cli/checkEnv.ts",
  "scripts/smoke-diagnostics.mjs",
  "scripts/smoke-setup-ui.mjs",
  "scripts/smoke-token-refresh.mjs",
  "desktop/macOS/scripts/smoke-tester-artifact.mjs",
];
const importerFiles = ["desktop/shared/src/setup/server.ts"];

const errors = [];

for (const file of files) {
  const source =
    file === "desktop/shared/src/setup/ui/app.js"
      ? readSetupUiSource(file)
      : readFileSync(resolve(file), "utf8");
  for (const scope of requiredScopes) {
    if (!source.includes(scope)) {
      errors.push(`${file} is missing required Twitch scope ${scope}`);
    }
  }
}

for (const file of importerFiles) {
  const source =
    file === "desktop/shared/src/setup/server.ts"
      ? readSetupServerSource(file)
      : readFileSync(resolve(file), "utf8");
  if (!source.includes("requiredTwitchScopes")) {
    errors.push(`${file} does not consume requiredTwitchScopes`);
  }
  if (!source.includes("channel:read:stream_key")) {
    errors.push(`${file} is missing stream-key scope handling`);
  }
}

const validationSource = readFileSync(
  resolve("desktop/shared/src/twitch/validate.ts"),
  "utf8",
);
const scopeListMatch = validationSource.match(
  /export const requiredTwitchScopes = \[([\s\S]*?)\] as const;/,
);
if (!scopeListMatch) {
  errors.push("requiredTwitchScopes export could not be parsed");
} else {
  const exportedScopes = [...scopeListMatch[1].matchAll(/"([^"]+)"/g)].map(
    (match) => match[1],
  );
  if (exportedScopes.join(" ") !== requiredScopes.join(" ")) {
    errors.push(
      `requiredTwitchScopes changed from expected order: ${exportedScopes.join(
        " ",
      )}`,
    );
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Required Twitch scopes are aligned.");

function readSetupUiSource(entryFile) {
  const entryPath = resolve(entryFile);
  const source = readFileSync(entryPath, "utf8");
  const baseDir = dirname(entryPath);
  const chunks = [...source.matchAll(/"\/ui\/([^"]+\.js)"/g)].map((match) =>
    readFileSync(resolve(baseDir, match[1]), "utf8"),
  );
  return [source, ...chunks].join("\n");
}

function readSetupServerSource(entryFile) {
  const entryPath = resolve(entryFile);
  const baseDir = dirname(entryPath);
  const modules = readdirSync(baseDir)
    .filter((file) => /^server.*\.ts$/.test(file))
    .sort()
    .map((file) => readFileSync(resolve(baseDir, file), "utf8"));
  return modules.join("\n");
}
