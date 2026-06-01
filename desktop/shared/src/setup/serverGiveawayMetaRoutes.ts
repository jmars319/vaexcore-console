import { exactRoute, prefixRoute, type SetupRoute } from "./serverRouter";
import {
  getGiveawayReminder,
  sendGiveawayReminderNow,
  setGiveawayReminder,
} from "./serverGiveawayReminder";
import {
  getGiveawayOverlayState,
  getGiveawayState,
} from "./serverGiveawayState";
import {
  resetGiveawayTemplates,
  saveGiveawayTemplates,
} from "./serverGiveawayTemplates";
import { readJson, sendJson } from "./serverHttp";
import {
  getGiveawayTemplates,
  resendCriticalGiveawayMessage,
  resendGiveawayAnnouncement,
  sendCurrentGiveawayStatus,
} from "./serverOutbound";
import { giveawaysService } from "./serverState";

export const giveawayMetaRoutes: SetupRoute[] = [
  exactRoute("GET", "/api/giveaway", async ({ request, response, url }) => {
    sendJson(response, 200, getGiveawayState());
    return;
  }),
  exactRoute(
    "GET",
    "/api/giveaway/overlay",
    async ({ request, response, url }) => {
      sendJson(response, 200, getGiveawayOverlayState());
      return;
    },
  ),
  exactRoute(
    "GET",
    "/api/giveaway/export",
    async ({ request, response, url }) => {
      sendJson(response, 200, {
        ok: true,
        export: giveawaysService.exportResults(),
      });
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/giveaway/announcement/resend",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as { action?: string };
      sendJson(response, 200, await resendGiveawayAnnouncement(body.action));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/giveaway/critical/resend",
    async ({ request, response, url }) => {
      sendJson(response, 200, await resendCriticalGiveawayMessage());
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/giveaway/status/send",
    async ({ request, response, url }) => {
      sendJson(response, 200, await sendCurrentGiveawayStatus());
      return;
    },
  ),
  exactRoute(
    "GET",
    "/api/giveaway/templates",
    async ({ request, response, url }) => {
      sendJson(response, 200, getGiveawayTemplates());
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/giveaway/templates",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      sendJson(response, 200, saveGiveawayTemplates(body));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/giveaway/templates/reset",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as { actions?: string[] };
      sendJson(response, 200, resetGiveawayTemplates(body.actions));
      return;
    },
  ),
  exactRoute(
    "GET",
    "/api/giveaway/reminder",
    async ({ request, response, url }) => {
      sendJson(response, 200, getGiveawayReminder());
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/giveaway/reminder",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      sendJson(response, 200, setGiveawayReminder(body));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/giveaway/reminder/send",
    async ({ request, response, url }) => {
      sendJson(response, 200, sendGiveawayReminderNow());
      return;
    },
  ),
];
