import { randomBytes } from "node:crypto";
import type { ChatMessage } from "../../core/chatMessage";
import { limits, normalizeLogin, parseSafeInteger } from "../../core/security";
import { auditGiveaway } from "./giveaways.audit";
import { deterministicShuffle, timestamp } from "./giveaways.helpers";
import {
  expireEntryTimers,
  expirePendingWinners,
} from "./giveaways.expiration";
import {
  countActiveWinners,
  findActiveWinner,
  getDrawableEntries,
  insertWinner,
  requireActiveGiveaway,
} from "./giveaways.repository";
import type {
  DrawResult,
  GiveawaysServiceContext,
} from "./giveaways.serviceTypes";

export const drawGiveawayWinners = (
  context: GiveawaysServiceContext,
  actor: ChatMessage,
  requestedCount?: number,
  options: { allowOpen?: boolean } = {},
): DrawResult => {
  expireEntryTimers(context);
  const giveaway = requireActiveGiveaway(context);

  if (giveaway.status === "open" && !options.allowOpen) {
    throw new Error(
      "Close the giveaway before drawing winners, or use --allow-open",
    );
  }

  const remainingWinnerSlots =
    giveaway.winner_count - countActiveWinners(context, giveaway.id);
  const count = parseSafeInteger(requestedCount ?? remainingWinnerSlots, {
    field: "Winner count",
    min: 1,
    max: limits.winnerCountMax,
  });
  const drawCount = Math.min(count, Math.max(0, remainingWinnerSlots));
  const candidates = getDrawableEntries(context, giveaway.id);
  const finalDrawCount = Math.min(drawCount, candidates.length);

  if (finalDrawCount === 0) {
    context.logger.warn(
      {
        operatorEvent: "giveaway winners drawn",
        giveawayId: giveaway.id,
        requestedCount: count,
        drawnCount: 0,
        eligibleCount: candidates.length,
        actor: actor.userLogin,
        mode: actor.source,
      },
      "No eligible giveaway winners available",
    );
    return {
      giveaway,
      winners: [],
      requestedCount: count,
      eligibleCount: candidates.length,
    };
  }

  const seed = randomBytes(16).toString("hex");
  const selected = deterministicShuffle(candidates, seed).slice(
    0,
    finalDrawCount,
  );
  const winners = selected.map((entry) =>
    insertWinner(context, giveaway, entry, seed),
  );
  const drawAudit = {
    seed,
    algorithm: "sha256-seeded-sort-v1",
    candidateLogins: candidates.map((candidate) => candidate.login),
    selectedLogins: winners.map((winner) => winner.login),
    drawnAt: timestamp(),
  };
  context.db
    .prepare(
      "UPDATE giveaways SET draw_seed = ?, draw_result_json = ?, last_draw_at = ? WHERE id = ?",
    )
    .run(seed, JSON.stringify(drawAudit), drawAudit.drawnAt, giveaway.id);

  auditGiveaway(context, actor, "giveaway.draw", String(giveaway.id), {
    requestedCount: count,
    drawnCount: winners.length,
    winners: winners.map((winner) => winner.login),
    seed,
  });
  context.logger.info(
    {
      operatorEvent: "giveaway winners drawn",
      giveawayId: giveaway.id,
      requestedCount: count,
      drawnCount: winners.length,
      eligibleCount: candidates.length,
      winners: winners.map((winner) => ({
        login: winner.login,
        twitchUserId: winner.twitch_user_id,
      })),
      actor: actor.userLogin,
      mode: actor.source,
    },
    "Giveaway winners drawn",
  );

  return {
    giveaway,
    winners,
    requestedCount: count,
    eligibleCount: candidates.length,
    seed,
  };
};

export const rerollGiveawayWinner = (
  context: GiveawaysServiceContext,
  actor: ChatMessage,
  username: string,
) => {
  expirePendingWinners(context);
  const giveaway = requireActiveGiveaway(context);
  const login = normalizeLogin(username);

  if (giveaway.status === "open") {
    context.logger.warn(
      {
        operatorEvent: "giveaway reroll failed",
        giveawayId: giveaway.id,
        username: login,
        reason: "giveaway_open",
        actor: actor.userLogin,
        mode: actor.source,
      },
      "Giveaway reroll failed",
    );
    throw new Error("Close the giveaway before rerolling winners");
  }

  const winner = findActiveWinner(context, giveaway.id, login);

  if (!winner) {
    context.logger.warn(
      {
        operatorEvent: "giveaway reroll failed",
        giveawayId: giveaway.id,
        username: login,
        reason: "winner_not_found",
        actor: actor.userLogin,
        mode: actor.source,
      },
      "Giveaway reroll failed",
    );
    throw new Error(`No active winner found for ${login}`);
  }

  context.db
    .prepare(
      "UPDATE giveaway_winners SET status = 'rerolled', rerolled_at = ? WHERE id = ?",
    )
    .run(timestamp(), winner.id);

  const candidates = getDrawableEntries(context, giveaway.id);
  const seed = randomBytes(16).toString("hex");
  const replacementEntry = deterministicShuffle(candidates, seed)[0];
  const replacement = replacementEntry
    ? insertWinner(context, giveaway, replacementEntry, seed)
    : undefined;

  auditGiveaway(context, actor, "giveaway.reroll", String(giveaway.id), {
    rerolled: winner.login,
    replacement: replacement?.login,
    seed,
  });
  context.logger.info(
    {
      operatorEvent: "giveaway reroll",
      giveawayId: giveaway.id,
      rerolled: {
        login: winner.login,
        twitchUserId: winner.twitch_user_id,
      },
      replacement: replacement
        ? {
            login: replacement.login,
            twitchUserId: replacement.twitch_user_id,
          }
        : undefined,
      actor: actor.userLogin,
      mode: actor.source,
    },
    "Giveaway reroll",
  );

  return { giveaway, rerolled: winner, replacement };
};
