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
for (const record of implementationRecords) {
  const isAppShell = /(^|\/)App\.(tsx|jsx|ts|js)$/.test(record.file);
  const isDesktopMain =
    /(^|\/)(main|lib)\.(cjs|mjs|js|ts|rs)$/.test(record.file) &&
    /desktop|tauri|src-tauri/.test(record.file);
  const isDomainBarrel =
    /(^|\/)packages\/[^/]+\/src\/index\.ts$/.test(record.file) ||
    /(^|\/)packages\/shared-types\/src\/index\.ts$/.test(record.file);
  const budget = isAppShell
    ? maxAppShell
    : isDesktopMain
      ? maxDesktopMain
      : isDomainBarrel
        ? maxDomainBarrel
        : maxImpl;
  if (record.lines > budget)
    violations.push(
      record.file +
        " has " +
        record.lines +
        " lines; budget is " +
        budget +
        ".",
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

if (violations.length > 0) {
  console.log("");
  console.log("Maintainability budget violations:");
  for (const violation of violations) console.log("- " + violation);
  if (strict) process.exit(1);
}
