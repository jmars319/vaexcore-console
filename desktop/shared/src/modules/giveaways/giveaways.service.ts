import type { ChatMessage } from "../../core/chatMessage";
import {
  defaultFollowAgeResolver,
  defaultSupportedPlatforms,
  parseSupportedPlatforms,
} from "./giveaways.helpers";
import {
  startGiveaway,
  closeGiveaway,
  startGiveawayEntryTimer,
  stopGiveawayEntryTimer,
  updateGiveawayConfig,
} from "./giveaways.lifecycle";
import {
  addSimulatedGiveawayEntrant,
  enterGiveaway,
  removeGiveawayEntrant,
} from "./giveaways.entries";
import { drawGiveawayWinners, rerollGiveawayWinner } from "./giveaways.draw";
import {
  claimGiveawayWinner,
  confirmGiveawayWinner,
  deliverAllGiveawayWinners,
  deliverGiveawayWinner,
  expireGiveawayWinner,
  setGiveawayPurchaseStatus,
} from "./giveaways.winners";
import {
  countEntriesForGiveaway,
  endGiveaway,
  exportGiveawayResults,
  getGiveawayOperatorState,
  getGiveawayRecentAuditLogs,
  getGiveawayStatus,
  getLatestGiveawayState,
  getWinnersForGiveaway,
} from "./giveaways.state";
import type { GiveawayPurchaseStatus } from "./giveaways.types";
import type {
  GiveawaysServiceContext,
  GiveawaysServiceOptions,
  StartGiveawayInput,
} from "./giveaways.serviceTypes";

export { defaultSupportedPlatforms, parseSupportedPlatforms };
export type {
  DrawResult,
  GiveawayFollowAgeResolver,
  GiveawayFollowAgeResult,
} from "./giveaways.serviceTypes";

export class GiveawaysService {
  private readonly context: GiveawaysServiceContext;

  constructor(options: GiveawaysServiceOptions) {
    this.context = {
      db: options.db,
      logger: options.logger,
      followAgeResolver: options.followAgeResolver ?? defaultFollowAgeResolver,
    };
  }

  start(input: StartGiveawayInput) {
    return startGiveaway(this.context, input);
  }

  async enter(event: ChatMessage, keyword: string) {
    return enterGiveaway(this.context, event, keyword);
  }

  async addSimulatedEntrant(actor: ChatMessage, entrant: ChatMessage) {
    return addSimulatedGiveawayEntrant(this.context, actor, entrant);
  }

  status() {
    return getGiveawayStatus(this.context);
  }

  close(actor: ChatMessage) {
    return closeGiveaway(this.context, actor);
  }

  draw(
    actor: ChatMessage,
    requestedCount?: number,
    options: { allowOpen?: boolean } = {},
  ) {
    return drawGiveawayWinners(this.context, actor, requestedCount, options);
  }

  reroll(actor: ChatMessage, username: string) {
    return rerollGiveawayWinner(this.context, actor, username);
  }

  claim(actor: ChatMessage, username: string) {
    return claimGiveawayWinner(this.context, actor, username);
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
    return confirmGiveawayWinner(this.context, actor, username, input);
  }

  expireWinner(actor: ChatMessage, username: string) {
    return expireGiveawayWinner(this.context, actor, username);
  }

  setPurchaseStatus(
    actor: ChatMessage,
    username: string,
    purchaseStatus: GiveawayPurchaseStatus | undefined,
  ) {
    return setGiveawayPurchaseStatus(
      this.context,
      actor,
      username,
      purchaseStatus,
    );
  }

  deliver(actor: ChatMessage, username: string) {
    return deliverGiveawayWinner(this.context, actor, username);
  }

  deliverAll(actor: ChatMessage) {
    return deliverAllGiveawayWinners(this.context, actor);
  }

  end(actor: ChatMessage) {
    return endGiveaway(this.context, actor);
  }

  getOperatorState() {
    return getGiveawayOperatorState(this.context);
  }

  getLatestGiveawayState() {
    return getLatestGiveawayState(this.context);
  }

  getRecentAuditLogs(limit = 100) {
    return getGiveawayRecentAuditLogs(this.context, limit);
  }

  updateConfig(actor: ChatMessage, input: Partial<StartGiveawayInput>) {
    return updateGiveawayConfig(this.context, actor, input);
  }

  startEntryTimer(actor: ChatMessage, minutes?: number) {
    return startGiveawayEntryTimer(this.context, actor, minutes);
  }

  stopEntryTimer(actor: ChatMessage) {
    return stopGiveawayEntryTimer(this.context, actor);
  }

  resetEntryTimer(actor: ChatMessage, minutes?: number) {
    return this.startEntryTimer(actor, minutes);
  }

  removeEntrant(actor: ChatMessage, username: string, reason?: string) {
    return removeGiveawayEntrant(this.context, actor, username, reason);
  }

  exportResults() {
    return exportGiveawayResults(this.context);
  }

  countEntriesForGiveaway(giveawayId: number) {
    return countEntriesForGiveaway(this.context, giveawayId);
  }

  getWinnersForGiveaway(giveawayId: number) {
    return getWinnersForGiveaway(this.context, giveawayId);
  }
}
