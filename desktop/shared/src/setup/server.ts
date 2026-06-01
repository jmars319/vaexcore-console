import "dotenv/config";
import { pathToFileURL } from "node:url";

import { startSetupServer } from "./serverMain";

export type { SetupServerHandle } from "./serverTypes";
export { startSetupServer };

const isDirectRun = () => {
  const entry = process.argv[1];
  return Boolean(entry && import.meta.url === pathToFileURL(entry).href);
};

if (isDirectRun()) {
  const handle = await startSetupServer();

  const shutdown = async () => {
    await handle.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}
