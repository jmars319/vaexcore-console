import { createHash, randomBytes } from "node:crypto";
import type { DbClient } from "../../db/client";
import type { Logger } from "../../core/logger";
import type { ChatMessage } from "../../core/chatMessage";
import {
  limits,
  normalizeKeyword,
  normalizeLogin,
  parseSafeInteger,
  sanitizeDisplayName,
  sanitizeGiveawayTitle,
  sanitizeText,
} from "../../core/security";
import { getRecentAuditLogs, writeAuditLog } from "../../core/auditLog";
import type {
  Giveaway,
  GiveawayEntry,
  GiveawayPlatformMode,
  GiveawayPreviousWinnerRestrictionMode,
  GiveawayPrizeType,
  GiveawayPurchaseStatus,
  GiveawayWinner,
} from "./giveaways.types";

export const defaultSupportedPlatforms = [
  "Steam",
  "Xbox",
  "PlayStation",
  "Epic",
  "Other / manual",
] as const;

export type GiveawayFollowAgeResult =
  | {
      status: "eligible";
      followedAt: string;
      checkedAt: string;
      followAgeDays: number;
    }
  | {
      status: "too_new" | "unverified";
      followedAt?: string;
      checkedAt: string;
      followAgeDays?: number;
      reason: string;
    };

export type GiveawayFollowAgeResolver = (
  event: ChatMessage,
  giveaway: Giveaway,
) => Promise<GiveawayFollowAgeResult>;

type StartGiveawayInput = {
  actor: ChatMessage;
  title: string;
  keyword: string;
  winnerCount: number;
  itemName?: string;
  itemEdition?: string;
  gameName?: string;
  marketplaceName?: string;
  marketplaceNote?: string;
  platformMode?: GiveawayPlatformMode;
  supportedPlatforms?: string[];
  prizeType?: GiveawayPrizeType;
  minimumFollowAgeDays?: number;
  mustBePresentToWin?: boolean;
  responseWindowMinutes?: number;
  oneEntryPerPerson?: boolean;
  allowExtraEntries?: boolean;
  previousWinnerRestrictionMode?: GiveawayPreviousWinnerRestrictionMode;
  ageGuidanceText?: string;
  regionAvailabilityDisclaimer?: string;
  entryWindowMinutes?: number;
};

type DrawResult = {
  giveaway: Giveaway;
  winners: GiveawayWinner[];
  requestedCount: number;
  eligibleCount: number;
  seed?: string;
};

export class GiveawaysService {
  private readonly db: DbClient;
  private readonly logger: Logger;
  private readonly followAgeResolver: GiveawayFollowAgeResolver;

  constructor(options: {
    db: DbClient;
    logger: Logger;
    followAgeResolver?: GiveawayFollowAgeResolver;
  }) {
    this.db = options.db;
    this.logger = options.logger;
    this.followAgeResolver =
      options.followAgeResolver ?? defaultFollowAgeResolver;
  }

  start(input: StartGiveawayInput) {
    const active = this.getActiveGiveaway();

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
    const result = this.db
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

    const giveaway = this.getGiveawayById(Number(result.lastInsertRowid));

    if (!giveaway) {
      throw new Error("Giveaway was created but could not be read back");
    }

    this.audit(input.actor, "giveaway.start", String(giveaway.id), {
      title: giveaway.title,
      keyword: giveaway.keyword,
      winnerCount: giveaway.winner_count,
      itemName: giveaway.item_name,
      gameName: giveaway.game_name,
      prizeType: giveaway.prize_type,
    });
    this.logger.info(
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
  }

  async enter(event: ChatMessage, keyword: string) {
    this.expireEntryTimers();
    const giveaway = this.getActiveGiveaway();

    if (!giveaway || giveaway.status !== "open") {
      return { status: "not_open" as const };
    }

    const normalizedKeyword = normalizeKeyword(keyword);

    if (normalizedKeyword !== giveaway.keyword) {
      return { status: "ignored" as const };
    }

    const login = normalizeLogin(event.userLogin);
    const displayName = sanitizeDisplayName(event.userDisplayName, login);
    const operatorResult = this.validateOperatorEligibility(event, giveaway);

    if (!operatorResult.ok) {
      this.audit(
        systemActor(),
        "giveaway.entry_rejected",
        String(giveaway.id),
        {
          entrant: login,
          reason: operatorResult.reason,
        },
      );
      return {
        status: "ineligible" as const,
        giveaway,
        login,
        displayName,
        entryCount: this.countEntries(giveaway.id),
        reason: operatorResult.reason,
      };
    }

    const previousWinnerReason = this.previousWinnerIneligibility(
      giveaway,
      event.userId,
    );

    if (previousWinnerReason) {
      this.audit(
        systemActor(),
        "giveaway.entry_rejected",
        String(giveaway.id),
        {
          entrant: login,
          reason: previousWinnerReason,
        },
      );
      return {
        status: "ineligible" as const,
        giveaway,
        login,
        displayName,
        entryCount: this.countEntries(giveaway.id),
        reason: previousWinnerReason,
      };
    }

    const existingEntry = this.db
      .prepare(
        "SELECT * FROM giveaway_entries WHERE giveaway_id = ? AND twitch_user_id = ? LIMIT 1",
      )
      .get(giveaway.id, event.userId) as GiveawayEntry | undefined;

    if (existingEntry?.removed_at) {
      return {
        status: "ineligible" as const,
        giveaway,
        login,
        displayName,
        entryCount: this.countEntries(giveaway.id),
        reason: existingEntry.removed_reason || "Removed by operator.",
      };
    }

    if (existingEntry) {
      return {
        status: "duplicate" as const,
        giveaway,
        login,
        displayName,
        entryCount: this.countEntries(giveaway.id),
      };
    }

    const follow = await this.followAgeResolver(event, giveaway);

    if (follow.status !== "eligible") {
      const reason =
        follow.status === "too_new"
          ? `Follow age is below ${giveaway.minimum_follow_age_days} day(s).`
          : follow.reason || "Follow age could not be verified.";
      this.audit(
        systemActor(),
        "giveaway.entry_rejected",
        String(giveaway.id),
        {
          entrant: login,
          reason,
          followStatus: follow.status,
        },
      );
      return {
        status: "ineligible" as const,
        giveaway,
        login,
        displayName,
        entryCount: this.countEntries(giveaway.id),
        reason,
      };
    }

    const result = this.db
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

    const entryCount = this.countEntries(giveaway.id);

    if (entered) {
      this.logger.info(
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
      this.logger.debug(
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
  }

  async addSimulatedEntrant(actor: ChatMessage, entrant: ChatMessage) {
    const giveaway = this.getActiveGiveaway();

    if (!giveaway) {
      throw new Error("No active giveaway");
    }

    const result = await this.enter(entrant, giveaway.keyword);

    this.audit(actor, "giveaway.simulated_entry", String(giveaway.id), {
      entrantLogin: entrant.userLogin,
      entrantUserId: entrant.userId,
      result: result.status,
    });

    return result;
  }

  status() {
    this.expireEntryTimers();
    this.expirePendingWinners();
    const giveaway = this.getActiveGiveaway();

    if (!giveaway) {
      return undefined;
    }

    return {
      giveaway,
      entries: this.countEntries(giveaway.id),
      activeWinners: this.countActiveWinners(giveaway.id),
      rerolledWinners: this.countRerolledWinners(giveaway.id),
    };
  }

  close(actor: ChatMessage) {
    this.expireEntryTimers();
    const giveaway = this.requireActiveGiveaway();

    if (giveaway.status === "closed") {
      return giveaway;
    }

    if (giveaway.status !== "open") {
      throw new Error("Only open giveaways can be closed");
    }

    this.db
      .prepare(
        "UPDATE giveaways SET status = 'closed', closed_at = ? WHERE id = ?",
      )
      .run(timestamp(), giveaway.id);

    const closed = this.requireGiveawayById(giveaway.id);
    this.audit(actor, "giveaway.close", String(giveaway.id), {});
    this.logger.info(
      {
        operatorEvent: "giveaway closed",
        giveawayId: giveaway.id,
        entries: this.countEntries(giveaway.id),
        actor: actor.userLogin,
        mode: actor.source,
      },
      "Giveaway closed",
    );

    return closed;
  }

  draw(
    actor: ChatMessage,
    requestedCount?: number,
    options: { allowOpen?: boolean } = {},
  ): DrawResult {
    this.expireEntryTimers();
    const giveaway = this.requireActiveGiveaway();

    if (giveaway.status === "open" && !options.allowOpen) {
      throw new Error(
        "Close the giveaway before drawing winners, or use --allow-open",
      );
    }

    const remainingWinnerSlots =
      giveaway.winner_count - this.countActiveWinners(giveaway.id);
    const count = parseSafeInteger(requestedCount ?? remainingWinnerSlots, {
      field: "Winner count",
      min: 1,
      max: limits.winnerCountMax,
    });
    const drawCount = Math.min(count, Math.max(0, remainingWinnerSlots));
    const candidates = this.getDrawableEntries(giveaway.id);
    const finalDrawCount = Math.min(drawCount, candidates.length);

    if (finalDrawCount === 0) {
      this.logger.warn(
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
      this.insertWinner(giveaway, entry, seed),
    );
    const drawAudit = {
      seed,
      algorithm: "sha256-seeded-sort-v1",
      candidateLogins: candidates.map((candidate) => candidate.login),
      selectedLogins: winners.map((winner) => winner.login),
      drawnAt: timestamp(),
    };
    this.db
      .prepare(
        "UPDATE giveaways SET draw_seed = ?, draw_result_json = ?, last_draw_at = ? WHERE id = ?",
      )
      .run(seed, JSON.stringify(drawAudit), drawAudit.drawnAt, giveaway.id);

    this.audit(actor, "giveaway.draw", String(giveaway.id), {
      requestedCount: count,
      drawnCount: winners.length,
      winners: winners.map((winner) => winner.login),
      seed,
    });
    this.logger.info(
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
  }

  reroll(actor: ChatMessage, username: string) {
    this.expirePendingWinners();
    const giveaway = this.requireActiveGiveaway();
    const login = normalizeLogin(username);

    if (giveaway.status === "open") {
      this.logger.warn(
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

    const winner = this.findActiveWinner(giveaway.id, login);

    if (!winner) {
      this.logger.warn(
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

    this.db
      .prepare(
        "UPDATE giveaway_winners SET status = 'rerolled', rerolled_at = ? WHERE id = ?",
      )
      .run(timestamp(), winner.id);

    const candidates = this.getDrawableEntries(giveaway.id);
    const seed = randomBytes(16).toString("hex");
    const replacementEntry = deterministicShuffle(candidates, seed)[0];

    const replacement = replacementEntry
      ? this.insertWinner(giveaway, replacementEntry, seed)
      : undefined;

    this.audit(actor, "giveaway.reroll", String(giveaway.id), {
      rerolled: winner.login,
      replacement: replacement?.login,
      seed,
    });
    this.logger.info(
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
  }

  claim(actor: ChatMessage, username: string) {
    this.expirePendingWinners();
    const giveaway = this.requireActiveGiveaway();
    const login = normalizeLogin(username);
    const winner = this.findActiveWinner(giveaway.id, login);

    if (!winner) {
      throw new Error(`No active winner found for ${login}`);
    }

    const now = timestamp();
    this.db
      .prepare(
        "UPDATE giveaway_winners SET status = 'confirmed', claimed_at = COALESCE(claimed_at, ?), confirmed_at = COALESCE(confirmed_at, ?) WHERE id = ?",
      )
      .run(now, now, winner.id);

    const updated = this.requireWinnerById(winner.id);
    this.audit(actor, "giveaway.claim", String(giveaway.id), {
      winner: updated.login,
    });
    this.logger.info(
      {
        operatorEvent: "giveaway winner claimed",
        giveawayId: giveaway.id,
        winner: updated.login,
        winnerUserId: updated.twitch_user_id,
        actor: actor.userLogin,
        mode: actor.source,
      },
      "Giveaway winner claimed",
    );

    return { giveaway, winner: updated };
  }

  confirm(
    actor: ChatMessage,
    username: string,
    input: {
      selectedPlatform?: string;
      regionCountry?: string;
      deliveryMethod?: string;
      marketplaceUsed?: string;
      purchaseStatus?: GiveawayPurchaseStatus;
      notes?: string;
    },
  ) {
    this.expirePendingWinners();
    const giveaway = this.requireActiveGiveaway();
    const login = normalizeLogin(username);
    const winner = this.findActiveWinner(giveaway.id, login);

    if (!winner) {
      throw new Error(`No active winner found for ${login}`);
    }

    const now = timestamp();
    const purchaseStatus = normalizePurchaseStatus(input.purchaseStatus);
    this.db
      .prepare(
        `
          UPDATE giveaway_winners
          SET
            status = 'confirmed',
            claimed_at = COALESCE(claimed_at, @now),
            confirmed_at = COALESCE(confirmed_at, @now),
            selected_platform = @selectedPlatform,
            region_country = @regionCountry,
            delivery_method = @deliveryMethod,
            marketplace_used = @marketplaceUsed,
            purchase_status = @purchaseStatus,
            confirmation_notes = @notes
          WHERE id = @id
        `,
      )
      .run({
        id: winner.id,
        now,
        selectedPlatform: sanitizeShortText(
          input.selectedPlatform,
          "Selected platform",
          winner.selected_platform,
        ),
        regionCountry: sanitizeShortText(
          input.regionCountry,
          "Region/country",
          winner.region_country,
        ),
        deliveryMethod: sanitizeShortText(
          input.deliveryMethod,
          "Delivery method",
          winner.delivery_method,
        ),
        marketplaceUsed: sanitizeShortText(
          input.marketplaceUsed,
          "Marketplace used",
          winner.marketplace_used || giveaway.marketplace_name,
        ),
        purchaseStatus,
        notes: sanitizeText(input.notes ?? winner.confirmation_notes, {
          field: "Confirmation notes",
          maxLength: 300,
        }),
      });

    const updated = this.requireWinnerById(winner.id);
    this.audit(actor, "giveaway.confirm", String(giveaway.id), {
      winner: updated.login,
      selectedPlatform: updated.selected_platform,
      regionCountry: updated.region_country,
      deliveryMethod: updated.delivery_method,
      marketplaceUsed: updated.marketplace_used,
      purchaseStatus: updated.purchase_status,
    });

    return { giveaway, winner: updated };
  }

  expireWinner(actor: ChatMessage, username: string) {
    const giveaway = this.requireActiveGiveaway();
    const login = normalizeLogin(username);
    const winner = this.findActiveWinner(giveaway.id, login);

    if (!winner) {
      throw new Error(`No active winner found for ${login}`);
    }

    const now = timestamp();
    this.db
      .prepare(
        "UPDATE giveaway_winners SET status = 'expired', expired_at = COALESCE(expired_at, ?) WHERE id = ?",
      )
      .run(now, winner.id);
    const updated = this.requireWinnerById(winner.id);
    this.audit(actor, "giveaway.expire", String(giveaway.id), {
      winner: updated.login,
    });

    return { giveaway, winner: updated };
  }

  setPurchaseStatus(
    actor: ChatMessage,
    username: string,
    purchaseStatus: GiveawayPurchaseStatus | undefined,
  ) {
    const giveaway = this.requireActiveGiveaway();
    const login = normalizeLogin(username);
    const winner = this.findActiveWinner(giveaway.id, login);

    if (!winner) {
      throw new Error(`No active winner found for ${login}`);
    }

    const status = normalizePurchaseStatus(purchaseStatus);
    const deliveredAt =
      status === "delivered" || status === "activation_confirmed_optional"
        ? (winner.delivered_at ?? timestamp())
        : winner.delivered_at;
    const fulfillmentStatus =
      status === "delivered" || status === "activation_confirmed_optional"
        ? "fulfilled"
        : winner.fulfillment_status;

    this.db
      .prepare(
        "UPDATE giveaway_winners SET purchase_status = ?, delivered_at = ?, fulfillment_status = ? WHERE id = ?",
      )
      .run(status, deliveredAt, fulfillmentStatus, winner.id);
    const updated = this.requireWinnerById(winner.id);
    this.audit(actor, "giveaway.purchase_status", String(giveaway.id), {
      winner: updated.login,
      purchaseStatus: updated.purchase_status,
      fulfillmentStatus: updated.fulfillment_status,
    });

    return { giveaway, winner: updated };
  }

  deliver(actor: ChatMessage, username: string) {
    this.expirePendingWinners();
    const giveaway = this.requireActiveGiveaway();
    const login = normalizeLogin(username);
    const winner = this.findActiveWinner(giveaway.id, login);

    if (!winner) {
      throw new Error(`No active winner found for ${login}`);
    }

    const now = timestamp();
    this.db
      .prepare(
        "UPDATE giveaway_winners SET purchase_status = 'delivered', fulfillment_status = 'fulfilled', delivered_at = COALESCE(delivered_at, ?) WHERE id = ?",
      )
      .run(now, winner.id);

    const updated = this.requireWinnerById(winner.id);
    this.audit(actor, "giveaway.deliver", String(giveaway.id), {
      winner: updated.login,
    });
    this.logger.info(
      {
        operatorEvent: "giveaway winner delivered",
        giveawayId: giveaway.id,
        winner: updated.login,
        winnerUserId: updated.twitch_user_id,
        actor: actor.userLogin,
        mode: actor.source,
      },
      "Giveaway winner delivered",
    );

    return { giveaway, winner: updated };
  }

  deliverAll(actor: ChatMessage) {
    this.expirePendingWinners();
    const giveaway = this.requireActiveGiveaway();
    const winners = this.getWinners(giveaway.id).filter(
      (winner) => !winner.rerolled_at && !winner.delivered_at,
    );
    const now = timestamp();

    for (const winner of winners) {
      this.db
        .prepare(
          "UPDATE giveaway_winners SET purchase_status = 'delivered', fulfillment_status = 'fulfilled', delivered_at = COALESCE(delivered_at, ?) WHERE id = ?",
        )
        .run(now, winner.id);
    }

    this.audit(actor, "giveaway.deliver_all", String(giveaway.id), {
      winners: winners.map((winner) => winner.login),
      deliveredCount: winners.length,
    });
    this.logger.info(
      {
        operatorEvent: "giveaway winners delivered",
        giveawayId: giveaway.id,
        deliveredCount: winners.length,
        winners: winners.map((winner) => winner.login),
        actor: actor.userLogin,
        mode: actor.source,
      },
      "Giveaway winners delivered",
    );

    return {
      giveaway,
      winners: this.getWinners(giveaway.id).filter(
        (winner) => !winner.rerolled_at,
      ),
      deliveredCount: winners.length,
    };
  }

  end(actor: ChatMessage) {
    const giveaway = this.requireActiveGiveaway();
    const unresolvedWinners = this.getUnresolvedWinners(giveaway.id);
    const winners = this.getWinners(giveaway.id);

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
      this.logger.warn(winnerSummary, "Giveaway winner summary before end");
    } else {
      this.logger.info(winnerSummary, "Giveaway winner summary before end");
    }

    this.db
      .prepare(
        "UPDATE giveaways SET status = 'ended', ended_at = ? WHERE id = ?",
      )
      .run(timestamp(), giveaway.id);

    const ended = this.requireGiveawayById(giveaway.id);
    this.audit(actor, "giveaway.end", String(giveaway.id), {});
    this.logger.info(
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
  }

  getOperatorState() {
    this.expireEntryTimers();
    this.expirePendingWinners();
    const giveaway = this.getActiveGiveaway();

    if (!giveaway) {
      return {
        giveaway: undefined,
        entries: [] as GiveawayEntry[],
        winners: [] as GiveawayWinner[],
        counts: {
          entries: 0,
          activeWinners: 0,
          rerolledWinners: 0,
        },
      };
    }

    return {
      giveaway,
      entries: this.getEntries(giveaway.id),
      winners: this.getWinners(giveaway.id),
      counts: {
        entries: this.countEntries(giveaway.id),
        activeWinners: this.countActiveWinners(giveaway.id),
        rerolledWinners: this.countRerolledWinners(giveaway.id),
      },
    };
  }

  getLatestGiveawayState() {
    this.expireEntryTimers();
    this.expirePendingWinners();
    const giveaway = this.getLatestGiveaway();

    if (!giveaway) {
      return {
        giveaway: undefined,
        entries: [] as GiveawayEntry[],
        winners: [] as GiveawayWinner[],
        counts: {
          entries: 0,
          activeWinners: 0,
          rerolledWinners: 0,
        },
      };
    }

    return {
      giveaway,
      entries: this.getEntries(giveaway.id),
      winners: this.getWinners(giveaway.id),
      counts: {
        entries: this.countEntries(giveaway.id),
        activeWinners: this.countActiveWinners(giveaway.id),
        rerolledWinners: this.countRerolledWinners(giveaway.id),
      },
    };
  }

  getRecentAuditLogs(limit = 100) {
    return getRecentAuditLogs(this.db, limit);
  }

  updateConfig(actor: ChatMessage, input: Partial<StartGiveawayInput>) {
    const giveaway = this.requireActiveGiveaway();
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

    this.db
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

    const updated = this.requireGiveawayById(giveaway.id);
    this.audit(actor, "giveaway.config_update", String(giveaway.id), config);
    return updated;
  }

  startEntryTimer(actor: ChatMessage, minutes?: number) {
    const giveaway = this.requireActiveGiveaway();

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
    this.db
      .prepare(
        "UPDATE giveaways SET entry_window_minutes = ?, entries_close_at = ?, timer_started_at = ? WHERE id = ?",
      )
      .run(windowMinutes, entriesCloseAt, now, giveaway.id);
    this.audit(actor, "giveaway.timer_start", String(giveaway.id), {
      entryWindowMinutes: windowMinutes,
      entriesCloseAt,
    });
    return this.requireGiveawayById(giveaway.id);
  }

  stopEntryTimer(actor: ChatMessage) {
    const giveaway = this.requireActiveGiveaway();
    this.db
      .prepare(
        "UPDATE giveaways SET entries_close_at = NULL, timer_started_at = NULL WHERE id = ?",
      )
      .run(giveaway.id);
    this.audit(actor, "giveaway.timer_stop", String(giveaway.id), {});
    return this.requireGiveawayById(giveaway.id);
  }

  resetEntryTimer(actor: ChatMessage, minutes?: number) {
    return this.startEntryTimer(actor, minutes);
  }

  removeEntrant(actor: ChatMessage, username: string, reason?: string) {
    const giveaway = this.requireActiveGiveaway();
    const login = normalizeLogin(username);
    const removedAt = timestamp();
    const removalReason = sanitizeText(reason ?? "Removed by operator", {
      field: "Removal reason",
      maxLength: 160,
    });
    const result = this.db
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

    this.audit(actor, "giveaway.entry_removed", String(giveaway.id), {
      entrant: login,
      reason: removalReason,
    });
    return { giveaway: this.requireGiveawayById(giveaway.id), removed: login };
  }

  exportResults() {
    const state = this.getLatestGiveawayState();
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
      audit: this.getRecentAuditLogs(100).filter(
        (log) => log.target === String(giveaway.id),
      ),
    };
  }

  countEntriesForGiveaway(giveawayId: number) {
    return this.countEntries(giveawayId);
  }

  getWinnersForGiveaway(giveawayId: number) {
    return this.getWinners(giveawayId);
  }

  private getActiveGiveaway() {
    return this.db
      .prepare(
        "SELECT * FROM giveaways WHERE status IN ('open', 'closed') ORDER BY id DESC LIMIT 1",
      )
      .get() as Giveaway | undefined;
  }

  private getGiveawayById(id: number) {
    return this.db.prepare("SELECT * FROM giveaways WHERE id = ?").get(id) as
      | Giveaway
      | undefined;
  }

  private getLatestGiveaway() {
    return this.db
      .prepare("SELECT * FROM giveaways ORDER BY id DESC LIMIT 1")
      .get() as Giveaway | undefined;
  }

  private requireGiveawayById(id: number) {
    const giveaway = this.getGiveawayById(id);

    if (!giveaway) {
      throw new Error(`Giveaway #${id} was not found`);
    }

    return giveaway;
  }

  private requireWinnerById(id: number) {
    const winner = this.db
      .prepare("SELECT * FROM giveaway_winners WHERE id = ?")
      .get(id) as GiveawayWinner | undefined;

    if (!winner) {
      throw new Error(`Winner #${id} was not found`);
    }

    return winner;
  }

  private requireActiveGiveaway() {
    const giveaway = this.getActiveGiveaway();

    if (!giveaway) {
      throw new Error("No active giveaway");
    }

    return giveaway;
  }

  private countEntries(giveawayId: number) {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM giveaway_entries WHERE giveaway_id = ? AND removed_at IS NULL AND eligibility_status = 'eligible'",
      )
      .get(giveawayId) as { count: number };

    return row.count;
  }

  private countActiveWinners(giveawayId: number) {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM giveaway_winners WHERE giveaway_id = ? AND rerolled_at IS NULL",
      )
      .get(giveawayId) as { count: number };

    return row.count;
  }

  private countRerolledWinners(giveawayId: number) {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM giveaway_winners WHERE giveaway_id = ? AND rerolled_at IS NOT NULL",
      )
      .get(giveawayId) as { count: number };

    return row.count;
  }

  private getDrawableEntries(giveawayId: number) {
    return this.db
      .prepare(
        `
          SELECT e.*
          FROM giveaway_entries e
          WHERE e.giveaway_id = ?
            AND e.removed_at IS NULL
            AND e.eligibility_status = 'eligible'
            AND NOT EXISTS (
              SELECT 1
              FROM giveaway_winners w
              WHERE w.giveaway_id = e.giveaway_id
                AND w.twitch_user_id = e.twitch_user_id
            )
        `,
      )
      .all(giveawayId) as GiveawayEntry[];
  }

  private getEntries(giveawayId: number) {
    return this.db
      .prepare(
        `
          SELECT *
          FROM giveaway_entries
          WHERE giveaway_id = ?
          ORDER BY entered_at ASC
        `,
      )
      .all(giveawayId) as GiveawayEntry[];
  }

  private getUnresolvedWinners(giveawayId: number) {
    return this.db
      .prepare(
        `
          SELECT *
          FROM giveaway_winners
          WHERE giveaway_id = ?
            AND rerolled_at IS NULL
            AND delivered_at IS NULL
        `,
      )
      .all(giveawayId) as GiveawayWinner[];
  }

  private getWinners(giveawayId: number) {
    return this.db
      .prepare(
        `
          SELECT *
          FROM giveaway_winners
          WHERE giveaway_id = ?
          ORDER BY id ASC
        `,
      )
      .all(giveawayId) as GiveawayWinner[];
  }

  private insertWinner(giveaway: Giveaway, entry: GiveawayEntry, seed: string) {
    const now = timestamp();
    const responseExpiresAt = addMinutes(now, giveaway.response_window_minutes);
    const result = this.db
      .prepare(
        `
          INSERT INTO giveaway_winners
            (
              giveaway_id,
              twitch_user_id,
              login,
              display_name,
              drawn_at,
              status,
              response_expires_at,
              marketplace_used,
              purchase_status,
              fulfillment_status,
              draw_seed
            )
          VALUES
            (
              @giveawayId,
              @twitchUserId,
              @login,
              @displayName,
              @drawnAt,
              'pending_confirmation',
              @responseExpiresAt,
              @marketplaceUsed,
              'not_purchased',
              'not_fulfilled',
              @drawSeed
            )
        `,
      )
      .run({
        giveawayId: giveaway.id,
        twitchUserId: entry.twitch_user_id,
        login: entry.login,
        displayName: entry.display_name,
        drawnAt: now,
        responseExpiresAt,
        marketplaceUsed: giveaway.marketplace_name,
        drawSeed: seed,
      });

    return this.db
      .prepare("SELECT * FROM giveaway_winners WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as GiveawayWinner;
  }

  private findActiveWinner(giveawayId: number, username: string) {
    const normalized = username.replace(/^@/, "").toLowerCase();

    return this.db
      .prepare(
        `
          SELECT *
          FROM giveaway_winners
          WHERE giveaway_id = ?
            AND rerolled_at IS NULL
            AND lower(login) = ?
          LIMIT 1
        `,
      )
      .get(giveawayId, normalized) as GiveawayWinner | undefined;
  }

  private expireEntryTimers() {
    const giveaway = this.getActiveGiveaway();

    if (
      !giveaway ||
      giveaway.status !== "open" ||
      !giveaway.entries_close_at ||
      Date.parse(giveaway.entries_close_at) > Date.now()
    ) {
      return;
    }

    const closedAt = timestamp();
    this.db
      .prepare(
        "UPDATE giveaways SET status = 'closed', closed_at = COALESCE(closed_at, ?) WHERE id = ?",
      )
      .run(closedAt, giveaway.id);
    this.audit(
      systemActor(),
      "giveaway.timer_auto_close",
      String(giveaway.id),
      {
        entriesCloseAt: giveaway.entries_close_at,
      },
    );
    this.logger.info(
      {
        operatorEvent: "giveaway timer auto closed entries",
        giveawayId: giveaway.id,
        entriesCloseAt: giveaway.entries_close_at,
      },
      "Giveaway timer auto closed entries",
    );
  }

  private expirePendingWinners() {
    const giveaway = this.getActiveGiveaway();

    if (!giveaway) {
      return;
    }

    const now = timestamp();
    const expired = this.db
      .prepare(
        `
          SELECT *
          FROM giveaway_winners
          WHERE giveaway_id = ?
            AND rerolled_at IS NULL
            AND status = 'pending_confirmation'
            AND response_expires_at IS NOT NULL
            AND response_expires_at <= ?
        `,
      )
      .all(giveaway.id, now) as GiveawayWinner[];

    for (const winner of expired) {
      this.db
        .prepare(
          "UPDATE giveaway_winners SET status = 'expired', expired_at = COALESCE(expired_at, ?) WHERE id = ?",
        )
        .run(now, winner.id);
      this.audit(
        systemActor(),
        "giveaway.winner_auto_expired",
        String(giveaway.id),
        {
          winner: winner.login,
          responseExpiresAt: winner.response_expires_at,
        },
      );
    }
  }

  private validateOperatorEligibility(event: ChatMessage, giveaway: Giveaway) {
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
  }

  private previousWinnerIneligibility(
    giveaway: Giveaway,
    twitchUserId: string,
  ) {
    if (giveaway.previous_winner_restriction_mode === "none") {
      return undefined;
    }

    const previous = this.db
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
        giveaway.previous_winner_restriction_mode ===
          "base_game_blocks_deluxe" &&
        sameBaseGame(currentPrize, priorPrize)
      ) {
        return "Previous winner of this base game.";
      }
    }

    return undefined;
  }

  private audit(
    actor: ChatMessage,
    action: string,
    target: string,
    metadata: Record<string, unknown>,
  ) {
    writeAuditLog(this.db, actor, action, target, metadata);
  }
}

const timestamp = () => new Date().toISOString();

const addMinutes = (isoTimestamp: string, minutes: number) =>
  new Date(Date.parse(isoTimestamp) + minutes * 60_000).toISOString();

const defaultFollowAgeResolver: GiveawayFollowAgeResolver = async (
  event,
  giveaway,
) => {
  if (event.source === "local") {
    if (event.simulatedFollowVerified === false) {
      return {
        status: "unverified",
        checkedAt: timestamp(),
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
        checkedAt: timestamp(),
        followAgeDays,
        reason: "Simulated follow age is below the giveaway minimum.",
      };
    }

    return {
      status: "eligible",
      followedAt,
      checkedAt: timestamp(),
      followAgeDays,
    };
  }

  return {
    status: "unverified",
    checkedAt: timestamp(),
    reason: "Follow age lookup is not configured.",
  };
};

const normalizeGiveawayConfig = (
  input: Partial<StartGiveawayInput>,
  fallbackTitle: string,
) => {
  const itemName = sanitizeShortText(
    input.itemName,
    "Item name",
    fallbackTitle,
  );
  const gameName = sanitizeShortText(input.gameName, "Game name", itemName);
  const supportedPlatforms = normalizeSupportedPlatforms(
    input.supportedPlatforms,
  );

  return {
    itemName,
    itemEdition: sanitizeShortText(
      input.itemEdition,
      "Item edition",
      "Standard Edition",
    ),
    gameName,
    marketplaceName: sanitizeShortText(
      input.marketplaceName,
      "Marketplace name",
      "Eneba",
    ),
    marketplaceNote: sanitizeText(
      input.marketplaceNote ??
        "Key sourced after winner confirms platform/region.",
      {
        field: "Marketplace note",
        maxLength: 180,
      },
    ),
    platformMode: normalizePlatformMode(input.platformMode),
    supportedPlatformsJson: JSON.stringify(supportedPlatforms),
    prizeType: normalizePrizeType(input.prizeType),
    minimumFollowAgeDays: parseSafeInteger(input.minimumFollowAgeDays, {
      field: "Minimum follow age",
      fallback: 7,
      min: 0,
      max: 3650,
    }),
    mustBePresentToWin: input.mustBePresentToWin === false ? 0 : 1,
    responseWindowMinutes: parseSafeInteger(input.responseWindowMinutes, {
      field: "Response window",
      fallback: 7,
      min: 1,
      max: 240,
    }),
    oneEntryPerPerson: input.oneEntryPerPerson === false ? 0 : 1,
    allowExtraEntries: input.allowExtraEntries === true ? 1 : 0,
    previousWinnerRestrictionMode: normalizePreviousWinnerRestrictionMode(
      input.previousWinnerRestrictionMode,
    ),
    ageGuidanceText: sanitizeText(
      input.ageGuidanceText ??
        "Game is rated Mature. Please only enter if this is appropriate for you.",
      {
        field: "Age guidance",
        maxLength: 240,
      },
    ),
    regionAvailabilityDisclaimer: sanitizeText(
      input.regionAvailabilityDisclaimer ??
        "Prize availability depends on platform, region, and legitimate purchasable key availability.",
      {
        field: "Region availability disclaimer",
        maxLength: 240,
      },
    ),
    entryWindowMinutes: parseSafeInteger(input.entryWindowMinutes, {
      field: "Entry window",
      fallback: 10,
      min: 1,
      max: 240,
    }),
  };
};

const sanitizeShortText = (
  value: unknown,
  field: string,
  fallback = "",
  maxLength = 80,
) =>
  sanitizeText(value ?? fallback, {
    field,
    maxLength,
  });

const normalizeSupportedPlatforms = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [...defaultSupportedPlatforms];
  }

  const platforms = value
    .map((item) => sanitizeShortText(item, "Supported platform", "", 40))
    .filter(Boolean);

  return platforms.length
    ? platforms.slice(0, 12)
    : [...defaultSupportedPlatforms];
};

const normalizePlatformMode = (value: unknown): GiveawayPlatformMode =>
  value === "fixed_platform" ? "fixed_platform" : "winner_selects_after_win";

const normalizePrizeType = (value: unknown): GiveawayPrizeType => {
  if (value === "deluxe_game_key" || value === "dlc_key" || value === "other") {
    return value;
  }

  return "standard_game_key";
};

const normalizePreviousWinnerRestrictionMode = (
  value: unknown,
): GiveawayPreviousWinnerRestrictionMode => {
  if (value === "exact_item_only" || value === "none") {
    return value;
  }

  return "base_game_blocks_deluxe";
};

const normalizePurchaseStatus = (
  value: GiveawayPurchaseStatus | undefined,
): GiveawayPurchaseStatus => {
  if (
    value === "pending_purchase" ||
    value === "purchased" ||
    value === "delivered" ||
    value === "activation_confirmed_optional"
  ) {
    return value;
  }

  return "not_purchased";
};

const deterministicShuffle = <T>(items: T[], seed: string) =>
  [...items]
    .map((item, index) => ({
      item,
      sortKey: createHash("sha256")
        .update(`${seed}:${index}:${JSON.stringify(item)}`)
        .digest("hex"),
    }))
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
    .map((entry) => entry.item);

const parseJsonObject = (value: string) => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const normalizeIdentityText = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const prizeIdentity = (giveaway: Giveaway) => ({
  item: normalizeIdentityText(giveaway.item_name || giveaway.title),
  edition: normalizeIdentityText(giveaway.item_edition),
  game: normalizeIdentityText(
    giveaway.game_name || giveaway.item_name || giveaway.title,
  ),
  prizeType: giveaway.prize_type,
});

const sameExactPrize = (
  current: ReturnType<typeof prizeIdentity>,
  previous: ReturnType<typeof prizeIdentity>,
) =>
  Boolean(current.item && current.item === previous.item) &&
  Boolean(current.edition && current.edition === previous.edition);

const sameBaseGame = (
  current: ReturnType<typeof prizeIdentity>,
  previous: ReturnType<typeof prizeIdentity>,
) => Boolean(current.game && current.game === previous.game);

const redactedGiveaway = (giveaway: Giveaway) => ({
  id: giveaway.id,
  title: giveaway.title,
  keyword: giveaway.keyword,
  status: giveaway.status,
  winnerCount: giveaway.winner_count,
  itemName: giveaway.item_name,
  itemEdition: giveaway.item_edition,
  gameName: giveaway.game_name,
  marketplaceName: giveaway.marketplace_name,
  platformMode: giveaway.platform_mode,
  supportedPlatforms: parseSupportedPlatforms(giveaway),
  prizeType: giveaway.prize_type,
  minimumFollowAgeDays: giveaway.minimum_follow_age_days,
  responseWindowMinutes: giveaway.response_window_minutes,
  previousWinnerRestrictionMode: giveaway.previous_winner_restriction_mode,
  createdAt: giveaway.created_at,
  openedAt: giveaway.opened_at,
  closedAt: giveaway.closed_at,
  endedAt: giveaway.ended_at,
});

const redactedWinner = (winner: GiveawayWinner) => ({
  login: winner.login,
  displayName: winner.display_name,
  drawnAt: winner.drawn_at,
  status: winner.status,
  responseExpiresAt: winner.response_expires_at,
  confirmedAt: winner.confirmed_at,
  expiredAt: winner.expired_at,
  deliveredAt: winner.delivered_at,
  rerolledAt: winner.rerolled_at,
  selectedPlatform: winner.selected_platform,
  regionCountry: winner.region_country,
  deliveryMethod: winner.delivery_method,
  marketplaceUsed: winner.marketplace_used,
  purchaseStatus: winner.purchase_status,
  fulfillmentStatus: winner.fulfillment_status,
});

export const parseSupportedPlatforms = (giveaway: Giveaway) => {
  try {
    const parsed = JSON.parse(giveaway.supported_platforms_json) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === "string")
        .slice(0, 12);
    }
  } catch {
    // fall through to defaults
  }

  return [...defaultSupportedPlatforms];
};

const systemActor = (): ChatMessage => ({
  id: "giveaway-system",
  text: "",
  userId: "giveaway-system",
  userLogin: "giveaway-system",
  userDisplayName: "Giveaway System",
  broadcasterUserId: "giveaway-system",
  badges: [],
  isBroadcaster: false,
  isMod: false,
  isVip: false,
  isSubscriber: false,
  source: "local",
  receivedAt: new Date(),
});
