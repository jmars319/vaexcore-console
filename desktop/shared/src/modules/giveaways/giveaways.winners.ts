import type { ChatMessage } from "../../core/chatMessage";
import { normalizeLogin, sanitizeText } from "../../core/security";
import { auditGiveaway } from "./giveaways.audit";
import { expirePendingWinners } from "./giveaways.expiration";
import {
  normalizePurchaseStatus,
  sanitizeShortText,
  timestamp,
} from "./giveaways.helpers";
import {
  findActiveWinner,
  getWinners,
  requireActiveGiveaway,
  requireWinnerById,
} from "./giveaways.repository";
import type { GiveawayPurchaseStatus } from "./giveaways.types";
import type { GiveawaysServiceContext } from "./giveaways.serviceTypes";

export const claimGiveawayWinner = (
  context: GiveawaysServiceContext,
  actor: ChatMessage,
  username: string,
) => {
  expirePendingWinners(context);
  const giveaway = requireActiveGiveaway(context);
  const login = normalizeLogin(username);
  const winner = findActiveWinner(context, giveaway.id, login);

  if (!winner) {
    throw new Error(`No active winner found for ${login}`);
  }

  const now = timestamp();
  context.db
    .prepare(
      "UPDATE giveaway_winners SET status = 'confirmed', claimed_at = COALESCE(claimed_at, ?), confirmed_at = COALESCE(confirmed_at, ?) WHERE id = ?",
    )
    .run(now, now, winner.id);

  const updated = requireWinnerById(context, winner.id);
  auditGiveaway(context, actor, "giveaway.claim", String(giveaway.id), {
    winner: updated.login,
  });
  context.logger.info(
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
};

export const confirmGiveawayWinner = (
  context: GiveawaysServiceContext,
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
) => {
  expirePendingWinners(context);
  const giveaway = requireActiveGiveaway(context);
  const login = normalizeLogin(username);
  const winner = findActiveWinner(context, giveaway.id, login);

  if (!winner) {
    throw new Error(`No active winner found for ${login}`);
  }

  const now = timestamp();
  const purchaseStatus = normalizePurchaseStatus(input.purchaseStatus);
  context.db
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

  const updated = requireWinnerById(context, winner.id);
  auditGiveaway(context, actor, "giveaway.confirm", String(giveaway.id), {
    winner: updated.login,
    selectedPlatform: updated.selected_platform,
    regionCountry: updated.region_country,
    deliveryMethod: updated.delivery_method,
    marketplaceUsed: updated.marketplace_used,
    purchaseStatus: updated.purchase_status,
  });

  return { giveaway, winner: updated };
};

export const expireGiveawayWinner = (
  context: GiveawaysServiceContext,
  actor: ChatMessage,
  username: string,
) => {
  const giveaway = requireActiveGiveaway(context);
  const login = normalizeLogin(username);
  const winner = findActiveWinner(context, giveaway.id, login);

  if (!winner) {
    throw new Error(`No active winner found for ${login}`);
  }

  const now = timestamp();
  context.db
    .prepare(
      "UPDATE giveaway_winners SET status = 'expired', expired_at = COALESCE(expired_at, ?) WHERE id = ?",
    )
    .run(now, winner.id);
  const updated = requireWinnerById(context, winner.id);
  auditGiveaway(context, actor, "giveaway.expire", String(giveaway.id), {
    winner: updated.login,
  });

  return { giveaway, winner: updated };
};

export const setGiveawayPurchaseStatus = (
  context: GiveawaysServiceContext,
  actor: ChatMessage,
  username: string,
  purchaseStatus: GiveawayPurchaseStatus | undefined,
) => {
  const giveaway = requireActiveGiveaway(context);
  const login = normalizeLogin(username);
  const winner = findActiveWinner(context, giveaway.id, login);

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

  context.db
    .prepare(
      "UPDATE giveaway_winners SET purchase_status = ?, delivered_at = ?, fulfillment_status = ? WHERE id = ?",
    )
    .run(status, deliveredAt, fulfillmentStatus, winner.id);
  const updated = requireWinnerById(context, winner.id);
  auditGiveaway(
    context,
    actor,
    "giveaway.purchase_status",
    String(giveaway.id),
    {
      winner: updated.login,
      purchaseStatus: updated.purchase_status,
      fulfillmentStatus: updated.fulfillment_status,
    },
  );

  return { giveaway, winner: updated };
};

export const deliverGiveawayWinner = (
  context: GiveawaysServiceContext,
  actor: ChatMessage,
  username: string,
) => {
  expirePendingWinners(context);
  const giveaway = requireActiveGiveaway(context);
  const login = normalizeLogin(username);
  const winner = findActiveWinner(context, giveaway.id, login);

  if (!winner) {
    throw new Error(`No active winner found for ${login}`);
  }

  const now = timestamp();
  context.db
    .prepare(
      "UPDATE giveaway_winners SET purchase_status = 'delivered', fulfillment_status = 'fulfilled', delivered_at = COALESCE(delivered_at, ?) WHERE id = ?",
    )
    .run(now, winner.id);

  const updated = requireWinnerById(context, winner.id);
  auditGiveaway(context, actor, "giveaway.deliver", String(giveaway.id), {
    winner: updated.login,
  });
  context.logger.info(
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
};

export const deliverAllGiveawayWinners = (
  context: GiveawaysServiceContext,
  actor: ChatMessage,
) => {
  expirePendingWinners(context);
  const giveaway = requireActiveGiveaway(context);
  const winners = getWinners(context, giveaway.id).filter(
    (winner) => !winner.rerolled_at && !winner.delivered_at,
  );
  const now = timestamp();

  for (const winner of winners) {
    context.db
      .prepare(
        "UPDATE giveaway_winners SET purchase_status = 'delivered', fulfillment_status = 'fulfilled', delivered_at = COALESCE(delivered_at, ?) WHERE id = ?",
      )
      .run(now, winner.id);
  }

  auditGiveaway(context, actor, "giveaway.deliver_all", String(giveaway.id), {
    winners: winners.map((winner) => winner.login),
    deliveredCount: winners.length,
  });
  context.logger.info(
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
    winners: getWinners(context, giveaway.id).filter(
      (winner) => !winner.rerolled_at,
    ),
    deliveredCount: winners.length,
  };
};
