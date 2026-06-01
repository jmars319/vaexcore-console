const { app, BrowserWindow, dialog } = require("electron");
const { isMac, productName, setupPort } = require("./constants.cjs");
const { installApplicationMenu } = require("./menu.cjs");
const {
  createSetupLifecycle,
  isAddressInUse,
} = require("./setup-lifecycle.cjs");
const { createSuiteLauncher } = require("./suite-launcher.cjs");
const { createWindowManager } = require("./windows.cjs");

app.setName(productName);

let quitting = false;
let setupLifecycle;

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

const initializeApp = () => {
  const windowManager = createWindowManager({
    app,
    getActiveSetupUrl: () => setupLifecycle?.getActiveSetupUrl(),
  });
  const suiteLauncher = createSuiteLauncher({ app, dialog });
  setupLifecycle = createSetupLifecycle({
    app,
    createSettingsWindow: windowManager.createSettingsWindow,
    createWindow: windowManager.createWindow,
    showStartupError,
  });

  installApplicationMenu({
    closeMainWindow: windowManager.closeMainWindow,
    createSettingsWindow: windowManager.createSettingsWindow,
    launchVaexcoreSuite: suiteLauncher.launchVaexcoreSuite,
  });

  void setupLifecycle.startApp().catch((error) => {
    showStartupError(error);
    app.quit();
  });
};

app.whenReady().then(initializeApp);

app.on("activate", () => {
  if (
    process.env.VAEXCORE_PACKAGED_BOOT_SMOKE !== "1" &&
    BrowserWindow.getAllWindows().length === 0 &&
    setupLifecycle?.getActiveSetupUrl()
  ) {
    const windowManager = createWindowManager({
      app,
      getActiveSetupUrl: () => setupLifecycle?.getActiveSetupUrl(),
    });
    void windowManager.createWindow(setupLifecycle.getActiveSetupUrl());
  }
});

app.on("window-all-closed", () => {
  if (!isMac) {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  const server = setupLifecycle?.getSetupServer();
  if (quitting || !server) {
    return;
  }

  event.preventDefault();
  quitting = true;
  setupLifecycle.setSetupServer(undefined);
  void server.stop().finally(() => app.quit());
});
