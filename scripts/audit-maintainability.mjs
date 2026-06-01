import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const strict = process.argv.includes("--strict");
const configPath = path.join(root, "scripts", "maintainability.config.json");
const config = fs.existsSync(configPath)
  ? JSON.parse(fs.readFileSync(configPath, "utf8"))
  : {};
const configuredIgnores = Array.isArray(config.ignoredSegments)
  ? config.ignoredSegments
  : [];
const ignoredPathIncludes = (config.ignoredPathIncludes ?? []).map((item) =>
  item.replaceAll("\\", "/"),
);
const ignoredSegments = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "dist",
  "dist-bundle",
  "build",
  "out",
  "coverage",
  ".turbo",
  ".vite",
  "target",
  "gen",
  "release",
  ".desktop-runtime",
  ".wrangler",
  ".expo",
  "web-build",
  ...configuredIgnores,
]);
const sourceExtensions = new Set(
  config.sourceExtensions ?? [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".rs",
    ".css",
    ".scss",
  ],
);
const styleExtensions = new Set([".css", ".scss", ".sass", ".less"]);
const generatedPatterns = (
  config.generatedPatterns ?? [
    "dist/",
    "dist-bundle/",
    "/dist/",
    "/build/",
    "/out/",
    "/target/",
    "/gen/",
    ".desktop-runtime",
    "worker-configuration.d.ts",
    "vite-env.d.ts",
    "next-env.d.ts",
    "*.tsbuildinfo",
  ]
).map((pattern) => pattern.replaceAll("\\", "/"));
const allowedGenerated = new Set(
  (config.allowedGenerated ?? []).map((item) => item.replaceAll("\\", "/")),
);
const maxImpl = Number(config.maxImplementationFileLines ?? 1600);
const maxStyle = Number(config.maxStyleFileLines ?? 2000);
const maxAppShell = Number(config.maxAppShellLines ?? 1200);
const maxDesktopMain = Number(config.maxDesktopMainLines ?? 450);
const maxDomainBarrel = Number(config.maxDomainBarrelLines ?? 700);
const nearLineWarning = Number(config.nearLineWarning ?? 0);
const specificFileBudgets = config.specificFileBudgets ?? {};
const bannedImportPatterns = (config.bannedImportPatterns ?? []).map((item) =>
  item.replaceAll("\\", "/"),
);

function shouldSkipDir(entryName) {
  return ignoredSegments.has(entryName);
}

function walk(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  const relativeDirectory = path
    .relative(root, directory)
    .replaceAll("\\", "/");
  if (
    ignoredPathIncludes.some(
      (item) => relativeDirectory === item || relativeDirectory.includes(item),
    )
  )
    return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && shouldSkipDir(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolute, files);
      continue;
    }
    if (sourceExtensions.has(path.extname(entry.name))) files.push(absolute);
  }
  return files;
}

function lineCount(file) {
  return fs.readFileSync(file, "utf8").split(/\r?\n/).length;
}

function relative(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function matchesPattern(file, pattern) {
  if (pattern.startsWith("*.")) return file.endsWith(pattern.slice(1));
  return file === pattern || file.includes(pattern);
}

const sourceRoots = (
  config.sourceRoots ?? [
    "src",
    "app",
    "apps",
    "packages",
    "crates",
    "server",
    "desktop",
    "scripts",
  ]
).filter((dir) => fs.existsSync(path.join(root, dir)));
const files = sourceRoots
  .flatMap((directory) => walk(path.join(root, directory)))
  .filter((file, index, all) => all.indexOf(file) === index);
const records = files.map((file) => ({
  file: relative(file),
  ext: path.extname(file),
  lines: lineCount(file),
}));
const implementationRecords = records.filter(
  (record) => !styleExtensions.has(record.ext),
);
const styleRecords = records.filter((record) =>
  styleExtensions.has(record.ext),
);
const generatedRecords = records.filter(
  (record) =>
    generatedPatterns.some((pattern) => matchesPattern(record.file, pattern)) &&
    !allowedGenerated.has(record.file),
);

const violations = [];
const warnings = [];
for (const record of implementationRecords) {
  const isAppShell = /(^|\/)App\.(tsx|jsx|ts|js)$/.test(record.file);
  const isDesktopMain =
    /(^|\/)(main|lib)\.(cjs|mjs|js|ts|rs)$/.test(record.file) &&
    /desktop|tauri|src-tauri/.test(record.file);
  const isDomainBarrel =
    /(^|\/)packages\/[^/]+\/src\/index\.ts$/.test(record.file) ||
    /(^|\/)packages\/shared-types\/src\/index\.ts$/.test(record.file);
  const budget =
    Number(specificFileBudgets[record.file]) ||
    (isAppShell
      ? maxAppShell
      : isDesktopMain
        ? maxDesktopMain
        : isDomainBarrel
          ? maxDomainBarrel
          : maxImpl);
  if (record.lines > budget)
    violations.push(
      record.file +
        " has " +
        record.lines +
        " lines; budget is " +
        budget +
        ".",
    );
  else if (nearLineWarning > 0 && budget - record.lines <= nearLineWarning)
    warnings.push(
      record.file +
        " is within " +
        (budget - record.lines) +
        " lines of its " +
        budget +
        " line budget.",
    );
}
for (const record of styleRecords) {
  if (record.lines > maxStyle)
    violations.push(
      record.file +
        " has " +
        record.lines +
        " style lines; budget is " +
        maxStyle +
        ".",
    );
  else if (nearLineWarning > 0 && maxStyle - record.lines <= nearLineWarning)
    warnings.push(
      record.file +
        " is within " +
        (maxStyle - record.lines) +
        " lines of its " +
        maxStyle +
        " style line budget.",
    );
}
if (generatedRecords.length > 0 && config.allowGeneratedArtifacts !== true) {
  violations.push(
    "generated/runtime artifacts in source scan: " +
      generatedRecords
        .slice(0, 12)
        .map((r) => r.file)
        .join(", ") +
      (generatedRecords.length > 12
        ? " and " + (generatedRecords.length - 12) + " more"
        : ""),
  );
}

const importViolations = [];
for (const record of implementationRecords) {
  const source = fs.readFileSync(path.join(root, record.file), "utf8");
  for (const pattern of bannedImportPatterns) {
    if (
      source.includes(` from "${pattern}`) ||
      source.includes(` from '${pattern}`) ||
      source.includes(`require("${pattern}`) ||
      source.includes(`require('${pattern}`)
    ) {
      importViolations.push(record.file + " imports from " + pattern);
    }
  }
}
if (importViolations.length > 0) {
  violations.push(
    "generated/dependency import findings: " +
      importViolations.slice(0, 10).join(", ") +
      (importViolations.length > 10
        ? " and " + (importViolations.length - 10) + " more"
        : ""),
  );
}

for (const asset of config.assetBudgets ?? []) {
  const assetPath = path.join(root, asset.path);
  if (!fs.existsSync(assetPath)) {
    violations.push("budgeted asset is missing: " + asset.path);
    continue;
  }
  const sizeKb = fs.statSync(assetPath).size / 1024;
  if (sizeKb > Number(asset.budgetKb)) {
    violations.push(
      asset.path +
        " is " +
        sizeKb.toFixed(2) +
        " kB; asset budget is " +
        asset.budgetKb +
        " kB.",
    );
  }
}

if (config.contractSnapshots?.setupRoutes) {
  const snapshotPath = path.join(root, config.contractSnapshots.setupRoutes);
  const serverPath = path.join(root, "desktop/shared/src/setup/server.ts");
  if (!fs.existsSync(snapshotPath)) {
    violations.push(
      "setup route contract snapshot is missing: " +
        config.contractSnapshots.setupRoutes,
    );
  } else if (fs.existsSync(serverPath)) {
    const routes = extractSetupRoutes();
    const expected = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    const routeText = JSON.stringify(routes);
    const expectedText = JSON.stringify(expected);
    if (routeText !== expectedText) {
      const missing = expected.filter((route) => !routes.includes(route));
      const added = routes.filter((route) => !expected.includes(route));
      violations.push(
        "setup route contract snapshot changed. Missing: " +
          (missing.join(", ") || "none") +
          "; added: " +
          (added.join(", ") || "none"),
      );
    }
  }
}

console.log((config.label ?? path.basename(root)) + " maintainability audit");
console.log("");
console.log("Largest implementation files:");
for (const record of implementationRecords
  .sort((a, b) => b.lines - a.lines)
  .slice(0, 12))
  console.log("- " + record.file + ": " + record.lines + " lines");
console.log("");
console.log("Largest style files:");
for (const record of styleRecords.sort((a, b) => b.lines - a.lines).slice(0, 8))
  console.log("- " + record.file + ": " + record.lines + " lines");
console.log("");
console.log("Generated/runtime findings: " + generatedRecords.length);
for (const record of generatedRecords.slice(0, 8))
  console.log("- " + record.file);
if ((config.assetBudgets ?? []).length > 0) {
  console.log("");
  console.log("Asset budgets:");
  for (const asset of config.assetBudgets) {
    const assetPath = path.join(root, asset.path);
    if (!fs.existsSync(assetPath)) {
      console.log("- " + asset.path + ": missing");
      continue;
    }
    console.log(
      "- " +
        asset.path +
        ": " +
        (fs.statSync(assetPath).size / 1024).toFixed(2) +
        " kB / " +
        asset.budgetKb +
        " kB",
    );
  }
}

if (warnings.length > 0) {
  console.log("");
  console.log("Maintainability near-budget warnings:");
  for (const warning of warnings) console.log("- " + warning);
}

if (violations.length > 0 || (strict && warnings.length > 0)) {
  console.log("");
  console.log("Maintainability budget violations:");
  for (const violation of violations) console.log("- " + violation);
  if (strict) process.exit(1);
}

function extractSetupRoutes() {
  const routes = new Set();
  const setupDir = path.join(root, "desktop/shared/src/setup");
  const routeFiles = fs
    .readdirSync(setupDir)
    .filter((file) => /^server.*Routes\.ts$/.test(file))
    .map((file) => path.join(setupDir, file));
  const routeSources =
    routeFiles.length > 0
      ? routeFiles.map((file) => fs.readFileSync(file, "utf8"))
      : [fs.readFileSync(path.join(setupDir, "server.ts"), "utf8")];

  for (const source of routeSources) {
    for (const match of source.matchAll(
      /exactRoute\(\s*["']([A-Z]+)["']\s*,\s*["']([^"']+)["']/g,
    )) {
      routes.add(match[1] + " " + match[2]);
    }
    for (const match of source.matchAll(
      /prefixRoute\(\s*["']([A-Z]+)["']\s*,\s*["']([^"']+)["']/g,
    )) {
      routes.add(match[1] + " " + match[2] + "*");
    }
  }

  if (routes.size > 0) return [...routes].sort();

  const source = fs.readFileSync(
    path.join(root, "desktop/shared/src/setup/server.ts"),
    "utf8",
  );
  const exactPatterns = [
    /request\.method\s*===\s*"([A-Z]+)"\s*&&\s*url\.pathname\s*===\s*"([^"]+)"/g,
    /request\.method\s*===\s*"([A-Z]+)"\s*&&\s*\n\s*url\.pathname\s*===\s*"([^"]+)"/g,
  ];
  const prefixPatterns = [
    /request\.method\s*===\s*"([A-Z]+)"\s*&&\s*url\.pathname\.startsWith\("([^"]+)"\)/g,
    /request\.method\s*===\s*"([A-Z]+)"\s*&&\s*\n\s*url\.pathname\.startsWith\("([^"]+)"\)/g,
  ];

  for (const pattern of exactPatterns) {
    for (const match of source.matchAll(pattern)) {
      routes.add(match[1] + " " + match[2]);
    }
  }
  for (const pattern of prefixPatterns) {
    for (const match of source.matchAll(pattern)) {
      routes.add(match[1] + " " + match[2] + "*");
    }
  }

  return [...routes].sort();
}
