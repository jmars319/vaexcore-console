import { exactRoute, prefixRoute, type SetupRoute } from "./serverRouter";
import { startBotProcess, stopBotProcess } from "./serverBotProcess";
import { readJson, sendJson } from "./serverHttp";
import { enqueueChatMessage } from "./serverOperatorConfig";
import { runPreflightCheck } from "./serverSetupStatus";

export const runtimeRoutes: SetupRoute[] = [
  exactRoute("POST", "/api/preflight", async ({ request, response, url }) => {
    sendJson(response, 200, await runPreflightCheck());
    return;
  }),
  exactRoute("POST", "/api/bot/start", async ({ request, response, url }) => {
    sendJson(response, 200, await startBotProcess());
    return;
  }),
  exactRoute("POST", "/api/bot/stop", async ({ request, response, url }) => {
    sendJson(response, 200, await stopBotProcess());
    return;
  }),
  exactRoute("POST", "/api/chat/send", async ({ request, response, url }) => {
    const body = (await readJson(request)) as { message?: string };
    sendJson(response, 200, await enqueueChatMessage(body.message));
    return;
  }),
];
