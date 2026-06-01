import { createHash } from "node:crypto";
import type { ChatMessage } from "../../core/chatMessage";
import { limits, parseSafeInteger, sanitizeText } from "../../core/security";
import type {
  Giveaway,
  GiveawayPlatformMode,
  GiveawayPreviousWinnerRestrictionMode,
  GiveawayPrizeType,
  GiveawayPurchaseStatus,
  GiveawayWinner,
} from "./giveaways.types";
import type {
  GiveawayFollowAgeResolver,
  StartGiveawayInput,
} from "./giveaways.serviceTypes";

export const defaultSupportedPlatforms = [
  "Steam",
  "Xbox",
  "PlayStation",
  "Epic",
  "Other / manual",
] as const;

export const timestamp = () => new Date().toISOString();

export const addMinutes = (isoTimestamp: string, minutes: number) =>
  new Date(Date.parse(isoTimestamp) + minutes * 60_000).toISOString();

export const defaultFollowAgeResolver: GiveawayFollowAgeResolver = async (
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

export const normalizeGiveawayConfig = (
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

export const sanitizeShortText = (
  value: unknown,
  field: string,
  fallback = "",
  maxLength = 80,
) =>
  sanitizeText(value ?? fallback, {
    field,
    maxLength,
  });

export const normalizeSupportedPlatforms = (value: unknown) => {
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

export const normalizePlatformMode = (value: unknown): GiveawayPlatformMode =>
  value === "fixed_platform" ? "fixed_platform" : "winner_selects_after_win";

export const normalizePrizeType = (value: unknown): GiveawayPrizeType => {
  if (value === "deluxe_game_key" || value === "dlc_key" || value === "other") {
    return value;
  }

  return "standard_game_key";
};

export const normalizePreviousWinnerRestrictionMode = (
  value: unknown,
): GiveawayPreviousWinnerRestrictionMode => {
  if (value === "exact_item_only" || value === "none") {
    return value;
  }

  return "base_game_blocks_deluxe";
};

export const normalizePurchaseStatus = (
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

export const deterministicShuffle = <T>(items: T[], seed: string) =>
  [...items]
    .map((item, index) => ({
      item,
      sortKey: createHash("sha256")
        .update(`${seed}:${index}:${JSON.stringify(item)}`)
        .digest("hex"),
    }))
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
    .map((entry) => entry.item);

export const parseJsonObject = (value: string) => {
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

export const prizeIdentity = (giveaway: Giveaway) => ({
  item: normalizeIdentityText(giveaway.item_name || giveaway.title),
  edition: normalizeIdentityText(giveaway.item_edition),
  game: normalizeIdentityText(
    giveaway.game_name || giveaway.item_name || giveaway.title,
  ),
  prizeType: giveaway.prize_type,
});

export const sameExactPrize = (
  current: ReturnType<typeof prizeIdentity>,
  previous: ReturnType<typeof prizeIdentity>,
) =>
  Boolean(current.item && current.item === previous.item) &&
  Boolean(current.edition && current.edition === previous.edition);

export const sameBaseGame = (
  current: ReturnType<typeof prizeIdentity>,
  previous: ReturnType<typeof prizeIdentity>,
) => Boolean(current.game && current.game === previous.game);

export const redactedGiveaway = (giveaway: Giveaway) => ({
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

export const redactedWinner = (winner: GiveawayWinner) => ({
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

export const systemActor = (): ChatMessage => ({
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

export { limits, parseSafeInteger };
