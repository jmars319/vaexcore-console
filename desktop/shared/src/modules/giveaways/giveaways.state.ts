import { getRecentAuditLogs } from "../../core/auditLog";
import { auditGiveaway } from "./giveaways.audit";
import {
  expireEntryTimers,
  expirePendingWinners,
} from "./giveaways.expiration";
import {
  parseJsonObject,
  redactedGiveaway,
  redactedWinner,
  timestamp,
} from "./giveaways.helpers";
import {
  countActiveWinners,
  countEntries,
  countRerolledWinners,
  getActiveGiveaway,
  getEntries,
  getLatestGiveaway,
  getUnresolvedWinners,
  getWinners,
  requireActiveGiveaway,
  requireGiveawayById,
} from "./giveaways.repository";
import type { ChatMessage } from "../../core/chatMessage";
import type { GiveawayEntry, GiveawayWinner } from "./giveaways.types";
import type { GiveawaysServiceContext } from "./giveaways.serviceTypes";

export const getGiveawayStatus = (context: GiveawaysServiceContext) => {
  expireEntryTimers(context);
  expirePendingWinners(context);
  const giveaway = getActiveGiveaway(context);

  if (!giveaway) {
    return undefined;
  }

  return {
    giveaway,
    entries: countEntries(context, giveaway.id),
    activeWinners: countActiveWinners(context, giveaway.id),
    rerolledWinners: countRerolledWinners(context, giveaway.id),
  };
};

export const endGiveaway = (
  context: GiveawaysServiceContext,
  actor: ChatMessage,
) => {
  const giveaway = requireActiveGiveaway(context);
  const unresolvedWinners = getUnresolvedWinners(context, giveaway.id);
  const winners = getWinners(context, giveaway.id);

  const winnerSummary = {
    operatorEvent: "giveaway winner summary before end",
    giveawayId: giveaway.id,
    unresolvedCount: unresolvedWinners.length,
    winners: winners.map((winner) => ({
      login: winner.login,
      twitchUserId: winner.twitch_user_id,
      claimed: Boolean(winner.claimed_at),
      delivered: Boolean(winner.delivered_at),
      rerolled: Boolean(winner.rerolled_at),
    })),
  };

  if (unresolvedWinners.length > 0) {
    context.logger.warn(winnerSummary, "Giveaway winner summary before end");
  } else {
    context.logger.info(winnerSummary, "Giveaway winner summary before end");
  }

  context.db
    .prepare("UPDATE giveaways SET status = 'ended', ended_at = ? WHERE id = ?")
    .run(timestamp(), giveaway.id);

  const ended = requireGiveawayById(context, giveaway.id);
  auditGiveaway(context, actor, "giveaway.end", String(giveaway.id), {});
  context.logger.info(
    {
      operatorEvent: "giveaway ended",
      giveawayId: giveaway.id,
      unresolvedCount: unresolvedWinners.length,
      actor: actor.userLogin,
      mode: actor.source,
    },
    "Giveaway ended",
  );

  return ended;
};

export const getGiveawayOperatorState = (context: GiveawaysServiceContext) => {
  expireEntryTimers(context);
  expirePendingWinners(context);
  const giveaway = getActiveGiveaway(context);

  if (!giveaway) {
    return emptyGiveawayState();
  }

  return giveawayStateFor(context, giveaway.id, giveaway);
};

export const getLatestGiveawayState = (context: GiveawaysServiceContext) => {
  expireEntryTimers(context);
  expirePendingWinners(context);
  const giveaway = getLatestGiveaway(context);

  if (!giveaway) {
    return emptyGiveawayState();
  }

  return giveawayStateFor(context, giveaway.id, giveaway);
};

export const getGiveawayRecentAuditLogs = (
  context: GiveawaysServiceContext,
  limit = 100,
) => getRecentAuditLogs(context.db, limit);

export const exportGiveawayResults = (context: GiveawaysServiceContext) => {
  const state = getLatestGiveawayState(context);
  const giveaway = state.giveaway;

  if (!giveaway) {
    return { available: false as const };
  }

  return {
    available: true as const,
    exportedAt: timestamp(),
    giveaway: redactedGiveaway(giveaway),
    entries: state.entries.map((entry) => ({
      login: entry.login,
      displayName: entry.display_name,
      enteredAt: entry.entered_at,
      eligibilityStatus: entry.eligibility_status,
      eligibilityReason: entry.eligibility_reason,
      followedAt: entry.followed_at,
      followAgeDays: entry.follow_age_days,
    })),
    winners: state.winners.map((winner) => redactedWinner(winner)),
    draw: parseJsonObject(giveaway.draw_result_json),
    audit: getGiveawayRecentAuditLogs(context, 100).filter(
      (log) => log.target === String(giveaway.id),
    ),
  };
};

export const countEntriesForGiveaway = (
  context: GiveawaysServiceContext,
  giveawayId: number,
) => countEntries(context, giveawayId);

export const getWinnersForGiveaway = (
  context: GiveawaysServiceContext,
  giveawayId: number,
) => getWinners(context, giveawayId);

const emptyGiveawayState = () => ({
  giveaway: undefined,
  entries: [] as GiveawayEntry[],
  winners: [] as GiveawayWinner[],
  counts: {
    entries: 0,
    activeWinners: 0,
    rerolledWinners: 0,
  },
});

const giveawayStateFor = (
  context: GiveawaysServiceContext,
  giveawayId: number,
  giveaway: NonNullable<ReturnType<typeof getActiveGiveaway>>,
) => ({
  giveaway,
  entries: getEntries(context, giveawayId),
  winners: getWinners(context, giveawayId),
  counts: {
    entries: countEntries(context, giveawayId),
    activeWinners: countActiveWinners(context, giveawayId),
    rerolledWinners: countRerolledWinners(context, giveawayId),
  },
});
