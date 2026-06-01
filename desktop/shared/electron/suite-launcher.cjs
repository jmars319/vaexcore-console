const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { basename, join } = require("node:path");
const {
  isMac,
  isWindows,
  productName,
  vaexcoreSuiteApps,
} = require("./constants.cjs");
const { windowsAppExecutableNames } = require("./paths.cjs");

const createSuiteLauncher = ({ app, dialog }) => {
  const resolveWindowsAppPath = (appName) => {
    if (!isWindows) {
      return undefined;
    }

    const executableNames = windowsAppExecutableNames(appName);
    const programFiles = process.env.ProgramFiles;
    const programFilesX86 = process.env["ProgramFiles(x86)"];
    const localAppDataRoots = [
      app.getPath("localAppData"),
      process.env.LOCALAPPDATA,
    ].filter(Boolean);
    const candidates = [
      appName === productName &&
      executableNames.some(
        (exeName) =>
          basename(process.execPath).toLowerCase() === exeName.toLowerCase(),
      )
        ? process.execPath
        : undefined,
      ...localAppDataRoots.flatMap((root) =>
        executableNames.flatMap((exeName) => [
          join(root, appName, exeName),
          join(root, "Programs", appName, exeName),
        ]),
      ),
      programFiles
        ? executableNames.map((exeName) => join(programFiles, appName, exeName))
        : undefined,
      programFilesX86
        ? executableNames.map((exeName) =>
            join(programFilesX86, appName, exeName),
          )
        : undefined,
    ]
      .flat()
      .filter(Boolean);

    return candidates.find((candidate) => existsSync(candidate));
  };

  const launchWindowsApp = (appName) => {
    const executable = resolveWindowsAppPath(appName);
    if (executable) {
      return spawn(executable, [], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
    }

    return undefined;
  };

  const launchDesktopApp = (appName) =>
    isMac
      ? spawn("open", ["-a", appName], { detached: true, stdio: "ignore" })
      : isWindows
        ? launchWindowsApp(appName)
        : undefined;

  const launchVaexcoreSuite = () => {
    for (const appName of vaexcoreSuiteApps) {
      if (appName === productName) {
        continue;
      }

      const child = launchDesktopApp(appName);
      if (!child) {
        dialog.showErrorBox(
          "Unable to Launch vaexcore Suite",
          isWindows
            ? `Could not find ${appName}. Install it with the Windows installer or place it in a standard vaexcore install folder.`
            : "Suite launching is supported on macOS and Windows desktop builds.",
        );
        continue;
      }

      child.on("error", (error) => {
        dialog.showErrorBox(
          "Unable to Launch vaexcore Suite",
          `Could not launch ${appName}: ${error.message}`,
        );
      });
      child.unref();
    }
  };

  return { launchVaexcoreSuite };
};

module.exports = { createSuiteLauncher };
