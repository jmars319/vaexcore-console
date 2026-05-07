const { join } = require("node:path");
const { pathToFileURL } = require("node:url");

const setupPort = Number(process.env.VAEXCORE_CONSOLE_SETUP_PORT ?? "3434");
const resourcesPath = process.resourcesPath;
const appPath = join(resourcesPath, "app.asar");
const configDir =
  process.env.VAEXCORE_APP_USER_DATA ||
  process.env.VAEXCORE_CONFIG_DIR ||
  join(
    process.env.HOME || process.cwd(),
    "Library",
    "Application Support",
    "vaexcore console",
  );

process.env.VAEXCORE_CONFIG_DIR = configDir;
process.env.DATABASE_URL = `file:${join(configDir, "data/vaexcore.sqlite")}`;

let setupServer;

start().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});

async function start() {
  const setup = await import(
    pathToFileURL(join(appPath, "dist-bundle/setup-server.js")).href
  );
  setupServer = await setup.startSetupServer({ port: setupPort });
  process.on("SIGTERM", () => {
    void stop(0);
  });
  process.on("SIGINT", () => {
    void stop(0);
  });
  setInterval(() => {}, 1_000);
}

async function stop(code) {
  if (setupServer) {
    const server = setupServer;
    setupServer = undefined;
    await server.stop();
  }
  process.exit(code);
}
