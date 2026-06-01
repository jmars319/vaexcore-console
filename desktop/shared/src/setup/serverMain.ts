import {
  SafeInputError,
  limits,
  normalizeCommandName,
  normalizeKeyword,
  normalizeLogin as normalizeTwitchLogin,
  parseSafeInteger,
  redactSecrets,
  redactSecretText,
  safeErrorMessage,
  sanitizeChatMessage,
  sanitizeCommandText,
  sanitizeDisplayName,
  sanitizeGiveawayTitle,
  sanitizeText,
} from "../core/security";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  defaultRedirectUri,
  getLocalSecretsPath,
  readLocalSecrets,
  writeLocalSecrets,
  type LocalSecrets,
} from "../config/localSecrets";
import { basename, dirname, join, resolve } from "node:path";
import { stopBotProcess } from "./serverBotProcess";
import {
  clearGiveawayReminderTimer,
  scheduleGiveawayReminder,
} from "./serverGiveawayReminder";
import { sendJson } from "./serverHttp";
import { queueLaunchPreparation } from "./serverLaunchPreparation";
import { chatQueue, db, defaultPort, host, logger } from "./serverState";
import {
  startSuiteCommandPoller,
  startSuiteDiscoveryHeartbeat,
} from "./serverSuite";
import type { SetupServerHandle } from "./serverTypes";
import { dispatchSetupRequest } from "./serverRoutes";

export const startSetupServer = async (options: { port?: number } = {}) => {
  const port = options.port ?? defaultPort;
  const server = createServer((request, response) => {
    void dispatchSetupRequest(request, response).catch((error: unknown) => {
      logger.error({ error: redactSecrets(error) }, "Setup request failed");
      sendJson(response, 500, {
        ok: false,
        error: safeErrorMessage(error, "Setup request failed"),
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  logger.info(
    { url: `http://localhost:${port}`, secretsPath: getLocalSecretsPath() },
    "vaexcore console setup server started",
  );

  const suiteDiscoveryTimer = startSuiteDiscoveryHeartbeat(port);
  const suiteCommandTimer = startSuiteCommandPoller();
  scheduleGiveawayReminder();
  setTimeout(() => {
    void queueLaunchPreparation("launch");
  }, 0);

  return {
    url: `http://localhost:${port}`,
    stop: async () => {
      clearInterval(suiteDiscoveryTimer);
      clearInterval(suiteCommandTimer);
      clearGiveawayReminderTimer();
      await stopBotProcess({ force: true });
      await chatQueue.drain(3000);
      chatQueue.stop();
      db.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  } satisfies SetupServerHandle;
};
