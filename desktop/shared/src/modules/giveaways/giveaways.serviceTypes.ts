import type { ChatMessage } from "../../core/chatMessage";
import type { Logger } from "../../core/logger";
import type { DbClient } from "../../db/client";
import type {
  Giveaway,
  GiveawayPlatformMode,
  GiveawayPreviousWinnerRestrictionMode,
  GiveawayPrizeType,
  GiveawayPurchaseStatus,
  GiveawayWinner,
} from "./giveaways.types";

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

export type StartGiveawayInput = {
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

export type DrawResult = {
  giveaway: Giveaway;
  winners: GiveawayWinner[];
  requestedCount: number;
  eligibleCount: number;
  seed?: string;
};

export type GiveawaysServiceOptions = {
  db: DbClient;
  logger: Logger;
  followAgeResolver?: GiveawayFollowAgeResolver;
};

export type GiveawaysServiceContext = {
  db: DbClient;
  logger: Logger;
  followAgeResolver: GiveawayFollowAgeResolver;
};
