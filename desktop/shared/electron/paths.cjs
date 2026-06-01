const { existsSync } = require("node:fs");
const { join } = require("node:path");
const {
  legacyProductName,
  productName,
  isWindows,
} = require("./constants.cjs");

const resolveUserDataPath = (app) => {
  if (process.env.VAEXCORE_APP_USER_DATA) {
    return process.env.VAEXCORE_APP_USER_DATA;
  }

  const legacyUserData = join(app.getPath("appData"), legacyProductName);
  return existsSync(legacyUserData) ? legacyUserData : app.getPath("userData");
};

const resolveWindowIconPath = (app) => {
  const appPath = app.getAppPath();
  const candidates =
    process.platform === "win32"
      ? ["desktop/windows/assets/icon.ico", "desktop/shared/assets/logo.jpg"]
      : process.platform === "darwin"
        ? ["desktop/macOS/assets/icon.icns", "desktop/shared/assets/logo.jpg"]
        : ["desktop/shared/assets/logo.jpg"];

  return candidates
    .map((candidate) => join(appPath, candidate))
    .find((candidate) => existsSync(candidate));
};

const windowsAppExecutableNames = (appName) => {
  switch (appName) {
    case "vaexcore studio":
      return ["vaexcore-studio.exe"];
    case "vaexcore pulse":
      return ["vaexcore-pulse.exe"];
    case "vaexcore console":
      return ["vaexcore-console.exe"];
    default:
      return [`${appName}.exe`];
  }
};

module.exports = {
  isWindows,
  productName,
  resolveUserDataPath,
  resolveWindowIconPath,
  windowsAppExecutableNames,
};
