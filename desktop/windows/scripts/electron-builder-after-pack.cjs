const { execFileSync } = require("node:child_process");
const { existsSync, readFileSync, rmSync } = require("node:fs");
const { join, resolve } = require("node:path");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const projectDir = context.packager.info.projectDir;
  const appOutDir = context.appOutDir;
  const moduleDir = join(
    appOutDir,
    "resources/app.asar.unpacked/node_modules/better-sqlite3",
  );
  const legacyModuleDir = join(
    appOutDir,
    "resources/app/node_modules/better-sqlite3",
  );
  const packagedModuleDir = existsSync(moduleDir) ? moduleDir : legacyModuleDir;
  const prebuildInstallBin = resolve(
    projectDir,
    "node_modules/prebuild-install/bin.js",
  );
  const electronVersion = resolveElectronVersion(context, projectDir);

  if (!existsSync(packagedModuleDir)) {
    throw new Error(`Packaged better-sqlite3 module not found: ${moduleDir}`);
  }

  if (!existsSync(prebuildInstallBin)) {
    throw new Error("prebuild-install was not found in node_modules.");
  }

  rmSync(join(packagedModuleDir, "build"), { recursive: true, force: true });
  execFileSync(
    process.execPath,
    [
      prebuildInstallBin,
      "--runtime",
      "electron",
      "--target",
      electronVersion,
      "--arch",
      process.arch,
      "--platform",
      "win32",
    ],
    { cwd: packagedModuleDir, stdio: "inherit" },
  );
};

function resolveElectronVersion(context, projectDir) {
  const contextVersion =
    context.electronVersion ?? context.packager?.electronVersion;
  if (contextVersion) {
    return contextVersion;
  }

  const electronPackagePath = resolve(
    projectDir,
    "node_modules/electron/package.json",
  );
  if (!existsSync(electronPackagePath)) {
    throw new Error("Electron package version could not be resolved.");
  }

  const electronPackage = JSON.parse(readFileSync(electronPackagePath, "utf8"));
  if (!electronPackage.version) {
    throw new Error("Electron package version is missing.");
  }

  return electronPackage.version;
}
