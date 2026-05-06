const { existsSync } = require("node:fs");
const { join } = require("node:path");

module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }
  if (process.env.VAEXCORE_MAC_NOTARIZE !== "1") {
    return;
  }

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = join(context.appOutDir, appName);
  if (!existsSync(appPath)) {
    throw new Error(`Cannot notarize missing app bundle: ${appPath}`);
  }

  const appleId = process.env.VAEXCORE_APPLE_ID || process.env.APPLE_ID;
  const appleIdPassword =
    process.env.VAEXCORE_APPLE_APP_SPECIFIC_PASSWORD ||
    process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.VAEXCORE_APPLE_TEAM_ID || process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    throw new Error(
      "VAEXCORE_MAC_NOTARIZE=1 requires VAEXCORE_APPLE_ID, VAEXCORE_APPLE_APP_SPECIFIC_PASSWORD, and VAEXCORE_APPLE_TEAM_ID."
    );
  }

  const { notarize } = require("@electron/notarize");
  await notarize({
    appBundleId: context.packager.appInfo.appId,
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });
};
