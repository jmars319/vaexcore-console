import { exactRoute, prefixRoute, type SetupRoute } from "./serverRouter";
import {
  applyDiscordRelaySetupRoute,
  getDiscordRelayActionsRoute,
  getDiscordRelayEventsRoute,
  getDiscordRelayStatusRoute,
  getDiscordRelaySuggestionsRoute,
  previewDiscordRelaySetupRoute,
  recordRelayChatbotIdentityValidation,
  registerDiscordRelayCommandsRoute,
  startDiscordRelayInstallRoute,
  updateDiscordRelayActionStatusRoute,
  updateDiscordRelaySuggestionRoute,
} from "./serverDiscordRelay";
import { readJson, sendJson } from "./serverHttp";
import {
  connectHostedRelayRoute,
  getRelayEventsRoute,
  getRelayStatusRoute,
  registerRelayEventSubRoute,
  sendRelayTestMessageRoute,
} from "./serverRelay";

export const relayRoutes: SetupRoute[] = [
  exactRoute("GET", "/api/relay/status", async ({ request, response, url }) => {
    sendJson(response, 200, await getRelayStatusRoute());
    return;
  }),
  exactRoute("GET", "/api/relay/events", async ({ request, response, url }) => {
    sendJson(response, 200, await getRelayEventsRoute(url.searchParams));
    return;
  }),
  exactRoute(
    "POST",
    "/api/relay/hosted/connect",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      sendJson(response, 200, await connectHostedRelayRoute(body));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/relay/eventsub/register",
    async ({ request, response, url }) => {
      sendJson(response, 200, await registerRelayEventSubRoute());
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/relay/test-send",
    async ({ request, response, url }) => {
      sendJson(response, 200, await sendRelayTestMessageRoute());
      return;
    },
  ),
  exactRoute(
    "GET",
    "/api/discord/relay/status",
    async ({ request, response, url }) => {
      sendJson(response, 200, await getDiscordRelayStatusRoute());
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/discord/relay/install/start",
    async ({ request, response, url }) => {
      sendJson(response, 200, await startDiscordRelayInstallRoute());
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/discord/relay/setup/preview",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      sendJson(response, 200, await previewDiscordRelaySetupRoute(body));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/discord/relay/setup/apply",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      sendJson(response, 200, await applyDiscordRelaySetupRoute(body));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/discord/relay/commands/register",
    async ({ request, response, url }) => {
      sendJson(response, 200, await registerDiscordRelayCommandsRoute());
      return;
    },
  ),
  exactRoute(
    "GET",
    "/api/discord/relay/events",
    async ({ request, response, url }) => {
      sendJson(response, 200, await getDiscordRelayEventsRoute());
      return;
    },
  ),
  exactRoute(
    "GET",
    "/api/discord/relay/actions",
    async ({ request, response, url }) => {
      sendJson(response, 200, getDiscordRelayActionsRoute(url.searchParams));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/discord/relay/actions/status",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      sendJson(response, 200, updateDiscordRelayActionStatusRoute(body));
      return;
    },
  ),
  exactRoute(
    "GET",
    "/api/discord/relay/suggestions",
    async ({ request, response, url }) => {
      sendJson(
        response,
        200,
        await getDiscordRelaySuggestionsRoute(url.searchParams),
      );
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/discord/relay/suggestions/status",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      sendJson(response, 200, await updateDiscordRelaySuggestionRoute(body));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/relay/chatbot-identity/validation",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      sendJson(response, 200, recordRelayChatbotIdentityValidation(body));
      return;
    },
  ),
];
