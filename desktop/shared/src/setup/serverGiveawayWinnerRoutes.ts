import { exactRoute, prefixRoute, type SetupRoute } from "./serverRouter";
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
  createLocalChatMessage,
  localUiActor,
  requireUsername,
  runLocalLifecycleTest,
  simulatedChatActor,
} from "./serverCommandSimulation";
import {
  giveawayAnnouncement,
  giveawayStudioMarker,
  giveawayWinnerMetadata,
  runGiveawayAction,
} from "./serverGiveawayActions";
import { readJson, sendJson } from "./serverHttp";
import { giveawayTemplates, giveawaysService } from "./serverState";
import type { LocalChatRole } from "./serverCommandSimulation";

export const giveawayWinnerRoutes: SetupRoute[] = [
  exactRoute(
    "POST",
    "/api/giveaway/claim",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as {
        username?: string;
        echoToChat?: boolean;
      };
      sendJson(
        response,
        200,
        await runGiveawayAction(
          () => ({
            result: giveawaysService.claim(
              localUiActor,
              requireUsername(body.username),
            ),
          }),
          {
            echoToChat: Boolean(body.echoToChat),
            echoCommand: body.username
              ? `!gclaim ${requireUsername(body.username)}`
              : undefined,
          },
        ),
      );
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/giveaway/confirm",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as {
        username?: string;
        selectedPlatform?: string;
        regionCountry?: string;
        deliveryMethod?: string;
        marketplaceUsed?: string;
        purchaseStatus?:
          | "not_purchased"
          | "pending_purchase"
          | "purchased"
          | "delivered"
          | "activation_confirmed_optional";
        notes?: string;
      };
      sendJson(
        response,
        200,
        await runGiveawayAction(() => ({
          result: giveawaysService.confirm(
            localUiActor,
            requireUsername(body.username),
            body,
          ),
        })),
      );
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/giveaway/expire",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as { username?: string };
      sendJson(
        response,
        200,
        await runGiveawayAction(() => ({
          result: giveawaysService.expireWinner(
            localUiActor,
            requireUsername(body.username),
          ),
        })),
      );
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/giveaway/purchase-status",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as {
        username?: string;
        purchaseStatus?:
          | "not_purchased"
          | "pending_purchase"
          | "purchased"
          | "delivered"
          | "activation_confirmed_optional";
      };
      sendJson(
        response,
        200,
        await runGiveawayAction(() => ({
          result: giveawaysService.setPurchaseStatus(
            localUiActor,
            requireUsername(body.username),
            body.purchaseStatus,
          ),
        })),
      );
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/giveaway/deliver",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as {
        username?: string;
        echoToChat?: boolean;
      };
      sendJson(
        response,
        200,
        await runGiveawayAction(
          () => ({
            result: giveawaysService.deliver(
              localUiActor,
              requireUsername(body.username),
            ),
          }),
          {
            echoToChat: Boolean(body.echoToChat),
            echoCommand: body.username
              ? `!gdeliver ${requireUsername(body.username)}`
              : undefined,
          },
        ),
      );
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/giveaway/deliver-all",
    async ({ request, response, url }) => {
      sendJson(
        response,
        200,
        await runGiveawayAction(() => ({
          result: giveawaysService.deliverAll(localUiActor),
        })),
      );
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/giveaway/end",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as { echoToChat?: boolean };
      sendJson(
        response,
        200,
        await runGiveawayAction(
          () => ({
            giveaway: giveawaysService.end(localUiActor),
          }),
          {
            echoToChat: Boolean(body.echoToChat),
            echoCommand: "!gend",
            announcements: ({ giveaway }) =>
              giveawayAnnouncement(
                giveawayTemplates.end(
                  giveaway,
                  giveawaysService.getWinnersForGiveaway(giveaway.id),
                ),
                "end",
                giveaway.id,
                "critical",
              ),
            studioMarker: ({ giveaway }) =>
              giveawayStudioMarker("end", giveaway, {
                statusTimestamp: giveaway.ended_at ?? new Date().toISOString(),
                metadata: {
                  winners: giveawaysService
                    .getWinnersForGiveaway(giveaway.id)
                    .map(giveawayWinnerMetadata),
                },
              }),
          },
        ),
      );
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/giveaway/add-entrant",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as {
        login?: string;
        displayName?: string;
        role?: LocalChatRole;
        followAgeDays?: number;
        followVerified?: boolean;
        echoToChat?: boolean;
      };
      sendJson(
        response,
        200,
        await runGiveawayAction(
          async () => ({
            result: await giveawaysService.addSimulatedEntrant(
              simulatedChatActor,
              createLocalChatMessage({
                login: requireUsername(body.login),
                displayName: sanitizeDisplayName(
                  body.displayName,
                  requireUsername(body.login),
                ),
                role: body.role ?? "viewer",
                text: "!enter",
                followAgeDays: body.followAgeDays,
                followVerified: body.followVerified,
              }),
            ),
          }),
          {
            echoToChat: Boolean(body.echoToChat),
            echoCommand: "!enter",
            announcements: ({ result }) =>
              result.status === "entered"
                ? giveawayAnnouncement(
                    giveawayTemplates.entry({
                      giveaway: result.giveaway,
                      displayName: result.displayName,
                      entryCount: result.entryCount,
                    }),
                    "entry",
                    result.giveaway.id,
                  )
                : undefined,
          },
        ),
      );
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/giveaway/remove-entrant",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as {
        username?: string;
        reason?: string;
      };
      sendJson(
        response,
        200,
        await runGiveawayAction(() => ({
          result: giveawaysService.removeEntrant(
            localUiActor,
            requireUsername(body.username),
            body.reason,
          ),
        })),
      );
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/giveaway/run-test",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as {
        echoToChat?: boolean;
        confirmed?: boolean;
      };
      sendJson(
        response,
        200,
        await runLocalLifecycleTest({
          echoToChat: Boolean(body.echoToChat),
          confirmed: Boolean(body.confirmed),
        }),
      );
      return;
    },
  ),
];
