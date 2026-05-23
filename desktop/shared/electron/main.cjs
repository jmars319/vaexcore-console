const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { get } = require("node:http");
const { basename, join } = require("node:path");
const { pathToFileURL } = require("node:url");

let mainWindow;
let settingsWindow;
const twitchOAuthWindows = new Map();
let setupServer;
let activeSetupUrl;
let quitting = false;
const setupPort = 3434;
const setupUrl = `http://localhost:${setupPort}`;
const setupProbeUrl = `http://127.0.0.1:${setupPort}/api/config`;
const setupStatusUrl = `http://127.0.0.1:${setupPort}/api/status`;
const productName = "vaexcore console";
const legacyProductName = "VaexCore";
const isMac = process.platform === "darwin";
const isWindows = process.platform === "win32";
const vaexcoreSuiteApps = [
  "vaexcore studio",
  "vaexcore pulse",
  "vaexcore console",
];
const isPackagedBootSmoke = () =>
  process.env.VAEXCORE_PACKAGED_BOOT_SMOKE === "1";

app.setName(productName);

const buildApplicationMenu = () => {
  const template = [
    {
      label: isMac ? productName : "File",
      submenu: [
        ...(isMac ? [{ role: "about" }, { type: "separator" }] : []),
        {
          label: "Configuration Settings...",
          accelerator: "CommandOrControl+,",
          click: () => {
            void createSettingsWindow();
          },
        },
        {
          label: "Launch vaexcore Suite",
          click: () => launchVaexcoreSuite(),
        },
        { type: "separator" },
        {
          label: "Close Window (App Keeps Running)",
          accelerator: "CommandOrControl+W",
          click: () => closeMainWindow(),
        },
        {
          label: "Quit App (Stops Local Server)",
          accelerator: "CommandOrControl+Q",
          click: () => app.quit(),
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const closeMainWindow = () => {
  const window = BrowserWindow.getFocusedWindow() || mainWindow;
  if (window && !window.isDestroyed()) {
    window.close();
  }
};

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

const launchDesktopApp = (appName) =>
  isMac
    ? spawn("open", ["-a", appName], { detached: true, stdio: "ignore" })
    : isWindows
      ? launchWindowsApp(appName)
      : undefined;

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

const createSettingsWindow = async (fragment = "") => {
  if (!activeSetupUrl) {
    return;
  }

  const settingsTitle = fragment.includes("setupPrompt=windows")
    ? `${productName} Setup Required`
    : `${productName} Configuration Settings`;
  const settingsUrl = `${activeSetupUrl}/?window=settings${fragment}`;
  const icon = resolveWindowIconPath();

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
  const icon = resolveWindowIconPath();

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
    kind === "bot" ? "Authorize vaexcorebot" : "Authorize Broadcaster Channel";
  const icon = resolveWindowIconPath();
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

const startApp = async () => {
  const userData = resolveUserDataPath();
  app.setPath("userData", userData);
  process.env.VAEXCORE_CONFIG_DIR = userData;
  process.env.DATABASE_URL = `file:${join(userData, "data/vaexcore.sqlite")}`;

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

const isAddressInUse = (error) => error?.code === "EADDRINUSE";

const resolveUserDataPath = () => {
  if (process.env.VAEXCORE_APP_USER_DATA) {
    return process.env.VAEXCORE_APP_USER_DATA;
  }

  const legacyUserData = join(app.getPath("appData"), legacyProductName);
  return existsSync(legacyUserData) ? legacyUserData : app.getPath("userData");
};

const resolveWindowIconPath = () => {
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

const showStartupError = (error) => {
  const message = isAddressInUse(error)
    ? `Port ${setupPort} is already in use and did not respond as vaexcore console. Quit the other app or process using localhost:${setupPort}, then open vaexcore console again.\n\n${portRecoveryHint()}`
    : error?.message || "vaexcore console could not start.";

  dialog.showErrorBox("vaexcore console startup failed", message);
};

const portRecoveryHint = () => {
  if (process.platform === "win32") {
    return `For recovery, run: netstat -ano | findstr :${setupPort}`;
  }

  return `For recovery, run: lsof -nP -iTCP:${setupPort} -sTCP:LISTEN`;
};

app.whenReady().then(() => {
  buildApplicationMenu();
  void startApp().catch((error) => {
    showStartupError(error);
    app.quit();
  });
});

app.on("activate", () => {
  if (
    !isPackagedBootSmoke() &&
    BrowserWindow.getAllWindows().length === 0 &&
    activeSetupUrl
  ) {
    void createWindow(activeSetupUrl);
  }
});

app.on("window-all-closed", () => {
  if (!isMac) {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (quitting || !setupServer) {
    return;
  }

  event.preventDefault();
  quitting = true;
  const server = setupServer;
  setupServer = undefined;
  void server.stop().finally(() => app.quit());
});
