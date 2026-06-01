import type { ChatMessage } from "../../core/chatMessage";
import {
  normalizeKeyword,
  normalizeLogin,
  sanitizeDisplayName,
  sanitizeText,
} from "../../core/security";
import { auditGiveaway } from "./giveaways.audit";
import { systemActor, timestamp } from "./giveaways.helpers";
import {
  countEntries,
  getActiveGiveaway,
  requireActiveGiveaway,
  requireGiveawayById,
} from "./giveaways.repository";
import type { Giveaway, GiveawayEntry } from "./giveaways.types";
import type { GiveawaysServiceContext } from "./giveaways.serviceTypes";
import {
  prizeIdentity,
  sameBaseGame,
  sameExactPrize,
} from "./giveaways.helpers";

export const enterGiveaway = async (
  context: GiveawaysServiceContext,
  event: ChatMessage,
  keyword: string,
) => {
  const giveaway = getActiveGiveaway(context);

  if (!giveaway || giveaway.status !== "open") {
    return { status: "not_open" as const };
  }

  const normalizedKeyword = normalizeKeyword(keyword);

  if (normalizedKeyword !== giveaway.keyword) {
    return { status: "ignored" as const };
  }

  const login = normalizeLogin(event.userLogin);
  const displayName = sanitizeDisplayName(event.userDisplayName, login);
  const operatorResult = validateOperatorEligibility(event, giveaway);

  if (!operatorResult.ok) {
    auditEntryRejection(context, giveaway, login, operatorResult.reason);
    return ineligibleEntryResult(
      context,
      giveaway,
      login,
      displayName,
      operatorResult.reason,
    );
  }

  const previousWinnerReason = previousWinnerIneligibility(
    context,
    giveaway,
    event.userId,
  );

  if (previousWinnerReason) {
    auditEntryRejection(context, giveaway, login, previousWinnerReason);
    return ineligibleEntryResult(
      context,
      giveaway,
      login,
      displayName,
      previousWinnerReason,
    );
  }

  const existingEntry = context.db
    .prepare(
      "SELECT * FROM giveaway_entries WHERE giveaway_id = ? AND twitch_user_id = ? LIMIT 1",
    )
    .get(giveaway.id, event.userId) as GiveawayEntry | undefined;

  if (existingEntry?.removed_at) {
    return ineligibleEntryResult(
      context,
      giveaway,
      login,
      displayName,
      existingEntry.removed_reason || "Removed by operator.",
    );
  }

  if (existingEntry) {
    return {
      status: "duplicate" as const,
      giveaway,
      login,
      displayName,
      entryCount: countEntries(context, giveaway.id),
    };
  }

  const follow = await context.followAgeResolver(event, giveaway);

  if (follow.status !== "eligible") {
    const reason =
      follow.status === "too_new"
        ? `Follow age is below ${giveaway.minimum_follow_age_days} day(s).`
        : follow.reason || "Follow age could not be verified.";
    auditGiveaway(
      context,
      systemActor(),
      "giveaway.entry_rejected",
      String(giveaway.id),
      {
        entrant: login,
        reason,
        followStatus: follow.status,
      },
    );
    return ineligibleEntryResult(context, giveaway, login, displayName, reason);
  }

  const result = context.db
    .prepare(
      `
        INSERT OR IGNORE INTO giveaway_entries
          (
            giveaway_id,
            twitch_user_id,
            login,
            display_name,
            entered_at,
            eligibility_status,
            eligibility_reason,
            followed_at,
            follow_checked_at,
            follow_age_days,
            is_operator,
            is_mod
          )
        VALUES
          (
            @giveawayId,
            @twitchUserId,
            @login,
            @displayName,
            @enteredAt,
            'eligible',
            '',
            @followedAt,
            @followCheckedAt,
            @followAgeDays,
            @isOperator,
            @isMod
          )
      `,
    )
    .run({
      giveawayId: giveaway.id,
      twitchUserId: event.userId,
      login,
      displayName,
      enteredAt: timestamp(),
      followedAt: follow.followedAt,
      followCheckedAt: follow.checkedAt,
      followAgeDays: follow.followAgeDays,
      isOperator:
        giveaway.operator_twitch_user_id &&
        event.userId === giveaway.operator_twitch_user_id
          ? 1
          : 0,
      isMod: event.isMod ? 1 : 0,
    });

  const entered = result.changes === 1;
  const entryCount = countEntries(context, giveaway.id);

  if (entered) {
    context.logger.info(
      {
        operatorEvent: "giveaway entry count changed",
        giveawayId: giveaway.id,
        entries: entryCount,
        entrant: login,
        entrantUserId: event.userId,
        mode: event.source,
      },
      "Giveaway entry count changed",
    );
  } else {
    context.logger.debug(
      {
        operatorEvent: "giveaway duplicate entry ignored",
        giveawayId: giveaway.id,
        entrant: login,
        entrantUserId: event.userId,
        mode: event.source,
      },
      "Giveaway duplicate entry ignored",
    );
  }

  return {
    status: entered ? ("entered" as const) : ("duplicate" as const),
    giveaway,
    login,
    displayName,
    entryCount,
  };
};

export const addSimulatedGiveawayEntrant = async (
  context: GiveawaysServiceContext,
  actor: ChatMessage,
  entrant: ChatMessage,
) => {
  const giveaway = getActiveGiveaway(context);

  if (!giveaway) {
    throw new Error("No active giveaway");
  }

  const result = await enterGiveaway(context, entrant, giveaway.keyword);

  auditGiveaway(
    context,
    actor,
    "giveaway.simulated_entry",
    String(giveaway.id),
    {
      entrantLogin: entrant.userLogin,
      entrantUserId: entrant.userId,
      result: result.status,
    },
  );

  return result;
};

export const removeGiveawayEntrant = (
  context: GiveawaysServiceContext,
  actor: ChatMessage,
  username: string,
  reason?: string,
) => {
  const giveaway = requireActiveGiveaway(context);
  const login = normalizeLogin(username);
  const removedAt = timestamp();
  const removalReason = sanitizeText(reason ?? "Removed by operator", {
    field: "Removal reason",
    maxLength: 160,
  });
  const result = context.db
    .prepare(
      `
        UPDATE giveaway_entries
        SET eligibility_status = 'removed',
            eligibility_reason = @reason,
            removed_at = @removedAt,
            removed_reason = @reason
        WHERE giveaway_id = @giveawayId
          AND lower(login) = @login
          AND removed_at IS NULL
      `,
    )
    .run({
      giveawayId: giveaway.id,
      login,
      removedAt,
      reason: removalReason,
    });

  if (result.changes === 0) {
    throw new Error(`No active entrant found for ${login}`);
  }

  auditGiveaway(context, actor, "giveaway.entry_removed", String(giveaway.id), {
    entrant: login,
    reason: removalReason,
  });
  return {
    giveaway: requireGiveawayById(context, giveaway.id),
    removed: login,
  };
};

const auditEntryRejection = (
  context: GiveawaysServiceContext,
  giveaway: Giveaway,
  login: string,
  reason: string,
) => {
  auditGiveaway(
    context,
    systemActor(),
    "giveaway.entry_rejected",
    String(giveaway.id),
    {
      entrant: login,
      reason,
    },
  );
};

const ineligibleEntryResult = (
  context: GiveawaysServiceContext,
  giveaway: Giveaway,
  login: string,
  displayName: string,
  reason: string,
) => ({
  status: "ineligible" as const,
  giveaway,
  login,
  displayName,
  entryCount: countEntries(context, giveaway.id),
  reason,
});

const validateOperatorEligibility = (
  event: ChatMessage,
  giveaway: Giveaway,
) => {
  if (
    giveaway.operator_twitch_user_id &&
    event.userId === giveaway.operator_twitch_user_id
  ) {
    return {
      ok: false as const,
      reason: "The giveaway operator cannot enter this giveaway.",
    };
  }

  return { ok: true as const };
};

const previousWinnerIneligibility = (
  context: GiveawaysServiceContext,
  giveaway: Giveaway,
  twitchUserId: string,
) => {
  if (giveaway.previous_winner_restriction_mode === "none") {
    return undefined;
  }

  const previous = context.db
    .prepare(
      `
        SELECT g.*, w.login
        FROM giveaway_winners w
        JOIN giveaways g ON g.id = w.giveaway_id
        WHERE w.twitch_user_id = ?
          AND w.rerolled_at IS NULL
          AND COALESCE(w.status, 'confirmed') != 'expired'
          AND (w.claimed_at IS NOT NULL OR w.confirmed_at IS NOT NULL OR w.delivered_at IS NOT NULL)
        ORDER BY w.id DESC
      `,
    )
    .all(twitchUserId) as Array<Giveaway & { login: string }>;
  const currentPrize = prizeIdentity(giveaway);

  for (const row of previous) {
    if (row.id === giveaway.id) {
      continue;
    }

    const priorPrize = prizeIdentity(row);

    if (sameExactPrize(currentPrize, priorPrize)) {
      return "Previous winner of this item.";
    }

    if (
      giveaway.previous_winner_restriction_mode === "base_game_blocks_deluxe" &&
      sameBaseGame(currentPrize, priorPrize)
    ) {
      return "Previous winner of this base game.";
    }
  }

  return undefined;
};
