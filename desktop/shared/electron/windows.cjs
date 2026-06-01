const { BrowserWindow, shell } = require("electron");
const { productName, setupUrl } = require("./constants.cjs");
const { resolveWindowIconPath } = require("./paths.cjs");

const createWindowManager = ({ app, getActiveSetupUrl }) => {
  let mainWindow;
  let settingsWindow;
  const twitchOAuthWindows = new Map();

  const closeMainWindow = () => {
    const window = BrowserWindow.getFocusedWindow() || mainWindow;
    if (window && !window.isDestroyed()) {
      window.close();
    }
  };

  const createSettingsWindow = async (fragment = "") => {
    const activeSetupUrl = getActiveSetupUrl();
    if (!activeSetupUrl) {
      return;
    }

    const settingsTitle = fragment.includes("setupPrompt=windows")
      ? `${productName} Setup Required`
      : `${productName} Configuration Settings`;
    const settingsUrl = `${activeSetupUrl}/?window=settings${fragment}`;
    const icon = resolveWindowIconPath(app);

    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.setTitle(settingsTitle);
      settingsWindow.focus();
      if (fragment) {
        await settingsWindow.loadURL(settingsUrl);
      }
      return;
    }

    settingsWindow = new BrowserWindow({
      width: 980,
      height: 760,
      minWidth: 760,
      minHeight: 620,
      title: settingsTitle,
      backgroundColor: "#090b12",
      ...(icon ? { icon } : {}),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    settingsWindow.on("closed", () => {
      settingsWindow = undefined;
    });
    settingsWindow.on("page-title-updated", (event) => {
      event.preventDefault();
      settingsWindow?.setTitle(settingsTitle);
    });

    configureWindowOpenHandler(settingsWindow);
    await settingsWindow.loadURL(settingsUrl);
  };

  const createWindow = async (url) => {
    const icon = resolveWindowIconPath(app);

    mainWindow = new BrowserWindow({
      width: 1100,
      height: 800,
      minWidth: 900,
      minHeight: 650,
      title: productName,
      backgroundColor: "#0d1117",
      ...(icon ? { icon } : {}),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    mainWindow.on("closed", () => {
      mainWindow = undefined;
    });

    configureWindowOpenHandler(mainWindow);
    await mainWindow.loadURL(url);
  };

  const configureWindowOpenHandler = (window) => {
    window.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      const twitchOAuthKind = hostedTwitchOAuthKind(targetUrl);
      if (twitchOAuthKind) {
        void createTwitchOAuthWindow(targetUrl, twitchOAuthKind);
        return { action: "deny" };
      }

      if (
        targetUrl.startsWith("https://id.twitch.tv/") ||
        targetUrl.startsWith("https://discord.com/")
      ) {
        void shell.openExternal(targetUrl);
        return { action: "deny" };
      }

      if (isSettingsUrl(targetUrl)) {
        const parsed = new URL(targetUrl);
        void createSettingsWindow(parsed.hash);
        return { action: "deny" };
      }

      return { action: "allow" };
    });
  };

  const hostedTwitchOAuthKind = (targetUrl) => {
    try {
      const parsed = new URL(targetUrl);
      if (parsed.pathname !== "/oauth/twitch/start") {
        return undefined;
      }
      const kind = parsed.searchParams.get("kind");
      return kind === "bot" || kind === "broadcaster" ? kind : undefined;
    } catch {
      return undefined;
    }
  };

  const createTwitchOAuthWindow = async (targetUrl, kind) => {
    const existing = twitchOAuthWindows.get(kind);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      await existing.loadURL(targetUrl);
      return;
    }

    const title =
      kind === "bot"
        ? "Authorize vaexcorebot"
        : "Authorize Broadcaster Channel";
    const icon = resolveWindowIconPath(app);
    const authWindow = new BrowserWindow({
      width: 640,
      height: 760,
      minWidth: 560,
      minHeight: 620,
      title,
      backgroundColor: "#090b12",
      ...(icon ? { icon } : {}),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: `persist:vaexcore-twitch-${kind}`,
      },
    });

    twitchOAuthWindows.set(kind, authWindow);
    authWindow.on("closed", () => {
      twitchOAuthWindows.delete(kind);
    });
    authWindow.on("page-title-updated", (event) => {
      event.preventDefault();
      authWindow.setTitle(title);
    });
    await authWindow.loadURL(targetUrl);
  };

  const isSettingsUrl = (targetUrl) => {
    try {
      const parsed = new URL(targetUrl);
      return (
        parsed.origin === setupUrl &&
        parsed.searchParams.get("window") === "settings"
      );
    } catch {
      return false;
    }
  };

  return {
    closeMainWindow,
    createSettingsWindow,
    createWindow,
  };
};

module.exports = { createWindowManager };
