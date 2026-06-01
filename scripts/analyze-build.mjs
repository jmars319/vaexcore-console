import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = process.cwd();
const strict = process.argv.includes("--strict");
const configPath = path.join(root, "scripts", "maintainability.config.json");
const config = fs.existsSync(configPath)
  ? JSON.parse(fs.readFileSync(configPath, "utf8"))
  : {};
const nearBudgetWarningBytes = Number(config.nearBudgetWarningKb ?? 0) * 1024;
const candidateAssetDirs = config.assetDirs ?? [
  "dist/assets",
  "build/assets",
  "out/assets",
  "apps/webapp/dist/assets",
  "apps/desktop/dist/assets",
  "apps/desktopapp/dist/assets",
  "desktop/shared/src/setup/ui/dist/assets",
];

function sizeBuffer(buffer) {
  return {
    rawBytes: buffer.byteLength,
    gzipBytes: zlib.gzipSync(buffer).byteLength,
  };
}

function formatBytes(bytes) {
  return (bytes / 1024).toFixed(2) + " kB";
}

function fileSizeRecord(file) {
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) {
    return undefined;
  }
  return {
    file,
    ...sizeBuffer(fs.readFileSync(absolute)),
  };
}

function directorySizeRecord(entry) {
  const absolute = path.join(root, entry.directory);
  if (!fs.existsSync(absolute)) {
    return undefined;
  }
  const extension = entry.extension ?? ".js";
  const files = fs
    .readdirSync(absolute)
    .filter((file) => file.endsWith(extension))
    .sort();
  const records = files
    .map((file) => fileSizeRecord(path.join(entry.directory, file)))
    .filter(Boolean);
  const rawBytes = records.reduce(
    (total, record) => total + record.rawBytes,
    0,
  );
  const gzipBytes = records.reduce(
    (total, record) => total + record.gzipBytes,
    0,
  );
  return {
    file: `${entry.directory}/*${extension}`,
    rawBytes,
    gzipBytes,
    children: records,
  };
}

function collectBuiltJsAssets() {
  const assets = [];
  for (const dir of candidateAssetDirs) {
    const absolute = path.join(root, dir);
    if (!fs.existsSync(absolute)) continue;
    for (const file of fs.readdirSync(absolute)) {
      const candidate = path.join(absolute, file);
      if (fs.statSync(candidate).isDirectory()) {
        for (const nested of fs.readdirSync(candidate)) {
          if (nested.endsWith(".js")) {
            assets.push(
              fileSizeRecord(
                path.join(dir, file, nested).replaceAll("\\", "/"),
              ),
            );
          }
        }
        continue;
      }
      if (file.endsWith(".js"))
        assets.push(fileSizeRecord(path.join(dir, file)));
    }
  }
  const byFile = new Map();
  for (const asset of assets.filter(Boolean)) byFile.set(asset.file, asset);
  return [...byFile.values()];
}

function defaultLargestAssetReport(assets) {
  const budgetBytes =
    Number(
      process.env.BUNDLE_BUDGET_KB ?? config.initialBundleBudgetKb ?? 450,
    ) * 1024;
  const sorted = assets.sort((a, b) => b.rawBytes - a.rawBytes);
  const initialPattern = config.initialChunkPattern
    ? new RegExp(config.initialChunkPattern)
    : /(^|\/)index-[\w-]+\.js$/;
  const initial =
    sorted.find((asset) => initialPattern.test(asset.file)) ?? sorted[0];
  console.log(
    "Initial/largest route chunk: " +
      initial.file +
      " " +
      formatBytes(initial.rawBytes) +
      " raw / " +
      formatBytes(initial.gzipBytes) +
      " gzip",
  );
  console.log("Target: " + formatBytes(budgetBytes) + " raw");
  console.log("");
  return { initial, budgetBytes, sorted };
}

function entryBudgetReport() {
  const entries = Array.isArray(config.entryBudgets) ? config.entryBudgets : [];
  const results = entries.map((entry) => {
    const record = entry.directory
      ? directorySizeRecord(entry)
      : fileSizeRecord(entry.path);
    return { entry, record };
  });

  if (!results.length) return [];

  console.log("Entrypoint budgets:");
  for (const { entry, record } of results) {
    if (!record) {
      console.log(
        `- ${entry.label}: missing (${entry.path ?? entry.directory})`,
      );
      continue;
    }
    console.log(
      `- ${entry.label}: ${formatBytes(record.rawBytes)} raw / ${formatBytes(
        record.gzipBytes,
      )} gzip (budget ${entry.budgetKb} kB)`,
    );
  }
  console.log("");
  return results;
}

console.log((config.label ?? path.basename(root)) + " build size report");
const assets = collectBuiltJsAssets();
if (assets.length === 0) {
  console.log(
    "No built JavaScript assets found. Run the app build first for bundle sizes.",
  );
  if (strict && config.requireBuiltAssets === true) process.exit(1);
  process.exit(0);
}

const entryResults = entryBudgetReport();
const { sorted } = defaultLargestAssetReport(assets);

console.log("Largest JavaScript chunks:");
for (const asset of sorted.slice(0, 12)) {
  console.log(
    "- " +
      asset.file +
      ": " +
      formatBytes(asset.rawBytes) +
      " raw / " +
      formatBytes(asset.gzipBytes) +
      " gzip",
  );
}

const violations = [];
const warnings = [];
for (const { entry, record } of entryResults) {
  if (!record) {
    violations.push(`${entry.label} output is missing.`);
    continue;
  }
  const budgetBytes = Number(entry.budgetKb) * 1024;
  if (record.rawBytes > budgetBytes) {
    violations.push(
      `${entry.label} exceeds budget by ${formatBytes(record.rawBytes - budgetBytes)}.`,
    );
  } else if (
    nearBudgetWarningBytes > 0 &&
    budgetBytes - record.rawBytes <= nearBudgetWarningBytes
  ) {
    warnings.push(
      `${entry.label} is within ${formatBytes(budgetBytes - record.rawBytes)} of budget.`,
    );
  }
}

if (warnings.length > 0) {
  console.log("");
  console.log("Near-budget warnings:");
  for (const warning of warnings) console.log("- " + warning);
}

if (violations.length > 0 || (strict && warnings.length > 0)) {
  if (violations.length > 0) {
    console.log("");
    console.log("Bundle budget violations:");
    for (const violation of violations) console.log("- " + violation);
  }
  if (strict) process.exit(1);
}
