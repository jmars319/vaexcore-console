import {
  CustomCommandsService,
  getReservedCustomCommandNames,
} from "../modules/commands/commands.service";
import {
  GiveawaysService,
  parseSupportedPlatforms,
  type GiveawayFollowAgeResolver,
} from "../modules/giveaways/giveaways.service";
import {
  MessageQueue,
  type MessageQueueEventStatus,
  type MessageQueueMetadata,
} from "../core/messageQueue";
import {
  classifyOutboundMessage,
  createOutboundHistory,
  isOutboundCategory,
  isOutboundFailureCategory,
  isOutboundImportance,
  isPendingOutboundStatus,
  type OutboundMessageRecord,
} from "../core/outboundHistory";
import {
  createFeatureGateStore,
  type FeatureGateState,
  type FeatureGateMode,
  type FeatureKey,
} from "../core/featureGates";
import {
  loadStudioIntegrationConfig,
  StudioClient,
  type StudioMarkerInput,
} from "../studio/client";
import { ModerationService } from "../modules/moderation/moderation.module";
import { TimersService, timerMetadata } from "../modules/timers/timers.module";
import { URL } from "node:url";
import { createDbClient, resolveDatabasePath } from "../db/client";
import { createGiveawayTemplateStore } from "../modules/giveaways/giveaways.templates";
import { createLogger } from "../core/logger";
import { createOperatorMessageTemplateStore } from "../core/operatorMessages";
import { createRuntimeStatus } from "../core/runtimeStatus";
import { createBotProcessState } from "./serverBotProcess";
import { resolveGiveawayFollowAge } from "./serverGiveawayActions";
import { createGiveawayReminderState } from "./serverGiveawayReminder";
import { sendConfiguredChatMessage } from "./serverOutbound";

export const host = "127.0.0.1";

export const defaultPort = 3434;

export const queueStaleWarningMs = 30_000;

export const tokenRefreshLeadMs = 5 * 60 * 1000;

export const tokenValidationMaxAgeMs = 24 * 60 * 60 * 1000;

export const databaseUrl =
  process.env.DATABASE_URL ?? "file:./data/vaexcore.sqlite";

export const suiteDiscoverySchemaVersion = 1;

export const suiteDiscoveryHeartbeatMs = 15_000;

export const vaexcoreSuiteApps = [
  "vaexcore studio",
  "vaexcore pulse",
  "vaexcore console",
] as const;

export const vaexcoreSuiteAppDefinitions = [
  {
    appId: "vaexcore-studio",
    appName: "vaexcore studio",
    launchName: "vaexcore studio",
    bundleIdentifier: "com.vaexcore.studio",
  },
  {
    appId: "vaexcore-pulse",
    appName: "vaexcore pulse",
    launchName: "vaexcore pulse",
    bundleIdentifier: "com.vaexil.vaexcore.pulse",
  },
  {
    appId: "vaexcore-console",
    appName: "vaexcore console",
    launchName: "vaexcore console",
    bundleIdentifier: "com.vaexil.vaexcore.console",
  },
] as const;

export const logger = createLogger("info");

export const oauthStates = new Map<string, number>();

export const db = createDbClient(databaseUrl);

export const botValidationKeys = [
  "twitchCallbackAddedAt",
  "twitchBotOAuthCompletedAt",
  "twitchBroadcasterOAuthCompletedAt",
  "twitchEventSubRegisteredAt",
  "twitchRelayTestSendPassedAt",
  "twitchChatBotUserListConfirmedAt",
  "discordInteractionEndpointAcceptedAt",
  "discordSlashCommandsRegisteredAt",
  "discordSuggestCommandTestedAt",
  "discordAnnouncementCommandTestedAt",
] as const;

export type BotValidationKey = (typeof botValidationKeys)[number];

export const botValidationLabels: Record<BotValidationKey, string> = {
  twitchCallbackAddedAt: "Twitch callback URL added",
  twitchBotOAuthCompletedAt: "Twitch bot OAuth completed",
  twitchBroadcasterOAuthCompletedAt: "Twitch broadcaster OAuth completed",
  twitchEventSubRegisteredAt: "Twitch EventSub registered",
  twitchRelayTestSendPassedAt: "Twitch Relay test send passed",
  twitchChatBotUserListConfirmedAt: "Twitch user list shows Chat Bot",
  discordInteractionEndpointAcceptedAt: "Discord interaction endpoint accepted",
  discordSlashCommandsRegisteredAt: "Discord slash commands registered",
  discordSuggestCommandTestedAt: "Discord /suggest tested",
  discordAnnouncementCommandTestedAt: "Discord announcement command tested",
};

export const giveawaysService = new GiveawaysService({
  db,
  logger,
  followAgeResolver: resolveGiveawayFollowAge,
});

export const featureGates = createFeatureGateStore(db);

export const customCommandsService = new CustomCommandsService(db, {
  featureGates,
});

export const timersService = new TimersService(db);

export const moderationService = new ModerationService(db, {
  featureGates,
  commandPrefix: "!",
  exemptCommandNames: () => {
    const active = giveawaysService.status()?.giveaway.keyword;
    return active ? [active] : [];
  },
});

export const giveawayTemplates = createGiveawayTemplateStore(db);

export const operatorMessages = createOperatorMessageTemplateStore(db);

export const setupRuntimeStatus = createRuntimeStatus("local");

export const outboundHistory = createOutboundHistory(db);

export const studioIntegration = loadStudioIntegrationConfig();

export const studioClient = new StudioClient(studioIntegration);

export const chatQueue = new MessageQueue({
  logger,
  send: async (message) => sendConfiguredChatMessage(message),
  onEvent: (event) =>
    outboundHistory.record({
      ...event,
      source: "setup",
    }),
});

chatQueue.start();
setupRuntimeStatus.messageQueueReady = chatQueue.isReady();

export const botProcess = createBotProcessState();

export const giveawayReminder = createGiveawayReminderState();
