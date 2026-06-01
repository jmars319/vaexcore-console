import { auditGiveaway } from "./giveaways.audit";
import { systemActor, timestamp } from "./giveaways.helpers";
import { getActiveGiveaway } from "./giveaways.repository";
import type { GiveawayWinner } from "./giveaways.types";
import type { GiveawaysServiceContext } from "./giveaways.serviceTypes";

export const expireEntryTimers = (context: GiveawaysServiceContext) => {
  const giveaway = getActiveGiveaway(context);

  if (
    !giveaway ||
    giveaway.status !== "open" ||
    !giveaway.entries_close_at ||
    Date.parse(giveaway.entries_close_at) > Date.now()
  ) {
    return;
  }

  const closedAt = timestamp();
  context.db
    .prepare(
      "UPDATE giveaways SET status = 'closed', closed_at = COALESCE(closed_at, ?) WHERE id = ?",
    )
    .run(closedAt, giveaway.id);
  auditGiveaway(
    context,
    systemActor(),
    "giveaway.timer_auto_close",
    String(giveaway.id),
    { entriesCloseAt: giveaway.entries_close_at },
  );
  context.logger.info(
    {
      operatorEvent: "giveaway timer auto closed entries",
      giveawayId: giveaway.id,
      entriesCloseAt: giveaway.entries_close_at,
    },
    "Giveaway timer auto closed entries",
  );
};

export const expirePendingWinners = (context: GiveawaysServiceContext) => {
  const giveaway = getActiveGiveaway(context);

  if (!giveaway) {
    return;
  }

  const now = timestamp();
  const expired = context.db
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
    context.db
      .prepare(
        "UPDATE giveaway_winners SET status = 'expired', expired_at = COALESCE(expired_at, ?) WHERE id = ?",
      )
      .run(now, winner.id);
    auditGiveaway(
      context,
      systemActor(),
      "giveaway.winner_auto_expired",
      String(giveaway.id),
      {
        winner: winner.login,
        responseExpiresAt: winner.response_expires_at,
      },
    );
  }
};
