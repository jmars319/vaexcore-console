import { exactRoute, prefixRoute, type SetupRoute } from "./serverRouter";
import { readJson, sendJson } from "./serverHttp";
import {
  exportBotConfigBundle,
  getOperatorMessages,
  importBotConfigBundle,
  resetOperatorMessages,
  saveOperatorMessages,
  sendOperatorMessage,
} from "./serverOperatorConfig";
import { getOutboundMessages, resendOutboundMessage } from "./serverOutbound";

export const operatorRoutes: SetupRoute[] = [
  exactRoute(
    "GET",
    "/api/operator-messages",
    async ({ request, response, url }) => {
      sendJson(response, 200, getOperatorMessages());
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/operator-messages",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      sendJson(response, 200, saveOperatorMessages(body));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/operator-messages/reset",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as { ids?: string[] };
      sendJson(response, 200, resetOperatorMessages(body.ids));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/operator-messages/send",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as {
        id?: string;
        confirmed?: boolean;
      };
      sendJson(response, 200, await sendOperatorMessage(body));
      return;
    },
  ),
  exactRoute(
    "GET",
    "/api/bot-config/export",
    async ({ request, response, url }) => {
      sendJson(response, 200, exportBotConfigBundle());
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/bot-config/import",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      sendJson(response, 200, importBotConfigBundle(body));
      return;
    },
  ),
  exactRoute(
    "GET",
    "/api/outbound-messages",
    async ({ request, response, url }) => {
      sendJson(response, 200, getOutboundMessages());
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/outbound-messages/resend",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as { id?: string };
      sendJson(response, 200, await resendOutboundMessage(body.id));
      return;
    },
  ),
];
