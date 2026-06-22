import fs from "node:fs";
import path from "node:path";

const manifestPath = path.resolve("docs/app-runtime-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const failures = [];

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    failures.push(`${field} must be a non-empty string.`);
  }
}

function requireStringArray(value, field) {
  const invalid =
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== "string" || entry.trim() === "");

  if (invalid) {
    failures.push(`${field} must be a non-empty string array.`);
  }
}

if (manifest.schemaVersion !== 1) failures.push("schemaVersion must be 1.");
requireString(manifest.appId, "appId");
requireString(manifest.displayName, "displayName");
requireString(manifest.productLine, "productLine");
requireString(manifest.runtime?.primaryMode, "runtime.primaryMode");
requireString(manifest.runtime?.uiShell, "runtime.uiShell");
requireStringArray(manifest.runtime?.launch, "runtime.launch");
requireStringArray(manifest.runtime?.health, "runtime.health");
requireStringArray(manifest.runtime?.degradedStates, "runtime.degradedStates");
requireStringArray(manifest.capabilities, "capabilities");
requireStringArray(manifest.storage?.records, "storage.records");
requireStringArray(manifest.storage?.secrets, "storage.secrets");
requireStringArray(manifest.storage?.logs, "storage.logs");
requireStringArray(manifest.storage?.exports, "storage.exports");
requireStringArray(manifest.integrations?.inbound, "integrations.inbound");
requireStringArray(manifest.integrations?.outbound, "integrations.outbound");
requireStringArray(manifest.integrations?.discovery, "integrations.discovery");
requireString(manifest.security?.networkPolicy, "security.networkPolicy");
requireStringArray(
  manifest.security?.sensitiveActions,
  "security.sensitiveActions",
);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`[runtime-contract] ${manifest.appId} manifest is valid.`);
