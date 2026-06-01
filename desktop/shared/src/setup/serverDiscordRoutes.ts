import { exactRoute, prefixRoute, type SetupRoute } from "./serverRouter";
import { getSafeDiscordConfig } from "./serverConfig";
import {
  applyDiscordSetup,
  discordConnectionError,
  previewDiscordSetup,
  saveDiscordConfig,
  sendDiscordAnnouncementRoute,
} from "./serverDiscordSetup";
import { readJson, sendJson } from "./serverHttp";
import { getDiscordRolesRoute, getDiscordStatus } from "./serverRelay";

export const discordRoutes: SetupRoute[] = [
  exactRoute(
    "GET",
    "/api/discord/status",
    async ({ request, response, url }) => {
      sendJson(response, 200, await getDiscordStatus(url.searchParams));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/discord/config",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      const config = saveDiscordConfig(body);
      sendJson(response, 200, { ok: true, config });
      return;
    },
  ),
  exactRoute(
    "GET",
    "/api/discord/roles",
    async ({ request, response, url }) => {
      sendJson(response, 200, await getDiscordRolesRoute());
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/discord/setup/preview",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      sendJson(response, 200, await previewDiscordSetup(body));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/discord/setup/apply",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      const connectionError = discordConnectionError();
      if (connectionError) {
        sendJson(response, 409, {
          ok: false,
          error: connectionError,
          config: getSafeDiscordConfig(),
        });
        return;
      }

      sendJson(response, 200, await applyDiscordSetup(body));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/discord/announce",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      const connectionError = discordConnectionError({
        requireAnnouncementChannel: true,
      });
      if (connectionError) {
        sendJson(response, 409, {
          ok: false,
          error: connectionError,
          config: getSafeDiscordConfig(),
        });
        return;
      }

      sendJson(response, 200, await sendDiscordAnnouncementRoute(body));
      return;
    },
  ),
];
