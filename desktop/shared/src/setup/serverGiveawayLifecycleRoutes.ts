import { exactRoute, prefixRoute, type SetupRoute } from "./serverRouter";
import {
  GiveawaysService,
  parseSupportedPlatforms,
  type GiveawayFollowAgeResolver,
} from "../modules/giveaways/giveaways.service";
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
import { localUiActor, requireUsername } from "./serverCommandSimulation";
import {
  drawSourceEventSuffix,
  firstWinnerTimestamp,
  giveawayAnnouncement,
  giveawayStudioMarker,
  giveawayWinnerMetadata,
  runGiveawayAction,
} from "./serverGiveawayActions";
import { readJson, sendJson } from "./serverHttp";
import { giveawayTemplates, giveawaysService } from "./serverState";

export const giveawayLifecycleRoutes: SetupRoute[] = [
  exactRoute(
    "POST",
    "/api/giveaway/start",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as {
        title?: string;
        keyword?: string;
        winnerCount?: number;
        itemName?: string;
        itemEdition?: string;
        gameName?: string;
        marketplaceName?: string;
        marketplaceNote?: string;
        platformMode?: "winner_selects_after_win" | "fixed_platform";
        supportedPlatforms?: string[];
        prizeType?:
          | "standard_game_key"
          | "deluxe_game_key"
          | "dlc_key"
          | "other";
        minimumFollowAgeDays?: number;
        mustBePresentToWin?: boolean;
        responseWindowMinutes?: number;
        oneEntryPerPerson?: boolean;
        allowExtraEntries?: boolean;
        previousWinnerRestrictionMode?:
          | "exact_item_only"
          | "base_game_blocks_deluxe"
          | "none";
        ageGuidanceText?: string;
        regionAvailabilityDisclaimer?: string;
        entryWindowMinutes?: number;
        echoToChat?: boolean;
      };
      const title = sanitizeGiveawayTitle(body.title);
      const keyword = normalizeKeyword(body.keyword);
      const winnerCount = parseSafeInteger(body.winnerCount, {
        field: "Winner count",
        fallback: 6,
        min: 1,
        max: limits.winnerCountMax,
      });
      sendJson(
        response,
        200,
        await runGiveawayAction(
          () => {
            const giveaway = giveawaysService.start({
              actor: localUiActor,
              title,
              keyword,
              winnerCount,
              itemName: body.itemName,
              itemEdition: body.itemEdition,
              gameName: body.gameName,
              marketplaceName: body.marketplaceName,
              marketplaceNote: body.marketplaceNote,
              platformMode: body.platformMode,
              supportedPlatforms: body.supportedPlatforms,
              prizeType: body.prizeType,
              minimumFollowAgeDays: body.minimumFollowAgeDays,
              mustBePresentToWin: body.mustBePresentToWin,
              responseWindowMinutes: body.responseWindowMinutes,
              oneEntryPerPerson: body.oneEntryPerPerson,
              allowExtraEntries: body.allowExtraEntries,
              previousWinnerRestrictionMode: body.previousWinnerRestrictionMode,
              ageGuidanceText: body.ageGuidanceText,
              regionAvailabilityDisclaimer: body.regionAvailabilityDisclaimer,
              entryWindowMinutes: body.entryWindowMinutes,
            });
            return { giveaway };
          },
          {
            echoToChat: Boolean(body.echoToChat),
            echoCommand: `!gstart codes=${winnerCount} keyword=${keyword} title="${title.replace(/"/g, "'")}"`,
            announcements: ({ giveaway }) =>
              giveawayAnnouncement(
                giveawayTemplates.start(giveaway),
                "start",
                giveaway.id,
                "critical",
              ),
            studioMarker: ({ giveaway }) =>
              giveawayStudioMarker("start", giveaway, {
                statusTimestamp: giveaway.opened_at ?? giveaway.created_at,
                metadata: {
                  requestedWinnerCount: winnerCount,
                  requestedKeyword: keyword,
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
    "/api/giveaway/config",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      sendJson(
        response,
        200,
        await runGiveawayAction(() => ({
          giveaway: giveawaysService.updateConfig(
            localUiActor,
            body as Parameters<GiveawaysService["updateConfig"]>[1],
          ),
        })),
      );
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/giveaway/timer",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as {
        action?: "start" | "stop" | "reset";
        minutes?: number;
      };
      sendJson(
        response,
        200,
        await runGiveawayAction(() => {
          if (body.action === "stop") {
            return { giveaway: giveawaysService.stopEntryTimer(localUiActor) };
          }

          if (body.action === "reset") {
            return {
              giveaway: giveawaysService.resetEntryTimer(
                localUiActor,
                body.minutes,
              ),
            };
          }

          return {
            giveaway: giveawaysService.startEntryTimer(
              localUiActor,
              body.minutes,
            ),
          };
        }),
      );
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/giveaway/close",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as { echoToChat?: boolean };
      sendJson(
        response,
        200,
        await runGiveawayAction(
          () => ({
            giveaway: giveawaysService.close(localUiActor),
          }),
          {
            echoToChat: Boolean(body.echoToChat),
            echoCommand: "!gclose",
            announcements: ({ giveaway }) =>
              giveawayAnnouncement(
                giveawayTemplates.close(
                  giveaway,
                  giveawaysService.countEntriesForGiveaway(giveaway.id),
                ),
                "close",
                giveaway.id,
                "critical",
              ),
            studioMarker: ({ giveaway }) =>
              giveawayStudioMarker("close", giveaway, {
                statusTimestamp: giveaway.closed_at ?? new Date().toISOString(),
                metadata: {
                  entryCount: giveawaysService.countEntriesForGiveaway(
                    giveaway.id,
                  ),
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
    "/api/giveaway/last-call",
    async ({ request, response, url }) => {
      sendJson(
        response,
        200,
        await runGiveawayAction(
          () => {
            const status = giveawaysService.status();

            if (!status || status.giveaway.status !== "open") {
              throw new Error(
                "Last call is only available while entries are open.",
              );
            }

            return {
              giveaway: status.giveaway,
              entryCount: status.entries,
            };
          },
          {
            announcements: ({ giveaway, entryCount }) =>
              giveawayAnnouncement(
                giveawayTemplates.lastCall(giveaway, entryCount),
                "last-call",
                giveaway.id,
                "critical",
              ),
            studioMarker: ({ giveaway, entryCount }) =>
              giveawayStudioMarker("last-call", giveaway, {
                statusTimestamp: new Date().toISOString(),
                metadata: {
                  entryCount,
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
    "/api/giveaway/draw",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as {
        count?: number;
        echoToChat?: boolean;
      };
      const count = parseSafeInteger(body.count, {
        field: "Winner count",
        fallback: 6,
        min: 1,
        max: limits.winnerCountMax,
      });
      sendJson(
        response,
        200,
        await runGiveawayAction(
          () => ({
            result: giveawaysService.draw(localUiActor, count),
          }),
          {
            echoToChat: Boolean(body.echoToChat),
            echoCommand: `!gdraw ${count}`,
            announcements: ({ result }) =>
              giveawayAnnouncement(
                giveawayTemplates.draw(result),
                "draw",
                result.giveaway.id,
                "critical",
              ),
            studioMarker: ({ result }) =>
              giveawayStudioMarker("draw", result.giveaway, {
                statusTimestamp: firstWinnerTimestamp(result.winners),
                sourceEventSuffix: drawSourceEventSuffix(result.winners),
                metadata: {
                  requestedCount: result.requestedCount,
                  eligibleCount: result.eligibleCount,
                  winners: result.winners.map(giveawayWinnerMetadata),
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
    "/api/giveaway/reroll",
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
            result: giveawaysService.reroll(
              localUiActor,
              requireUsername(body.username),
            ),
          }),
          {
            echoToChat: Boolean(body.echoToChat),
            echoCommand: body.username
              ? `!greroll ${requireUsername(body.username)}`
              : undefined,
            announcements: ({ result }) =>
              giveawayAnnouncement(
                giveawayTemplates.reroll(result),
                "reroll",
                result.giveaway.id,
                "important",
              ),
            studioMarker: ({ result }) =>
              giveawayStudioMarker("reroll", result.giveaway, {
                statusTimestamp:
                  result.rerolled.rerolled_at ?? new Date().toISOString(),
                sourceEventSuffix: `winner-${result.rerolled.id}-replacement-${result.replacement?.id ?? "none"}`,
                metadata: {
                  rerolled: giveawayWinnerMetadata(result.rerolled),
                  replacement: result.replacement
                    ? giveawayWinnerMetadata(result.replacement)
                    : null,
                },
              }),
          },
        ),
      );
      return;
    },
  ),
];
