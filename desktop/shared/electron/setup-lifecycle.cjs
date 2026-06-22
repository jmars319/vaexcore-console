const { existsSync } = require("node:fs");
const { get } = require("node:http");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  isPackagedBootSmoke,
  isWindows,
  setupPort,
  setupProbeUrl,
  setupStatusUrl,
  setupUrl,
} = require("./constants.cjs");
const { resolveUserDataPath } = require("./paths.cjs");

const createSetupLifecycle = ({
  app,
  createSettingsWindow,
  createWindow,
  safeStorage,
  showStartupError,
}) => {
  let setupServer;
  let activeSetupUrl;

  const startApp = async () => {
    const userData = resolveUserDataPath(app);
    app.setPath("userData", userData);
    process.env.VAEXCORE_CONFIG_DIR = userData;
    process.env.DATABASE_URL = `file:${join(userData, "data/vaexcore.sqlite")}`;
    globalThis.__VAEXCORE_LOCAL_SECRETS_CRYPTO__ = (operation, value = "") => {
      if (!safeStorage?.isEncryptionAvailable()) return undefined;
      if (operation === "encrypt") {
        return safeStorage.encryptString(value).toString("base64");
      }
      if (operation === "decrypt" && value) {
        return safeStorage.decryptString(Buffer.from(value, "base64"));
      }
      return undefined;
    };

    const moduleUrl = pathToFileURL(
      join(app.getAppPath(), "dist-bundle/setup-server.js"),
    ).href;
    const setup = await import(moduleUrl);
    try {
      setupServer = await setup.startSetupServer({ port: setupPort });
      activeSetupUrl = setupServer.url;
    } catch (error) {
      if (isAddressInUse(error) && (await isConsoleServerRunning())) {
        activeSetupUrl = setupUrl;
      } else {
        showStartupError(error);
        app.quit();
        return;
      }
    }

    if (!isPackagedBootSmoke()) {
      await createWindow(activeSetupUrl);
      if (isWindows) {
        setTimeout(() => {
          void maybeOpenWindowsSetupPrompt();
        }, 500);
      }
    }
  };

  const maybeOpenWindowsSetupPrompt = async (attempt = 0) => {
    if (!activeSetupUrl || process.env.VAEXCORE_SUPPRESS_SETUP_PROMPT === "1") {
      return;
    }

    try {
      const status = await getJson(setupStatusUrl);
      if (!isSetupComplete(status)) {
        await createSettingsWindow("&setupPrompt=windows#setupGuide");
      }
    } catch {
      if (attempt < 8) {
        setTimeout(() => {
          void maybeOpenWindowsSetupPrompt(attempt + 1);
        }, 750);
      }
    }
  };

  const isConsoleServerRunning = async () => {
    try {
      const config = await getJson(setupProbeUrl);
      return (
        config &&
        typeof config === "object" &&
        config.redirectUri === `${setupUrl}/auth/twitch/callback` &&
        Array.isArray(config.requiredScopes)
      );
    } catch {
      return false;
    }
  };

  return {
    getActiveSetupUrl: () => activeSetupUrl,
    getSetupServer: () => setupServer,
    setSetupServer: (server) => {
      setupServer = server;
    },
    startApp,
  };
};

const isAddressInUse = (error) => error?.code === "EADDRINUSE";

const isSetupComplete = (status) => {
  if (!status || typeof status !== "object") {
    return false;
  }

  const launch = status.launchPreparation || {};
  if (launch.setupReady === true && launch.status !== "setup_required") {
    return true;
  }

  const config = status.config || {};
  const scopes = Array.isArray(config.scopes) ? config.scopes : [];
  const requiredScopes = Array.isArray(config.requiredScopes)
    ? config.requiredScopes
    : ["user:read:chat", "user:write:chat", "channel:read:stream_key"];
  return Boolean(
    config.hasClientId &&
    config.hasClientSecret &&
    config.hasAccessToken &&
    config.hasRefreshToken &&
    config.broadcasterLogin &&
    config.botLogin &&
    requiredScopes.every((scope) => scopes.includes(scope)),
  );
};

const getJson = (url) =>
  new Promise((resolve, reject) => {
    const request = get(url, { timeout: 1500 }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        raw += chunk;
      });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          reject(new Error(`Unexpected status ${response.statusCode}`));
          return;
        }

        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error("Timed out probing setup server."));
    });
    request.on("error", reject);
  });

module.exports = { createSetupLifecycle, isAddressInUse };
