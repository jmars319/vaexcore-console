import { addMinutes, timestamp } from "./giveaways.helpers";
import type {
  Giveaway,
  GiveawayEntry,
  GiveawayWinner,
} from "./giveaways.types";
import type { GiveawaysServiceContext } from "./giveaways.serviceTypes";

export const getActiveGiveaway = (context: GiveawaysServiceContext) =>
  context.db
    .prepare(
      "SELECT * FROM giveaways WHERE status IN ('open', 'closed') ORDER BY id DESC LIMIT 1",
    )
    .get() as Giveaway | undefined;

export const getGiveawayById = (context: GiveawaysServiceContext, id: number) =>
  context.db.prepare("SELECT * FROM giveaways WHERE id = ?").get(id) as
    | Giveaway
    | undefined;

export const getLatestGiveaway = (context: GiveawaysServiceContext) =>
  context.db
    .prepare("SELECT * FROM giveaways ORDER BY id DESC LIMIT 1")
    .get() as Giveaway | undefined;

export const requireGiveawayById = (
  context: GiveawaysServiceContext,
  id: number,
) => {
  const giveaway = getGiveawayById(context, id);

  if (!giveaway) {
    throw new Error(`Giveaway #${id} was not found`);
  }

  return giveaway;
};

export const requireActiveGiveaway = (context: GiveawaysServiceContext) => {
  const giveaway = getActiveGiveaway(context);

  if (!giveaway) {
    throw new Error("No active giveaway");
  }

  return giveaway;
};

export const requireWinnerById = (
  context: GiveawaysServiceContext,
  id: number,
) => {
  const winner = context.db
    .prepare("SELECT * FROM giveaway_winners WHERE id = ?")
    .get(id) as GiveawayWinner | undefined;

  if (!winner) {
    throw new Error(`Winner #${id} was not found`);
  }

  return winner;
};

export const countEntries = (
  context: GiveawaysServiceContext,
  giveawayId: number,
) => {
  const row = context.db
    .prepare(
      "SELECT COUNT(*) AS count FROM giveaway_entries WHERE giveaway_id = ? AND removed_at IS NULL AND eligibility_status = 'eligible'",
    )
    .get(giveawayId) as { count: number };

  return row.count;
};

export const countActiveWinners = (
  context: GiveawaysServiceContext,
  giveawayId: number,
) => {
  const row = context.db
    .prepare(
      "SELECT COUNT(*) AS count FROM giveaway_winners WHERE giveaway_id = ? AND rerolled_at IS NULL",
    )
    .get(giveawayId) as { count: number };

  return row.count;
};

export const countRerolledWinners = (
  context: GiveawaysServiceContext,
  giveawayId: number,
) => {
  const row = context.db
    .prepare(
      "SELECT COUNT(*) AS count FROM giveaway_winners WHERE giveaway_id = ? AND rerolled_at IS NOT NULL",
    )
    .get(giveawayId) as { count: number };

  return row.count;
};

export const getDrawableEntries = (
  context: GiveawaysServiceContext,
  giveawayId: number,
) =>
  context.db
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

export const getEntries = (
  context: GiveawaysServiceContext,
  giveawayId: number,
) =>
  context.db
    .prepare(
      `
        SELECT *
        FROM giveaway_entries
        WHERE giveaway_id = ?
        ORDER BY entered_at ASC
      `,
    )
    .all(giveawayId) as GiveawayEntry[];

export const getUnresolvedWinners = (
  context: GiveawaysServiceContext,
  giveawayId: number,
) =>
  context.db
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

export const getWinners = (
  context: GiveawaysServiceContext,
  giveawayId: number,
) =>
  context.db
    .prepare(
      `
        SELECT *
        FROM giveaway_winners
        WHERE giveaway_id = ?
        ORDER BY id ASC
      `,
    )
    .all(giveawayId) as GiveawayWinner[];

export const insertWinner = (
  context: GiveawaysServiceContext,
  giveaway: Giveaway,
  entry: GiveawayEntry,
  seed: string,
) => {
  const now = timestamp();
  const responseExpiresAt = addMinutes(now, giveaway.response_window_minutes);
  const result = context.db
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

  return context.db
    .prepare("SELECT * FROM giveaway_winners WHERE id = ?")
    .get(Number(result.lastInsertRowid)) as GiveawayWinner;
};

export const findActiveWinner = (
  context: GiveawaysServiceContext,
  giveawayId: number,
  username: string,
) => {
  const normalized = username.replace(/^@/, "").toLowerCase();

  return context.db
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
};
