import type {
  Giveaway,
  GiveawayWinner,
} from "../modules/giveaways/giveaways.types";
import type { ChatMessage } from "../core/chatMessage";
import {
  GiveawaysService,
  parseSupportedPlatforms,
  type GiveawayFollowAgeResolver,
} from "../modules/giveaways/giveaways.service";
import {
  MessageQueue,
  type MessageQueueEventStatus,
  type MessageQueueMetadata,
} from "../core/messageQueue";
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
  classifyOutboundMessage,
  createOutboundHistory,
  isOutboundCategory,
  isOutboundFailureCategory,
  isOutboundImportance,
  isPendingOutboundStatus,
  type OutboundMessageRecord,
} from "../core/outboundHistory";
import {
  defaultRedirectUri,
  getLocalSecretsPath,
  readLocalSecrets,
  writeLocalSecrets,
  type LocalSecrets,
} from "../config/localSecrets";
import {
  loadStudioIntegrationConfig,
  StudioClient,
  type StudioMarkerInput,
} from "../studio/client";
import { basename, dirname, join, resolve } from "node:path";
import { buildConsoleGiveawayStudioMarker } from "../studio/markerPayloads";
import { formatWinnerNames } from "../modules/giveaways/giveaways.messages";
import { getChannelFollower } from "../twitch/followers";
import { maybeEchoCommand } from "./serverCommandSimulation";
import { getGiveawayState } from "./serverGiveawayState";
import {
  chatQueue,
  giveawayTemplates,
  logger,
  studioClient,
  studioIntegration,
} from "./serverState";
import type { GiveawayAnnouncementPhase } from "./serverGiveawayTemplates";

export const buildGiveawayAnnouncementForPhase = (
  phase: GiveawayAnnouncementPhase,
  state: ReturnType<GiveawaysService["getLatestGiveawayState"]>,
) => {
  const giveaway = state.giveaway;

  if (!giveaway) {
    return undefined;
  }

  const action = phase.actions[0];
  const activeWinners = state.winners.filter((winner) => !winner.rerolled_at);
  const message =
    action === "start"
      ? giveawayTemplates.start(giveaway)
      : action === "reminder"
        ? giveawayTemplates.reminder(giveaway, state.counts.entries)
        : action === "close" &&
            (giveaway.status === "closed" || giveaway.status === "ended")
          ? giveawayTemplates.close(giveaway, state.counts.entries)
          : action === "draw" && activeWinners.length > 0
            ? giveawayTemplates.draw({
                winners: activeWinners,
                requestedCount: Math.max(
                  activeWinners.length,
                  giveaway.winner_count,
                ),
              })
            : action === "end" && giveaway.status === "ended"
              ? giveawayTemplates.end(giveaway, state.winners)
              : undefined;

  if (!message) {
    return undefined;
  }

  return {
    message,
    metadata: {
      category: "giveaway" as const,
      action,
      importance: phase.importance,
      giveawayId: giveaway.id,
    },
  };
};

export const buildGiveawayStatusMessage = (
  state: ReturnType<GiveawaysService["getLatestGiveawayState"]>,
) => {
  const giveaway = state.giveaway;

  if (!giveaway) {
    return undefined;
  }

  const activeWinners = state.winners.filter((winner) => !winner.rerolled_at);
  const pendingDelivery = activeWinners.filter(
    (winner) => !winner.delivered_at,
  );

  if (giveaway.status === "open") {
    return `Giveaway status: entries open for ${giveaway.title}. Type !${giveaway.keyword} to enter. Entries: ${state.counts.entries}. Winners: ${giveaway.winner_count}.`;
  }

  if (giveaway.status === "closed" && activeWinners.length === 0) {
    return `Giveaway status: entries closed for ${giveaway.title}. ${state.counts.entries} entr${state.counts.entries === 1 ? "y" : "ies"}. Ready to draw.`;
  }

  if (activeWinners.length === 0) {
    return `Giveaway status: ${giveaway.title} is ${giveaway.status}. No winners have been drawn.`;
  }

  const winnerText = formatWinnerNames(activeWinners, 5);
  const deliveryText =
    pendingDelivery.length > 0
      ? `Delivery pending for ${pendingDelivery.length}.`
      : "All active winners are marked delivered.";
  const prefix =
    giveaway.status === "ended" ? "Final giveaway status" : "Giveaway status";

  return `${prefix}: ${giveaway.title}. Winner${activeWinners.length === 1 ? "" : "s"}: ${winnerText}. ${deliveryText}`;
};

export const runGiveawayAction = async <
  TResult extends Record<string, unknown>,
>(
  action: () => TResult | Promise<TResult>,
  options: {
    echoToChat?: boolean;
    echoCommand?: string;
    announcements?: (
      result: TResult,
    ) =>
      | GiveawayAnnouncement
      | GiveawayAnnouncement[]
      | string
      | string[]
      | undefined;
    studioMarker?: (result: TResult) => StudioMarkerInput | undefined;
  } = {},
) => {
  try {
    const result = await action();
    const echoQueued = maybeEchoCommand(
      options.echoToChat,
      options.echoCommand,
    );
    const announcementsQueued = maybeQueueGiveawayAnnouncements(
      options.announcements?.(result),
    );
    maybeCreateStudioEventMarker(options.studioMarker?.(result));

    return {
      ok: true,
      ...result,
      echoQueued,
      announcementsQueued,
      state: getGiveawayState(),
    };
  } catch (error) {
    return {
      ok: false,
      error: safeErrorMessage(error, "Giveaway action failed"),
      state: getGiveawayState(),
    };
  }
};

export type GiveawayAnnouncement = {
  message: string;
  metadata: MessageQueueMetadata;
};

export const giveawayAnnouncement = (
  message: string,
  action: string,
  giveawayId: number,
  importance: MessageQueueMetadata["importance"] = "normal",
): GiveawayAnnouncement => ({
  message,
  metadata: {
    category: "giveaway",
    action,
    importance,
    giveawayId,
  },
});

export const giveawayStudioMarker = buildConsoleGiveawayStudioMarker;

export const maybeCreateStudioEventMarker = (
  marker: StudioMarkerInput | undefined,
) => {
  if (!marker || !studioIntegration.enabled) {
    return;
  }

  void studioClient.createMarker(marker).catch((error) => {
    logger.warn(
      {
        error,
        label: marker.label,
        sourceEventId: marker.source_event_id,
      },
      "Studio event marker creation failed",
    );
  });
};

export const giveawayWinnerMetadata = (winner: GiveawayWinner) => ({
  id: winner.id,
  giveawayId: winner.giveaway_id,
  login: winner.login,
  displayName: winner.display_name,
  drawnAt: winner.drawn_at,
  status: winner.status,
  responseExpiresAt: winner.response_expires_at,
  confirmedAt: winner.confirmed_at,
  expiredAt: winner.expired_at,
  claimedAt: winner.claimed_at,
  deliveredAt: winner.delivered_at,
  rerolledAt: winner.rerolled_at,
});

export const firstWinnerTimestamp = (winners: GiveawayWinner[]) =>
  winners[0]?.drawn_at ?? new Date().toISOString();

export const drawSourceEventSuffix = (winners: GiveawayWinner[]) =>
  winners.length > 0
    ? `winners-${winners.map((winner) => winner.id).join("-")}`
    : `winners-none-${Date.now()}`;

export const maybeQueueGiveawayAnnouncements = (
  messages:
    | GiveawayAnnouncement
    | GiveawayAnnouncement[]
    | string
    | string[]
    | undefined,
) => {
  const list = (Array.isArray(messages) ? messages : [messages]).filter(
    isGiveawayAnnouncementInput,
  );

  if (list.length === 0 || !canSendConfiguredChat()) {
    return false;
  }

  let queued = false;

  for (const item of list) {
    try {
      const message = typeof item === "string" ? item : item.message;
      const metadata =
        typeof item === "string"
          ? classifyOutboundMessage(item)
          : item.metadata;
      const text = sanitizeChatMessage(message);
      chatQueue.enqueue(text, metadata);
      queued = true;
    } catch (error) {
      logger.warn({ error }, "Giveaway chat announcement rejected");
    }
  }

  if (queued) {
    logger.info({ count: list.length }, "Giveaway chat announcement queued");
  }

  return queued;
};

export const isGiveawayAnnouncementInput = (
  item: GiveawayAnnouncement | string | undefined,
): item is GiveawayAnnouncement | string => Boolean(item);

export const canSendConfiguredChat = () => {
  const twitch = readLocalSecrets().twitch;

  return Boolean(
    twitch.clientId &&
    twitch.accessToken &&
    twitch.broadcasterUserId &&
    twitch.botUserId,
  );
};

export async function resolveGiveawayFollowAge(
  event: ChatMessage,
  giveaway: Giveaway,
): ReturnType<GiveawayFollowAgeResolver> {
  if (event.source === "local") {
    if (event.simulatedFollowVerified === false) {
      return {
        status: "unverified",
        checkedAt: new Date().toISOString(),
        reason: "Simulated follow age is unverified.",
      };
    }

    const followAgeDays =
      event.simulatedFollowAgeDays ?? giveaway.minimum_follow_age_days + 30;
    const followedAt = new Date(
      Date.now() - followAgeDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    if (followAgeDays < giveaway.minimum_follow_age_days) {
      return {
        status: "too_new",
        followedAt,
        checkedAt: new Date().toISOString(),
        followAgeDays,
        reason: "Simulated follow age is below the giveaway minimum.",
      };
    }

    return {
      status: "eligible",
      followedAt,
      checkedAt: new Date().toISOString(),
      followAgeDays,
    };
  }

  const twitch = readLocalSecrets().twitch;

  if (!twitch.clientId || !twitch.accessToken || !twitch.broadcasterUserId) {
    return {
      status: "unverified",
      checkedAt: new Date().toISOString(),
      reason: "Follow age lookup is not configured.",
    };
  }

  try {
    const follower = await getChannelFollower(
      { clientId: twitch.clientId, accessToken: twitch.accessToken },
      { broadcasterId: twitch.broadcasterUserId, userId: event.userId },
    );

    if (!follower?.followed_at) {
      return {
        status: "unverified",
        checkedAt: new Date().toISOString(),
        reason: "Follow age could not be verified.",
      };
    }

    const followAgeDays = Math.floor(
      (Date.now() - Date.parse(follower.followed_at)) / (24 * 60 * 60 * 1000),
    );

    if (followAgeDays < giveaway.minimum_follow_age_days) {
      return {
        status: "too_new",
        followedAt: follower.followed_at,
        checkedAt: new Date().toISOString(),
        followAgeDays,
        reason: "Follow age is below the giveaway minimum.",
      };
    }

    return {
      status: "eligible",
      followedAt: follower.followed_at,
      checkedAt: new Date().toISOString(),
      followAgeDays,
    };
  } catch (error) {
    logger.warn(
      { error: redactSecrets(error), userLogin: event.userLogin },
      "Giveaway follow age lookup failed",
    );
    return {
      status: "unverified",
      checkedAt: new Date().toISOString(),
      reason: "Follow age lookup failed.",
    };
  }
}
