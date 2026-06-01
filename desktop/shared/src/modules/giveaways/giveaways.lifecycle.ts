import type { ChatMessage } from "../../core/chatMessage";
import {
  limits,
  normalizeKeyword,
  parseSafeInteger,
  sanitizeGiveawayTitle,
} from "../../core/security";
import { auditGiveaway } from "./giveaways.audit";
import { expireEntryTimers } from "./giveaways.expiration";
import {
  addMinutes,
  normalizeGiveawayConfig,
  timestamp,
} from "./giveaways.helpers";
import {
  countEntries,
  getActiveGiveaway,
  requireActiveGiveaway,
  requireGiveawayById,
} from "./giveaways.repository";
import type {
  GiveawaysServiceContext,
  StartGiveawayInput,
} from "./giveaways.serviceTypes";

export const startGiveaway = (
  context: GiveawaysServiceContext,
  input: StartGiveawayInput,
) => {
  const active = getActiveGiveaway(context);

  if (active) {
    throw new Error(`Giveaway #${active.id} is already ${active.status}`);
  }

  const now = timestamp();
  const title = sanitizeGiveawayTitle(input.title);
  const keyword = normalizeKeyword(input.keyword);
  const winnerCount = parseSafeInteger(input.winnerCount, {
    field: "Winner count",
    min: 1,
    max: limits.winnerCountMax,
  });
  const config = normalizeGiveawayConfig(input, title);
  const entriesCloseAt = addMinutes(now, config.entryWindowMinutes);
  const result = context.db
    .prepare(
      `
        INSERT INTO giveaways (
          title,
          keyword,
          status,
          winner_count,
          item_name,
          item_edition,
          game_name,
          marketplace_name,
          marketplace_note,
          platform_mode,
          supported_platforms_json,
          prize_type,
          minimum_follow_age_days,
          must_be_present_to_win,
          response_window_minutes,
          one_entry_per_person,
          allow_extra_entries,
          previous_winner_restriction_mode,
          age_guidance_text,
          region_availability_disclaimer,
          entry_window_minutes,
          entries_close_at,
          timer_started_at,
          operator_twitch_user_id,
          operator_login,
          created_at,
          opened_at
        )
        VALUES (
          @title,
          @keyword,
          'open',
          @winnerCount,
          @itemName,
          @itemEdition,
          @gameName,
          @marketplaceName,
          @marketplaceNote,
          @platformMode,
          @supportedPlatformsJson,
          @prizeType,
          @minimumFollowAgeDays,
          @mustBePresentToWin,
          @responseWindowMinutes,
          @oneEntryPerPerson,
          @allowExtraEntries,
          @previousWinnerRestrictionMode,
          @ageGuidanceText,
          @regionAvailabilityDisclaimer,
          @entryWindowMinutes,
          @entriesCloseAt,
          @timerStartedAt,
          @operatorTwitchUserId,
          @operatorLogin,
          @createdAt,
          @openedAt
        )
      `,
    )
    .run({
      title,
      keyword,
      winnerCount,
      ...config,
      entriesCloseAt,
      timerStartedAt: now,
      operatorTwitchUserId: input.actor.userId,
      operatorLogin: input.actor.userLogin,
      createdAt: now,
      openedAt: now,
    });

  const giveaway = requireGiveawayById(context, Number(result.lastInsertRowid));

  auditGiveaway(context, input.actor, "giveaway.start", String(giveaway.id), {
    title: giveaway.title,
    keyword: giveaway.keyword,
    winnerCount: giveaway.winner_count,
    itemName: giveaway.item_name,
    gameName: giveaway.game_name,
    prizeType: giveaway.prize_type,
  });
  context.logger.info(
    {
      operatorEvent: "giveaway opened",
      giveawayId: giveaway.id,
      title: giveaway.title,
      keyword: giveaway.keyword,
      winnerCount: giveaway.winner_count,
      actor: input.actor.userLogin,
      mode: input.actor.source,
    },
    "Giveaway opened",
  );

  return giveaway;
};

export const closeGiveaway = (
  context: GiveawaysServiceContext,
  actor: ChatMessage,
) => {
  expireEntryTimers(context);
  const giveaway = requireActiveGiveaway(context);

  if (giveaway.status === "closed") {
    return giveaway;
  }

  if (giveaway.status !== "open") {
    throw new Error("Only open giveaways can be closed");
  }

  context.db
    .prepare(
      "UPDATE giveaways SET status = 'closed', closed_at = ? WHERE id = ?",
    )
    .run(timestamp(), giveaway.id);

  const closed = requireGiveawayById(context, giveaway.id);
  auditGiveaway(context, actor, "giveaway.close", String(giveaway.id), {});
  context.logger.info(
    {
      operatorEvent: "giveaway closed",
      giveawayId: giveaway.id,
      entries: countEntries(context, giveaway.id),
      actor: actor.userLogin,
      mode: actor.source,
    },
    "Giveaway closed",
  );

  return closed;
};

export const updateGiveawayConfig = (
  context: GiveawaysServiceContext,
  actor: ChatMessage,
  input: Partial<StartGiveawayInput>,
) => {
  const giveaway = requireActiveGiveaway(context);
  const config = normalizeGiveawayConfig(
    {
      actor,
      title: input.title ?? giveaway.title,
      keyword: input.keyword ?? giveaway.keyword,
      winnerCount: input.winnerCount ?? giveaway.winner_count,
      ...input,
    },
    giveaway.title,
  );

  context.db
    .prepare(
      `
        UPDATE giveaways
        SET
          item_name = @itemName,
          item_edition = @itemEdition,
          game_name = @gameName,
          marketplace_name = @marketplaceName,
          marketplace_note = @marketplaceNote,
          platform_mode = @platformMode,
          supported_platforms_json = @supportedPlatformsJson,
          prize_type = @prizeType,
          minimum_follow_age_days = @minimumFollowAgeDays,
          must_be_present_to_win = @mustBePresentToWin,
          response_window_minutes = @responseWindowMinutes,
          one_entry_per_person = @oneEntryPerPerson,
          allow_extra_entries = @allowExtraEntries,
          previous_winner_restriction_mode = @previousWinnerRestrictionMode,
          age_guidance_text = @ageGuidanceText,
          region_availability_disclaimer = @regionAvailabilityDisclaimer,
          entry_window_minutes = @entryWindowMinutes
        WHERE id = @giveawayId
      `,
    )
    .run({ ...config, giveawayId: giveaway.id });

  const updated = requireGiveawayById(context, giveaway.id);
  auditGiveaway(
    context,
    actor,
    "giveaway.config_update",
    String(giveaway.id),
    config,
  );
  return updated;
};

export const startGiveawayEntryTimer = (
  context: GiveawaysServiceContext,
  actor: ChatMessage,
  minutes?: number,
) => {
  const giveaway = requireActiveGiveaway(context);

  if (giveaway.status !== "open") {
    throw new Error("Entry timer is only available while entries are open.");
  }

  const windowMinutes = parseSafeInteger(
    minutes ?? giveaway.entry_window_minutes,
    {
      field: "Entry window",
      min: 1,
      max: 240,
    },
  );
  const now = timestamp();
  const entriesCloseAt = addMinutes(now, windowMinutes);
  context.db
    .prepare(
      "UPDATE giveaways SET entry_window_minutes = ?, entries_close_at = ?, timer_started_at = ? WHERE id = ?",
    )
    .run(windowMinutes, entriesCloseAt, now, giveaway.id);
  auditGiveaway(context, actor, "giveaway.timer_start", String(giveaway.id), {
    entryWindowMinutes: windowMinutes,
    entriesCloseAt,
  });
  return requireGiveawayById(context, giveaway.id);
};

export const stopGiveawayEntryTimer = (
  context: GiveawaysServiceContext,
  actor: ChatMessage,
) => {
  const giveaway = requireActiveGiveaway(context);
  context.db
    .prepare(
      "UPDATE giveaways SET entries_close_at = NULL, timer_started_at = NULL WHERE id = ?",
    )
    .run(giveaway.id);
  auditGiveaway(context, actor, "giveaway.timer_stop", String(giveaway.id), {});
  return requireGiveawayById(context, giveaway.id);
};
