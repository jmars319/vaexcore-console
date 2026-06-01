import { exactRoute, prefixRoute, type SetupRoute } from "./serverRouter";
import {
  giveawayOverlayHtml,
  redirect,
  sendHtml,
  sendPlatformHtml,
  sendStaticUiAsset,
  sendText,
  setupShellHtml,
  getSetupUiDir,
  resolveSetupUiAssetPath,
  securityHeaders,
} from "./staticUi";
import { buildPlatformPage, getPlatformStatus } from "./serverPlatform";

export const staticRoutes: SetupRoute[] = [
  exactRoute("GET", "/", async ({ request, response, url }) => {
    sendHtml(response, setupShellHtml);
    return;
  }),
  exactRoute("GET", "/giveaway-overlay", async ({ request, response, url }) => {
    sendHtml(response, giveawayOverlayHtml);
    return;
  }),
  exactRoute("GET", "/platform", async ({ request, response, url }) => {
    sendPlatformHtml(response, buildPlatformPage(getPlatformStatus()));
    return;
  }),
  prefixRoute("GET", "/ui/", async ({ request, response, url }) => {
    sendStaticUiAsset(response, url.pathname);
    return;
  }),
];
