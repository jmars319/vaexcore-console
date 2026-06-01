import { exactRoute, prefixRoute, type SetupRoute } from "./serverRouter";
import {
  getBotCompletionRoute,
  recordBotValidation,
} from "./serverBotCompletion";
import { readJson, sendJson } from "./serverHttp";
import {
  getBotSupportBundleRoute,
  runBotSetupRehearsalRoute,
  runFullLocalRehearsalRoute,
} from "./serverRehearsal";
import {
  getTwitchCreatorOpsState,
  runTwitchCreatorOpsRoute,
} from "./serverTwitchCreatorOps";

export const botSetupRoutes: SetupRoute[] = [
  exactRoute(
    "GET",
    "/api/bot/completion",
    async ({ request, response, url }) => {
      sendJson(response, 200, await getBotCompletionRoute());
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/bot/validation-record",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      sendJson(response, 200, recordBotValidation(body));
      return;
    },
  ),
  exactRoute(
    "GET",
    "/api/bot/support-bundle",
    async ({ request, response, url }) => {
      sendJson(response, 200, await getBotSupportBundleRoute());
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/bot/rehearsal/run",
    async ({ request, response, url }) => {
      sendJson(response, 200, await runBotSetupRehearsalRoute());
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/local-rehearsal/run",
    async ({ request, response, url }) => {
      sendJson(response, 200, await runFullLocalRehearsalRoute());
      return;
    },
  ),
  exactRoute(
    "GET",
    "/api/twitch/creator-ops",
    async ({ request, response, url }) => {
      sendJson(response, 200, getTwitchCreatorOpsState());
      return;
    },
  ),
  prefixRoute(
    "POST",
    "/api/twitch/creator-ops/",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      sendJson(
        response,
        200,
        await runTwitchCreatorOpsRoute(url.pathname, body),
      );
      return;
    },
  ),
];
