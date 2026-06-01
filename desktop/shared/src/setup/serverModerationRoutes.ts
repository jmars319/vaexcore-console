import { exactRoute, prefixRoute, type SetupRoute } from "./serverRouter";
import { readJson, sendJson } from "./serverHttp";
import {
  deleteModerationAllowedLink,
  deleteModerationBlockedLink,
  deleteModerationTerm,
  getModerationState,
  grantModerationLinkPermit,
  saveModerationAllowedLink,
  saveModerationBlockedLink,
  saveModerationSettings,
  saveModerationTerm,
  setModerationAllowedLinkEnabled,
  setModerationBlockedLinkEnabled,
  setModerationTermEnabled,
  simulateModeration,
} from "./serverModeration";
import type { LocalChatRole } from "./serverCommandSimulation";

export const moderationRoutes: SetupRoute[] = [
  exactRoute("GET", "/api/moderation", async ({ request, response, url }) => {
    sendJson(response, 200, getModerationState());
    return;
  }),
  exactRoute(
    "POST",
    "/api/moderation/settings",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      sendJson(response, 200, saveModerationSettings(body));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/moderation/terms",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      sendJson(response, 200, saveModerationTerm(body));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/moderation/terms/enable",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as {
        id?: number;
        enabled?: boolean;
      };
      sendJson(response, 200, setModerationTermEnabled(body));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/moderation/terms/delete",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as { id?: number };
      sendJson(response, 200, deleteModerationTerm(body.id));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/moderation/allowed-links",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      sendJson(response, 200, saveModerationAllowedLink(body));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/moderation/allowed-links/enable",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as {
        id?: number;
        enabled?: boolean;
      };
      sendJson(response, 200, setModerationAllowedLinkEnabled(body));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/moderation/allowed-links/delete",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as { id?: number };
      sendJson(response, 200, deleteModerationAllowedLink(body.id));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/moderation/blocked-links",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      sendJson(response, 200, saveModerationBlockedLink(body));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/moderation/blocked-links/enable",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as {
        id?: number;
        enabled?: boolean;
      };
      sendJson(response, 200, setModerationBlockedLinkEnabled(body));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/moderation/blocked-links/delete",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as { id?: number };
      sendJson(response, 200, deleteModerationBlockedLink(body.id));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/moderation/link-permits",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      sendJson(response, 200, grantModerationLinkPermit(body));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/moderation/simulate",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as {
        actor?: string;
        role?: LocalChatRole;
        text?: string;
      };
      sendJson(response, 200, simulateModeration(body));
      return;
    },
  ),
];
