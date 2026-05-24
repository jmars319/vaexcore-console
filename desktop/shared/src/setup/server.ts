import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { URL } from "node:url";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLogger } from "../core/logger";
import { getRecentAuditLogs, writeAuditLog } from "../core/auditLog";
import type { ChatMessage } from "../core/chatMessage";
import { CommandRouter } from "../core/commandRouter";
import {
  MessageQueue,
  type MessageQueueEventStatus,
  type MessageQueueMetadata,
} from "../core/messageQueue";
import { createOperatorMessageTemplateStore } from "../core/operatorMessages";
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
import { createRuntimeStatus } from "../core/runtimeStatus";
import { registerCommandsModule } from "../modules/commands/commands.module";
import {
  CustomCommandsService,
  getReservedCustomCommandNames,
} from "../modules/commands/commands.service";
import {
  SafeInputError,
  limits,
  normalizeCommandName,
  normalizeKeyword,
  normalizeLogin as normalizeTwitchLogin,
  parseSafeInteger,
  redactSecrets,
  redactSecretText,
  safeErrorMessage,
  sanitizeChatMessage,
  sanitizeCommandText,
  sanitizeDisplayName,
  sanitizeGiveawayTitle,
  sanitizeText,
} from "../core/security";
import { createDbClient, resolveDatabasePath } from "../db/client";
import { registerGiveawayCommands } from "../modules/giveaways/giveaways.commands";
import { formatWinnerNames } from "../modules/giveaways/giveaways.messages";
import {
  GiveawaysService,
  parseSupportedPlatforms,
  type GiveawayFollowAgeResolver,
} from "../modules/giveaways/giveaways.service";
import { createGiveawayTemplateStore } from "../modules/giveaways/giveaways.templates";
import { ModerationService } from "../modules/moderation/moderation.module";
import { TimersService, timerMetadata } from "../modules/timers/timers.module";
import { registerStudioCommands } from "../studio/studio.commands";
import {
  loadStudioIntegrationConfig,
  StudioClient,
  type StudioMarkerInput,
} from "../studio/client";
import { studioConsoleMarkerMetadata } from "../studio/markerMetadata";
import {
  validateSuiteCommandDocument,
  type SuiteCommandDocument,
} from "../suite/commands";
import {
  validateSuiteDiscoveryDocument,
  type SuiteDiscoveryDocument,
  type SuiteLocalRuntime,
} from "../suite/discovery";
import { CONSOLE_APP, SUITE_DISCOVERY_SCHEMA_VERSION } from "../suiteProtocol";
import type {
  Giveaway,
  GiveawayWinner,
} from "../modules/giveaways/giveaways.types";
import {
  defaultRedirectUri,
  getLocalSecretsPath,
  readLocalSecrets,
  writeLocalSecrets,
  type LocalSecrets,
} from "../config/localSecrets";
import { DiscordApiClient } from "../discord/client";
import {
  applyDiscordServerSetup,
  normalizeDiscordConfigInput,
  planDiscordServerSetup,
  sendDiscordAnnouncement,
  type DiscordAnnouncementInput,
} from "../discord/setup";
import {
  discordAnnouncementKinds,
  discordSetupTemplates,
  getDiscordSetupTemplate,
  type DiscordSetupTemplate,
} from "../discord/templates";
import {
  DiscordRelayClient,
  type DiscordRelaySuggestionStatus,
} from "../discord/relay";
import {
  listDiscordRelayActions,
  parseDiscordRelayActionFilter,
  parseDiscordRelayActionStatus,
  persistDiscordRelayActions,
  updateDiscordRelayActionStatus,
} from "../discord/relayActions";
import { TwitchChatSender } from "../twitch/sendMessage";
import { getChannelFollower } from "../twitch/followers";
import {
  TwitchCreatorOpsClient,
  TwitchCreatorOpsError,
  type AnnouncementInput,
  type EndPredictionInput,
  type PollInput,
  type PredictionInput,
} from "../twitch/creatorOps";
import {
  getTwitchUserByLogin,
  optionalCreatorOpsScopes,
  optionalModerationScopes,
  requiredTwitchScopes,
  validateToken,
} from "../twitch/validate";
import {
  RelayChatClient,
  relayConfigReadiness,
  startRelayHostedInstall,
  type RelayBotReadinessReport,
} from "../twitch/relayTransport";
import { defaultConfig } from "../config/defaultConfig";
import {
  getTokenExpiresAt,
  refreshStoredTwitchToken,
  type TwitchOAuthTokenResponse,
  validateStoredTwitchToken,
} from "../twitch/tokenManager";

export type SetupServerHandle = {
  url: string;
  stop: () => Promise<void>;
};

const host = "127.0.0.1";
const defaultPort = 3434;
const queueStaleWarningMs = 30_000;
const tokenRefreshLeadMs = 5 * 60 * 1000;
const tokenValidationMaxAgeMs = 24 * 60 * 60 * 1000;
const databaseUrl = process.env.DATABASE_URL ?? "file:./data/vaexcore.sqlite";
const suiteDiscoverySchemaVersion = 1;
const suiteDiscoveryHeartbeatMs = 15_000;
const vaexcoreSuiteApps = [
  "vaexcore studio",
  "vaexcore pulse",
  "vaexcore console",
] as const;
const vaexcoreSuiteAppDefinitions = [
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
const logger = createLogger("info");
const oauthStates = new Map<string, number>();
const db = createDbClient(databaseUrl);
const botValidationKeys = [
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
type BotValidationKey = (typeof botValidationKeys)[number];

const botValidationLabels: Record<BotValidationKey, string> = {
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

const giveawaysService = new GiveawaysService({
  db,
  logger,
  followAgeResolver: resolveGiveawayFollowAge,
});
const featureGates = createFeatureGateStore(db);
const customCommandsService = new CustomCommandsService(db, { featureGates });
const timersService = new TimersService(db);
const moderationService = new ModerationService(db, {
  featureGates,
  commandPrefix: "!",
  exemptCommandNames: () => {
    const active = giveawaysService.status()?.giveaway.keyword;
    return active ? [active] : [];
  },
});
const giveawayTemplates = createGiveawayTemplateStore(db);
const operatorMessages = createOperatorMessageTemplateStore(db);
const setupRuntimeStatus = createRuntimeStatus("local");
const outboundHistory = createOutboundHistory(db);
const studioIntegration = loadStudioIntegrationConfig();
const studioClient = new StudioClient(studioIntegration);
const chatQueue = new MessageQueue({
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
const botProcess = createBotProcessState();
const giveawayReminder = createGiveawayReminderState();
let launchPreparation = createLaunchPreparationState();
let launchPreparationPromise: Promise<void> | undefined;
let pendingLaunchPreparationReason: string | undefined;

export const startSetupServer = async (options: { port?: number } = {}) => {
  const port = options.port ?? defaultPort;
  const server = createServer((request, response) => {
    void route(request, response).catch((error: unknown) => {
      logger.error({ error: redactSecrets(error) }, "Setup request failed");
      sendJson(response, 500, {
        ok: false,
        error: safeErrorMessage(error, "Setup request failed"),
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  logger.info(
    { url: `http://localhost:${port}`, secretsPath: getLocalSecretsPath() },
    "vaexcore console setup server started",
  );

  const suiteDiscoveryTimer = startSuiteDiscoveryHeartbeat(port);
  const suiteCommandTimer = startSuiteCommandPoller();
  scheduleGiveawayReminder();
  setTimeout(() => {
    void queueLaunchPreparation("launch");
  }, 0);

  return {
    url: `http://localhost:${port}`,
    stop: async () => {
      clearInterval(suiteDiscoveryTimer);
      clearInterval(suiteCommandTimer);
      clearGiveawayReminderTimer();
      await stopBotProcess({ force: true });
      await chatQueue.drain(3000);
      chatQueue.stop();
      db.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  } satisfies SetupServerHandle;
};

const route = async (request: IncomingMessage, response: ServerResponse) => {
  if (!isLocalRequest(request)) {
    sendText(response, 403, "vaexcore console setup is local-only.");
    return;
  }

  if (!isAllowedHost(request.headers.host)) {
    sendText(
      response,
      403,
      "vaexcore console setup only accepts localhost requests.",
    );
    return;
  }

  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );

  if (request.method === "GET" && url.pathname === "/") {
    sendHtml(response, setupShellHtml);
    return;
  }

  if (request.method === "GET" && url.pathname === "/giveaway-overlay") {
    sendHtml(response, giveawayOverlayHtml);
    return;
  }

  if (request.method === "GET" && url.pathname === "/platform") {
    sendPlatformHtml(response, buildPlatformPage(getPlatformStatus()));
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/ui/")) {
    sendStaticUiAsset(response, url.pathname);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/config") {
    sendJson(response, 200, getSafeConfig());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/config") {
    const body = await readJson(request);
    const saved = saveConfig(body);
    void queueLaunchPreparation("settings_saved");
    sendJson(response, 200, { ok: true, config: saved });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/setup-mode") {
    const body = await readJson(request);
    const saved = saveSetupMode(body);
    void queueLaunchPreparation("setup_mode_changed");
    sendJson(response, 200, { ok: true, config: saved });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/setup-mode/check") {
    const body = await readJson(request);
    sendJson(response, 200, checkSetupModeRoute(body));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/relay/status") {
    sendJson(response, 200, await getRelayStatusRoute());
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/relay/hosted/connect"
  ) {
    const body = await readJson(request);
    sendJson(response, 200, await connectHostedRelayRoute(body));
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/relay/eventsub/register"
  ) {
    sendJson(response, 200, await registerRelayEventSubRoute());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/relay/test-send") {
    sendJson(response, 200, await sendRelayTestMessageRoute());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/discord/status") {
    sendJson(response, 200, await getDiscordStatus(url.searchParams));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/discord/config") {
    const body = await readJson(request);
    const config = saveDiscordConfig(body);
    sendJson(response, 200, { ok: true, config });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/discord/roles") {
    sendJson(response, 200, await getDiscordRolesRoute());
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/discord/setup/preview"
  ) {
    const body = await readJson(request);
    sendJson(response, 200, await previewDiscordSetup(body));
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/discord/setup/apply"
  ) {
    const body = await readJson(request);
    const connectionError = discordConnectionError();
    if (connectionError) {
      sendJson(response, 409, {
        ok: false,
        error: connectionError,
        config: getSafeDiscordConfig(),
      });
      return;
    }

    sendJson(response, 200, await applyDiscordSetup(body));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/discord/announce") {
    const body = await readJson(request);
    const connectionError = discordConnectionError({
      requireAnnouncementChannel: true,
    });
    if (connectionError) {
      sendJson(response, 409, {
        ok: false,
        error: connectionError,
        config: getSafeDiscordConfig(),
      });
      return;
    }

    sendJson(response, 200, await sendDiscordAnnouncementRoute(body));
    return;
  }

  if (
    request.method === "GET" &&
    url.pathname === "/api/discord/relay/status"
  ) {
    sendJson(response, 200, await getDiscordRelayStatusRoute());
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/discord/relay/install/start"
  ) {
    sendJson(response, 200, await startDiscordRelayInstallRoute());
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/discord/relay/setup/preview"
  ) {
    const body = await readJson(request);
    sendJson(response, 200, await previewDiscordRelaySetupRoute(body));
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/discord/relay/setup/apply"
  ) {
    const body = await readJson(request);
    sendJson(response, 200, await applyDiscordRelaySetupRoute(body));
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/discord/relay/commands/register"
  ) {
    sendJson(response, 200, await registerDiscordRelayCommandsRoute());
    return;
  }

  if (
    request.method === "GET" &&
    url.pathname === "/api/discord/relay/events"
  ) {
    sendJson(response, 200, await getDiscordRelayEventsRoute());
    return;
  }

  if (
    request.method === "GET" &&
    url.pathname === "/api/discord/relay/actions"
  ) {
    sendJson(response, 200, getDiscordRelayActionsRoute(url.searchParams));
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/discord/relay/actions/status"
  ) {
    const body = await readJson(request);
    sendJson(response, 200, updateDiscordRelayActionStatusRoute(body));
    return;
  }

  if (
    request.method === "GET" &&
    url.pathname === "/api/discord/relay/suggestions"
  ) {
    sendJson(
      response,
      200,
      await getDiscordRelaySuggestionsRoute(url.searchParams),
    );
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/discord/relay/suggestions/status"
  ) {
    const body = await readJson(request);
    sendJson(response, 200, await updateDiscordRelaySuggestionRoute(body));
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/relay/chatbot-identity/validation"
  ) {
    const body = await readJson(request);
    sendJson(response, 200, recordRelayChatbotIdentityValidation(body));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/bot/completion") {
    sendJson(response, 200, await getBotCompletionRoute());
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/bot/validation-record"
  ) {
    const body = await readJson(request);
    sendJson(response, 200, recordBotValidation(body));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/bot/support-bundle") {
    sendJson(response, 200, await getBotSupportBundleRoute());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/bot/rehearsal/run") {
    sendJson(response, 200, await runBotSetupRehearsalRoute());
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/local-rehearsal/run"
  ) {
    sendJson(response, 200, await runFullLocalRehearsalRoute());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/twitch/creator-ops") {
    sendJson(response, 200, getTwitchCreatorOpsState());
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname.startsWith("/api/twitch/creator-ops/")
  ) {
    const body = await readJson(request);
    sendJson(response, 200, await runTwitchCreatorOpsRoute(url.pathname, body));
    return;
  }

  if (request.method === "GET" && url.pathname === "/auth/twitch/start") {
    redirectToTwitch(response);
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/auth/twitch/disconnect"
  ) {
    const config = disconnectTwitch();
    resetLaunchPreparation(
      "setup_required",
      "Twitch was disconnected.",
      "Connect Twitch in Configuration Settings.",
    );
    sendJson(response, 200, { ok: true, config });
    return;
  }

  if (request.method === "GET" && url.pathname === "/auth/twitch/callback") {
    await handleTwitchCallback(url, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/validate") {
    sendJson(response, 200, await validateSetup());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/test-send") {
    sendJson(response, 200, await sendTestMessage());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/status") {
    sendJson(response, 200, await getOperatorStatus());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/twitch/stream-key") {
    const result = await getTwitchStreamKey();
    sendJson(response, result.ok ? 200 : result.statusCode, result);
    return;
  }

  if (
    request.method === "GET" &&
    url.pathname === "/api/twitch/broadcast-readiness"
  ) {
    sendJson(response, 200, getTwitchBroadcastReadiness());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/suite/status") {
    sendJson(response, 200, getSuiteStatus());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/platform/status") {
    sendJson(response, 200, getPlatformStatus());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/launch-preparation") {
    sendJson(response, 200, getLaunchPreparationSnapshot());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/launch-preparation") {
    await queueLaunchPreparation("manual");
    sendJson(response, 200, getLaunchPreparationSnapshot());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/launch-suite") {
    sendJson(response, 200, await launchVaexcoreSuite());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/diagnostics") {
    sendJson(response, 200, getDiagnosticsReport());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/support-bundle") {
    sendJson(response, 200, await getSupportBundle());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/feature-gates") {
    sendJson(response, 200, getFeatureGates());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/stream-presets") {
    sendJson(response, 200, getStreamPresets());
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/stream-presets/apply"
  ) {
    const body = (await readJson(request)) as {
      id?: string;
      confirmed?: boolean;
    };
    sendJson(response, 200, applyStreamPreset(body));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/feature-gates") {
    const body = (await readJson(request)) as {
      key?: FeatureKey;
      mode?: FeatureGateMode;
    };
    sendJson(response, 200, setFeatureGate(body));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/timers") {
    sendJson(response, 200, getTimers());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/timers/export") {
    sendJson(response, 200, exportTimers());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/timers") {
    const body = await readJson(request);
    sendJson(response, 200, saveTimer(body));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/timers/import") {
    const body = await readJson(request);
    sendJson(response, 200, importTimers(body));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/timers/preset") {
    const body = (await readJson(request)) as { id?: string };
    sendJson(response, 200, createTimerFromPreset(body.id));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/timers/enable") {
    const body = (await readJson(request)) as {
      id?: number;
      enabled?: boolean;
    };
    sendJson(response, 200, setTimerEnabled(body));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/timers/delete") {
    const body = (await readJson(request)) as { id?: number };
    sendJson(response, 200, deleteTimer(body.id));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/timers/send-now") {
    const body = (await readJson(request)) as { id?: number };
    sendJson(response, 200, await sendTimerNow(body.id));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/moderation") {
    sendJson(response, 200, getModerationState());
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/moderation/settings"
  ) {
    const body = await readJson(request);
    sendJson(response, 200, saveModerationSettings(body));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/moderation/terms") {
    const body = await readJson(request);
    sendJson(response, 200, saveModerationTerm(body));
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/moderation/terms/enable"
  ) {
    const body = (await readJson(request)) as {
      id?: number;
      enabled?: boolean;
    };
    sendJson(response, 200, setModerationTermEnabled(body));
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/moderation/terms/delete"
  ) {
    const body = (await readJson(request)) as { id?: number };
    sendJson(response, 200, deleteModerationTerm(body.id));
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/moderation/allowed-links"
  ) {
    const body = await readJson(request);
    sendJson(response, 200, saveModerationAllowedLink(body));
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/moderation/allowed-links/enable"
  ) {
    const body = (await readJson(request)) as {
      id?: number;
      enabled?: boolean;
    };
    sendJson(response, 200, setModerationAllowedLinkEnabled(body));
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/moderation/allowed-links/delete"
  ) {
    const body = (await readJson(request)) as { id?: number };
    sendJson(response, 200, deleteModerationAllowedLink(body.id));
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/moderation/blocked-links"
  ) {
    const body = await readJson(request);
    sendJson(response, 200, saveModerationBlockedLink(body));
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/moderation/blocked-links/enable"
  ) {
    const body = (await readJson(request)) as {
      id?: number;
      enabled?: boolean;
    };
    sendJson(response, 200, setModerationBlockedLinkEnabled(body));
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/moderation/blocked-links/delete"
  ) {
    const body = (await readJson(request)) as { id?: number };
    sendJson(response, 200, deleteModerationBlockedLink(body.id));
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/moderation/link-permits"
  ) {
    const body = await readJson(request);
    sendJson(response, 200, grantModerationLinkPermit(body));
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/moderation/simulate"
  ) {
    const body = (await readJson(request)) as {
      actor?: string;
      role?: LocalChatRole;
      text?: string;
    };
    sendJson(response, 200, simulateModeration(body));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/preflight") {
    sendJson(response, 200, await runPreflightCheck());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/bot/start") {
    sendJson(response, 200, await startBotProcess());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/bot/stop") {
    sendJson(response, 200, await stopBotProcess());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/chat/send") {
    const body = (await readJson(request)) as { message?: string };
    sendJson(response, 200, await enqueueChatMessage(body.message));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/operator-messages") {
    sendJson(response, 200, getOperatorMessages());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/operator-messages") {
    const body = await readJson(request);
    sendJson(response, 200, saveOperatorMessages(body));
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/operator-messages/reset"
  ) {
    const body = (await readJson(request)) as { ids?: string[] };
    sendJson(response, 200, resetOperatorMessages(body.ids));
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/operator-messages/send"
  ) {
    const body = (await readJson(request)) as {
      id?: string;
      confirmed?: boolean;
    };
    sendJson(response, 200, await sendOperatorMessage(body));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/bot-config/export") {
    sendJson(response, 200, exportBotConfigBundle());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/bot-config/import") {
    const body = await readJson(request);
    sendJson(response, 200, importBotConfigBundle(body));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/commands") {
    sendJson(response, 200, getCustomCommands());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/commands") {
    const body = await readJson(request);
    sendJson(response, 200, saveCustomCommand(body));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/commands/enable") {
    const body = (await readJson(request)) as {
      id?: number;
      enabled?: boolean;
    };
    sendJson(response, 200, setCustomCommandEnabled(body));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/commands/duplicate") {
    const body = (await readJson(request)) as { id?: number };
    sendJson(response, 200, duplicateCustomCommand(body.id));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/commands/delete") {
    const body = (await readJson(request)) as { id?: number };
    sendJson(response, 200, deleteCustomCommand(body.id));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/commands/export") {
    sendJson(response, 200, customCommandsService.exportCommands());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/commands/import") {
    const body = await readJson(request);
    sendJson(response, 200, importCustomCommands(body));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/commands/preset") {
    const body = (await readJson(request)) as { id?: string };
    sendJson(response, 200, createCustomCommandFromPreset(body.id));
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/commands/preset-pack"
  ) {
    const body = (await readJson(request)) as { id?: string };
    sendJson(response, 200, createCustomCommandPresetPack(body.id));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/commands/preview") {
    const body = await readJson(request);
    sendJson(response, 200, previewCustomCommand(body));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/outbound-messages") {
    sendJson(response, 200, getOutboundMessages());
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/outbound-messages/resend"
  ) {
    const body = (await readJson(request)) as { id?: string };
    sendJson(response, 200, await resendOutboundMessage(body.id));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/giveaway") {
    sendJson(response, 200, getGiveawayState());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/giveaway/overlay") {
    sendJson(response, 200, getGiveawayOverlayState());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/giveaway/export") {
    sendJson(response, 200, {
      ok: true,
      export: giveawaysService.exportResults(),
    });
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/giveaway/announcement/resend"
  ) {
    const body = (await readJson(request)) as { action?: string };
    sendJson(response, 200, await resendGiveawayAnnouncement(body.action));
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/giveaway/critical/resend"
  ) {
    sendJson(response, 200, await resendCriticalGiveawayMessage());
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/giveaway/status/send"
  ) {
    sendJson(response, 200, await sendCurrentGiveawayStatus());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/giveaway/templates") {
    sendJson(response, 200, getGiveawayTemplates());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/giveaway/templates") {
    const body = await readJson(request);
    sendJson(response, 200, saveGiveawayTemplates(body));
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/giveaway/templates/reset"
  ) {
    const body = (await readJson(request)) as { actions?: string[] };
    sendJson(response, 200, resetGiveawayTemplates(body.actions));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/giveaway/reminder") {
    sendJson(response, 200, getGiveawayReminder());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/giveaway/reminder") {
    const body = await readJson(request);
    sendJson(response, 200, setGiveawayReminder(body));
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/giveaway/reminder/send"
  ) {
    sendJson(response, 200, sendGiveawayReminderNow());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/giveaway/start") {
    const body = (await readJson(request)) as {
      title?: string;
      keyword?: string;
      winnerCount?: number;
      itemName?: string;
      itemEdition?: string;
      gameName?: string;
      marketplaceName?: string;
      marketplaceNote?: string;
      platformMode?: "winner_selects_after_win" | "fixed_platform";
      supportedPlatforms?: string[];
      prizeType?: "standard_game_key" | "deluxe_game_key" | "dlc_key" | "other";
      minimumFollowAgeDays?: number;
      mustBePresentToWin?: boolean;
      responseWindowMinutes?: number;
      oneEntryPerPerson?: boolean;
      allowExtraEntries?: boolean;
      previousWinnerRestrictionMode?:
        | "exact_item_only"
        | "base_game_blocks_deluxe"
        | "none";
      ageGuidanceText?: string;
      regionAvailabilityDisclaimer?: string;
      entryWindowMinutes?: number;
      echoToChat?: boolean;
    };
    const title = sanitizeGiveawayTitle(body.title);
    const keyword = normalizeKeyword(body.keyword);
    const winnerCount = parseSafeInteger(body.winnerCount, {
      field: "Winner count",
      fallback: 6,
      min: 1,
      max: limits.winnerCountMax,
    });
    sendJson(
      response,
      200,
      await runGiveawayAction(
        () => {
          const giveaway = giveawaysService.start({
            actor: localUiActor,
            title,
            keyword,
            winnerCount,
            itemName: body.itemName,
            itemEdition: body.itemEdition,
            gameName: body.gameName,
            marketplaceName: body.marketplaceName,
            marketplaceNote: body.marketplaceNote,
            platformMode: body.platformMode,
            supportedPlatforms: body.supportedPlatforms,
            prizeType: body.prizeType,
            minimumFollowAgeDays: body.minimumFollowAgeDays,
            mustBePresentToWin: body.mustBePresentToWin,
            responseWindowMinutes: body.responseWindowMinutes,
            oneEntryPerPerson: body.oneEntryPerPerson,
            allowExtraEntries: body.allowExtraEntries,
            previousWinnerRestrictionMode: body.previousWinnerRestrictionMode,
            ageGuidanceText: body.ageGuidanceText,
            regionAvailabilityDisclaimer: body.regionAvailabilityDisclaimer,
            entryWindowMinutes: body.entryWindowMinutes,
          });
          return { giveaway };
        },
        {
          echoToChat: Boolean(body.echoToChat),
          echoCommand: `!gstart codes=${winnerCount} keyword=${keyword} title="${title.replace(/"/g, "'")}"`,
          announcements: ({ giveaway }) =>
            giveawayAnnouncement(
              giveawayTemplates.start(giveaway),
              "start",
              giveaway.id,
              "critical",
            ),
          studioMarker: ({ giveaway }) =>
            giveawayStudioMarker("start", giveaway, {
              statusTimestamp: giveaway.opened_at ?? giveaway.created_at,
              metadata: {
                requestedWinnerCount: winnerCount,
                requestedKeyword: keyword,
              },
            }),
        },
      ),
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/giveaway/config") {
    const body = await readJson(request);
    sendJson(
      response,
      200,
      await runGiveawayAction(() => ({
        giveaway: giveawaysService.updateConfig(
          localUiActor,
          body as Parameters<GiveawaysService["updateConfig"]>[1],
        ),
      })),
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/giveaway/timer") {
    const body = (await readJson(request)) as {
      action?: "start" | "stop" | "reset";
      minutes?: number;
    };
    sendJson(
      response,
      200,
      await runGiveawayAction(() => {
        if (body.action === "stop") {
          return { giveaway: giveawaysService.stopEntryTimer(localUiActor) };
        }

        if (body.action === "reset") {
          return {
            giveaway: giveawaysService.resetEntryTimer(
              localUiActor,
              body.minutes,
            ),
          };
        }

        return {
          giveaway: giveawaysService.startEntryTimer(
            localUiActor,
            body.minutes,
          ),
        };
      }),
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/giveaway/close") {
    const body = (await readJson(request)) as { echoToChat?: boolean };
    sendJson(
      response,
      200,
      await runGiveawayAction(
        () => ({
          giveaway: giveawaysService.close(localUiActor),
        }),
        {
          echoToChat: Boolean(body.echoToChat),
          echoCommand: "!gclose",
          announcements: ({ giveaway }) =>
            giveawayAnnouncement(
              giveawayTemplates.close(
                giveaway,
                giveawaysService.countEntriesForGiveaway(giveaway.id),
              ),
              "close",
              giveaway.id,
              "critical",
            ),
          studioMarker: ({ giveaway }) =>
            giveawayStudioMarker("close", giveaway, {
              statusTimestamp: giveaway.closed_at ?? new Date().toISOString(),
              metadata: {
                entryCount: giveawaysService.countEntriesForGiveaway(
                  giveaway.id,
                ),
              },
            }),
        },
      ),
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/giveaway/last-call") {
    sendJson(
      response,
      200,
      await runGiveawayAction(
        () => {
          const status = giveawaysService.status();

          if (!status || status.giveaway.status !== "open") {
            throw new Error(
              "Last call is only available while entries are open.",
            );
          }

          return {
            giveaway: status.giveaway,
            entryCount: status.entries,
          };
        },
        {
          announcements: ({ giveaway, entryCount }) =>
            giveawayAnnouncement(
              giveawayTemplates.lastCall(giveaway, entryCount),
              "last-call",
              giveaway.id,
              "critical",
            ),
          studioMarker: ({ giveaway, entryCount }) =>
            giveawayStudioMarker("last-call", giveaway, {
              statusTimestamp: new Date().toISOString(),
              metadata: {
                entryCount,
              },
            }),
        },
      ),
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/giveaway/draw") {
    const body = (await readJson(request)) as {
      count?: number;
      echoToChat?: boolean;
    };
    const count = parseSafeInteger(body.count, {
      field: "Winner count",
      fallback: 6,
      min: 1,
      max: limits.winnerCountMax,
    });
    sendJson(
      response,
      200,
      await runGiveawayAction(
        () => ({
          result: giveawaysService.draw(localUiActor, count),
        }),
        {
          echoToChat: Boolean(body.echoToChat),
          echoCommand: `!gdraw ${count}`,
          announcements: ({ result }) =>
            giveawayAnnouncement(
              giveawayTemplates.draw(result),
              "draw",
              result.giveaway.id,
              "critical",
            ),
          studioMarker: ({ result }) =>
            giveawayStudioMarker("draw", result.giveaway, {
              statusTimestamp: firstWinnerTimestamp(result.winners),
              sourceEventSuffix: drawSourceEventSuffix(result.winners),
              metadata: {
                requestedCount: result.requestedCount,
                eligibleCount: result.eligibleCount,
                winners: result.winners.map(giveawayWinnerMetadata),
              },
            }),
        },
      ),
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/giveaway/reroll") {
    const body = (await readJson(request)) as {
      username?: string;
      echoToChat?: boolean;
    };
    sendJson(
      response,
      200,
      await runGiveawayAction(
        () => ({
          result: giveawaysService.reroll(
            localUiActor,
            requireUsername(body.username),
          ),
        }),
        {
          echoToChat: Boolean(body.echoToChat),
          echoCommand: body.username
            ? `!greroll ${requireUsername(body.username)}`
            : undefined,
          announcements: ({ result }) =>
            giveawayAnnouncement(
              giveawayTemplates.reroll(result),
              "reroll",
              result.giveaway.id,
              "important",
            ),
          studioMarker: ({ result }) =>
            giveawayStudioMarker("reroll", result.giveaway, {
              statusTimestamp:
                result.rerolled.rerolled_at ?? new Date().toISOString(),
              sourceEventSuffix: `winner-${result.rerolled.id}-replacement-${result.replacement?.id ?? "none"}`,
              metadata: {
                rerolled: giveawayWinnerMetadata(result.rerolled),
                replacement: result.replacement
                  ? giveawayWinnerMetadata(result.replacement)
                  : null,
              },
            }),
        },
      ),
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/giveaway/claim") {
    const body = (await readJson(request)) as {
      username?: string;
      echoToChat?: boolean;
    };
    sendJson(
      response,
      200,
      await runGiveawayAction(
        () => ({
          result: giveawaysService.claim(
            localUiActor,
            requireUsername(body.username),
          ),
        }),
        {
          echoToChat: Boolean(body.echoToChat),
          echoCommand: body.username
            ? `!gclaim ${requireUsername(body.username)}`
            : undefined,
        },
      ),
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/giveaway/confirm") {
    const body = (await readJson(request)) as {
      username?: string;
      selectedPlatform?: string;
      regionCountry?: string;
      deliveryMethod?: string;
      marketplaceUsed?: string;
      purchaseStatus?:
        | "not_purchased"
        | "pending_purchase"
        | "purchased"
        | "delivered"
        | "activation_confirmed_optional";
      notes?: string;
    };
    sendJson(
      response,
      200,
      await runGiveawayAction(() => ({
        result: giveawaysService.confirm(
          localUiActor,
          requireUsername(body.username),
          body,
        ),
      })),
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/giveaway/expire") {
    const body = (await readJson(request)) as { username?: string };
    sendJson(
      response,
      200,
      await runGiveawayAction(() => ({
        result: giveawaysService.expireWinner(
          localUiActor,
          requireUsername(body.username),
        ),
      })),
    );
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/giveaway/purchase-status"
  ) {
    const body = (await readJson(request)) as {
      username?: string;
      purchaseStatus?:
        | "not_purchased"
        | "pending_purchase"
        | "purchased"
        | "delivered"
        | "activation_confirmed_optional";
    };
    sendJson(
      response,
      200,
      await runGiveawayAction(() => ({
        result: giveawaysService.setPurchaseStatus(
          localUiActor,
          requireUsername(body.username),
          body.purchaseStatus,
        ),
      })),
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/giveaway/deliver") {
    const body = (await readJson(request)) as {
      username?: string;
      echoToChat?: boolean;
    };
    sendJson(
      response,
      200,
      await runGiveawayAction(
        () => ({
          result: giveawaysService.deliver(
            localUiActor,
            requireUsername(body.username),
          ),
        }),
        {
          echoToChat: Boolean(body.echoToChat),
          echoCommand: body.username
            ? `!gdeliver ${requireUsername(body.username)}`
            : undefined,
        },
      ),
    );
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/giveaway/deliver-all"
  ) {
    sendJson(
      response,
      200,
      await runGiveawayAction(() => ({
        result: giveawaysService.deliverAll(localUiActor),
      })),
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/giveaway/end") {
    const body = (await readJson(request)) as { echoToChat?: boolean };
    sendJson(
      response,
      200,
      await runGiveawayAction(
        () => ({
          giveaway: giveawaysService.end(localUiActor),
        }),
        {
          echoToChat: Boolean(body.echoToChat),
          echoCommand: "!gend",
          announcements: ({ giveaway }) =>
            giveawayAnnouncement(
              giveawayTemplates.end(
                giveaway,
                giveawaysService.getWinnersForGiveaway(giveaway.id),
              ),
              "end",
              giveaway.id,
              "critical",
            ),
          studioMarker: ({ giveaway }) =>
            giveawayStudioMarker("end", giveaway, {
              statusTimestamp: giveaway.ended_at ?? new Date().toISOString(),
              metadata: {
                winners: giveawaysService
                  .getWinnersForGiveaway(giveaway.id)
                  .map(giveawayWinnerMetadata),
              },
            }),
        },
      ),
    );
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/giveaway/add-entrant"
  ) {
    const body = (await readJson(request)) as {
      login?: string;
      displayName?: string;
      role?: LocalChatRole;
      followAgeDays?: number;
      followVerified?: boolean;
      echoToChat?: boolean;
    };
    sendJson(
      response,
      200,
      await runGiveawayAction(
        async () => ({
          result: await giveawaysService.addSimulatedEntrant(
            simulatedChatActor,
            createLocalChatMessage({
              login: requireUsername(body.login),
              displayName: sanitizeDisplayName(
                body.displayName,
                requireUsername(body.login),
              ),
              role: body.role ?? "viewer",
              text: "!enter",
              followAgeDays: body.followAgeDays,
              followVerified: body.followVerified,
            }),
          ),
        }),
        {
          echoToChat: Boolean(body.echoToChat),
          echoCommand: "!enter",
          announcements: ({ result }) =>
            result.status === "entered"
              ? giveawayAnnouncement(
                  giveawayTemplates.entry({
                    giveaway: result.giveaway,
                    displayName: result.displayName,
                    entryCount: result.entryCount,
                  }),
                  "entry",
                  result.giveaway.id,
                )
              : undefined,
        },
      ),
    );
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/giveaway/remove-entrant"
  ) {
    const body = (await readJson(request)) as {
      username?: string;
      reason?: string;
    };
    sendJson(
      response,
      200,
      await runGiveawayAction(() => ({
        result: giveawaysService.removeEntrant(
          localUiActor,
          requireUsername(body.username),
          body.reason,
        ),
      })),
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/command/simulate") {
    const body = (await readJson(request)) as {
      actor?: string;
      role?: "viewer" | "mod" | "broadcaster";
      command?: string;
      echoToChat?: boolean;
    };
    sendJson(response, 200, await simulateCommand(body));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/giveaway/run-test") {
    const body = (await readJson(request)) as {
      echoToChat?: boolean;
      confirmed?: boolean;
    };
    sendJson(
      response,
      200,
      await runLocalLifecycleTest({
        echoToChat: Boolean(body.echoToChat),
        confirmed: Boolean(body.confirmed),
      }),
    );
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/audit-logs") {
    sendJson(response, 200, {
      ok: true,
      logs: giveawaysService.getRecentAuditLogs(100),
    });
    return;
  }

  sendJson(response, 404, { ok: false, error: "Not found" });
};

const getSafeConfig = () => {
  const secrets = readLocalSecrets();
  const twitch = secrets.twitch;

  return {
    mode: secrets.mode,
    setupMode: getSetupMode(secrets),
    setupChecks: getSafeSetupChecks(secrets),
    hasClientId: Boolean(twitch.clientId),
    hasClientSecret: Boolean(twitch.clientSecret),
    hasAccessToken: Boolean(twitch.accessToken),
    hasRefreshToken: Boolean(twitch.refreshToken),
    hasBroadcasterUserId: Boolean(twitch.broadcasterUserId),
    hasBotUserId: Boolean(twitch.botUserId),
    broadcasterLogin: twitch.broadcasterLogin ?? "",
    botLogin: twitch.botLogin ?? "",
    redirectUri: twitch.redirectUri ?? defaultRedirectUri,
    requiredScopes: requiredTwitchScopes,
    optionalModerationScopes,
    optionalCreatorOpsScopes,
    scopes: twitch.scopes,
    tokenExpiresAt: twitch.tokenExpiresAt ?? "",
    tokenValidatedAt: twitch.tokenValidatedAt ?? "",
    token: twitch.accessToken ? maskToken(twitch.accessToken) : "",
    discord: getSafeDiscordConfig(secrets),
    relay: getSafeRelayConfig(secrets),
    botValidation: getSafeBotValidation(secrets),
  };
};

type SetupMode = "local-only" | "relay-assisted" | "advanced";

const setupModes: SetupMode[] = ["local-only", "relay-assisted", "advanced"];

const getSetupMode = (secrets = readLocalSecrets()): SetupMode => {
  if (setupModes.includes(secrets.setupMode as SetupMode)) {
    return secrets.setupMode as SetupMode;
  }

  return secrets.relay.twitchTransportMode === "relay-chatbot"
    ? "relay-assisted"
    : "local-only";
};

const setupModeDisplayLabel = (mode: SetupMode) =>
  mode === "relay-assisted"
    ? "Hosted"
    : mode === "advanced"
      ? "Assisted"
      : "Local";

const parseSetupMode = (value: unknown, fallback: SetupMode): SetupMode =>
  typeof value === "string" && setupModes.includes(value as SetupMode)
    ? (value as SetupMode)
    : fallback;

const deriveTwitchTransportForSetupMode = (
  setupMode: SetupMode,
  existingTransport: LocalSecrets["relay"]["twitchTransportMode"],
) => {
  if (setupMode === "relay-assisted") {
    return "relay-chatbot";
  }

  if (setupMode === "local-only") {
    return "local-user-token";
  }

  return existingTransport;
};

const getSafeSetupChecks = (secrets = readLocalSecrets()) => ({
  local: safeSetupCheck(secrets.setupChecks.local),
  relay: safeSetupCheck(secrets.setupChecks.relay),
});

const safeSetupCheck = (
  check: LocalSecrets["setupChecks"]["local"] | undefined,
) => ({
  checkedAt: check?.checkedAt ?? "",
  status: check?.status ?? "",
  message: check?.message ?? "",
});

const checkSetupModeRoute = (body: unknown) => {
  const input = objectInput(body);
  const existing = readLocalSecrets();
  const mode = parseSetupMode(input.mode, getSetupMode(existing));
  const key = mode === "relay-assisted" ? "relay" : "local";
  const check =
    key === "relay"
      ? buildRelaySetupCheck(existing)
      : buildLocalSetupCheck(existing);
  const record = {
    checkedAt: new Date().toISOString(),
    status: check.status,
    message: check.message,
  };

  writeLocalSecrets({
    ...existing,
    setupMode: mode,
    setupChecks: {
      ...existing.setupChecks,
      [key]: record,
    },
  });

  return {
    ok: true,
    mode,
    check: record,
    providerSetup: {
      mode,
      redacted: true,
      checkedAt: record.checkedAt,
      status: record.status,
      message: record.message,
    },
    setupChecks: getSafeSetupChecks(),
    config: getSafeConfig(),
  };
};

const buildLocalSetupCheck = (secrets: LocalSecrets) => {
  const twitch = secrets.twitch;
  const missing = [
    twitch.clientId ? null : "Client ID",
    twitch.clientSecret ? null : "Client Secret",
    twitch.redirectUri ? null : "Redirect URI",
    twitch.broadcasterLogin ? null : "Broadcaster Login",
    twitch.botLogin ? null : "Bot Login",
    twitch.accessToken ? null : "OAuth token",
  ].filter(Boolean) as string[];
  const discordReady = getDiscordReadiness(secrets).ready;

  if (missing.length) {
    return {
      status: "blocked" as const,
      message: `Local setup needs ${missing.join(", ")} before local chat validation can pass.`,
    };
  }

  if (!discordReady) {
    return {
      status: "degraded" as const,
      message:
        "Local Twitch setup has required fields. Local Discord announcements/layout are not configured yet.",
    };
  }

  return {
    status: "ready" as const,
    message:
      "Local setup has Twitch OAuth fields and local Discord announcement/layout settings.",
  };
};

const buildRelaySetupCheck = (secrets: LocalSecrets) => {
  const readiness = relayConfigReadiness({
    baseUrl: secrets.relay.baseUrl,
    installationId: secrets.relay.installationId,
    consoleToken: secrets.relay.consoleToken,
  });

  if (!readiness.ready) {
    return {
      status: "blocked" as const,
      message:
        readiness.checks
          .filter((check) => !check.ok)
          .map((check) => check.detail)
          .join(" ") || "Relay pairing is incomplete.",
    };
  }

  if (secrets.relay.twitchTransportMode !== "relay-chatbot") {
    return {
      status: "degraded" as const,
      message:
        "Relay pairing is saved, but Twitch transport is still set to Local.",
    };
  }

  return {
    status: "ready" as const,
    message:
      "Hosted setup has Relay pairing and Twitch Chat Bot transport selected.",
  };
};

const getSafeBotValidation = (secrets = readLocalSecrets()) => {
  const records = Object.fromEntries(
    botValidationKeys.map((key) => [key, secrets.botValidation[key] ?? ""]),
  ) as Record<BotValidationKey, string>;
  return {
    records,
    checklist: botValidationKeys.map((key) => ({
      key,
      label: botValidationLabels[key],
      recordedAt: records[key],
      complete: Boolean(records[key]),
    })),
  };
};

const getSafeRelayConfig = (secrets = readLocalSecrets()) => {
  const relay = secrets.relay;
  const readiness = relayConfigReadiness({
    baseUrl: relay.baseUrl,
    installationId: relay.installationId,
    consoleToken: relay.consoleToken,
  });
  const chatbotIdentityLiveValidated = Boolean(
    relay.chatbotIdentityValidatedAt,
  );
  const identityNotice =
    relay.twitchTransportMode === "relay-chatbot"
      ? chatbotIdentityLiveValidated
        ? "Relay chatbot mode is selected and Chat Bot identity has been manually live-validated."
        : "Relay chatbot mode is selected. Chat Bot identity is not live-tested yet; complete the live validation checklist before calling it complete."
      : "Local user-token mode is selected. Twitch will show outgoing bot chat as a normal Twitch user.";

  return {
    twitchTransportMode: relay.twitchTransportMode,
    baseUrl: relay.baseUrl ?? "",
    installationId: relay.installationId ?? "",
    hasConsoleToken: Boolean(relay.consoleToken),
    chatbotIdentityLiveValidated,
    chatbotIdentityValidatedAt: relay.chatbotIdentityValidatedAt ?? "",
    chatbotIdentityValidationNote: relay.chatbotIdentityValidationNote ?? "",
    readiness,
    identityNotice,
    setupUrls: getRelaySetupUrls(relay),
  };
};

const getSafeDiscordConfig = (secrets = readLocalSecrets()) => {
  const discord = secrets.discord;
  const template = getDiscordSetupTemplate(discord.setupTemplateId);
  return {
    hasBotToken: Boolean(discord.botToken),
    guildId: discord.guildId ?? "",
    streamAnnouncementChannelId: getDiscordAnnouncementChannelId(discord) ?? "",
    generalAnnouncementChannelId:
      discord.generalAnnouncementChannelId ??
      discord.createdChannelIds?.[
        template.recommended.generalAnnouncementChannelId
      ] ??
      "",
    streamAlertsRoleId:
      discord.streamAlertsRoleId ??
      discord.createdRoleIds?.[template.recommended.streamAlertsRoleId] ??
      "",
    operatorRoleId:
      discord.operatorRoleId ??
      (template.recommended.operatorRoleId
        ? discord.createdRoleIds?.[template.recommended.operatorRoleId]
        : undefined) ??
      "",
    staffRoleId: discord.staffRoleId ?? "",
    lockStaffCategory: Boolean(discord.lockStaffCategory),
    setupTemplateId: template.id,
    setupTemplate: safeDiscordTemplateSummary(template),
    setupTemplates: discordSetupTemplates.map(safeDiscordTemplateSummary),
    setupAppliedAt: discord.setupAppliedAt ?? "",
    starterMessagesAppliedAt: discord.starterMessagesAppliedAt ?? "",
    createdChannelIds: discord.createdChannelIds ?? {},
    createdRoleIds: discord.createdRoleIds ?? {},
    createdMessageIds: discord.createdMessageIds ?? {},
    relay: getSafeDiscordRelayConfig(secrets),
  };
};

const safeDiscordTemplateSummary = (template: DiscordSetupTemplate) => ({
  id: template.id,
  name: template.name,
  description: template.description,
  recommendedFor: template.recommendedFor ?? "",
  channelCount: template.channels.filter(
    (channel) => channel.kind !== "category",
  ).length,
  categoryCount: template.channels.filter(
    (channel) => channel.kind === "category",
  ).length,
  roleCount: template.roles.length,
  starterMessageCount: template.starterMessages?.length ?? 0,
  postStarterMessagesByDefault: Boolean(template.postStarterMessagesByDefault),
});

const getSafeDiscordRelayConfig = (secrets = readLocalSecrets()) => {
  const relay = secrets.relay;
  const baseUrl = relay.baseUrl?.replace(/\/+$/, "") ?? "";
  const readiness = relayConfigReadiness({
    baseUrl: relay.baseUrl,
    installationId: relay.installationId,
    consoleToken: relay.consoleToken,
  });
  return {
    configured: readiness.ready,
    baseUrl,
    installationId: relay.installationId ?? "",
    hasConsoleToken: Boolean(relay.consoleToken),
    interactionUrl: getRelaySetupUrls(relay).discordInteractionUrl,
    suggestionStatuses: ["new", "reviewed", "accepted", "rejected", "archived"],
    localReadiness: readiness,
  };
};

const getRelaySetupUrls = (relay: LocalSecrets["relay"]) => {
  const baseUrl = relay.baseUrl?.replace(/\/+$/, "") ?? "";
  const installationId = relay.installationId ?? "";
  const installationQuery = installationId
    ? `?installationId=${encodeURIComponent(installationId)}`
    : "";
  return {
    publicBaseUrl: baseUrl,
    twitchCallbackUrl: baseUrl ? `${baseUrl}/oauth/twitch/callback` : "",
    twitchBotOAuthUrl:
      baseUrl && installationId
        ? `${baseUrl}/oauth/twitch/start${installationQuery}&kind=bot`
        : "",
    twitchBroadcasterOAuthUrl:
      baseUrl && installationId
        ? `${baseUrl}/oauth/twitch/start${installationQuery}&kind=broadcaster`
        : "",
    twitchEventSubWebhookUrl: baseUrl
      ? `${baseUrl}/webhooks/twitch/eventsub`
      : "",
    discordInteractionUrl: baseUrl
      ? `${baseUrl}/webhooks/discord/interactions`
      : "",
  };
};

const connectHostedRelayRoute = async (body: unknown) => {
  const input = objectInput(body);
  const existing = readLocalSecrets();
  const requestedBaseUrl =
    optionalInputString(input.relayBaseUrl) ||
    existing.relay.baseUrl ||
    defaultConfig.hostedRelayBaseUrl;
  const baseUrl = sanitizeRelayBaseUrl(requestedBaseUrl);
  if (!baseUrl) {
    throw new SafeInputError("Hosted Relay URL is missing.");
  }

  const alreadyPaired =
    input.force !== true &&
    existing.relay.twitchTransportMode === "relay-chatbot" &&
    existing.relay.baseUrl?.replace(/\/+$/, "") === baseUrl &&
    Boolean(existing.relay.installationId && existing.relay.consoleToken);

  if (alreadyPaired) {
    return {
      ok: true,
      alreadyPaired: true,
      config: getSafeConfig(),
      relay: getSafeRelayConfig(existing),
      status: await getRelayStatusRoute(),
    };
  }

  const install = await startRelayHostedInstall({
    baseUrl,
    name: "VaexCore Console",
  });
  if (!install.ok || !install.installationId || !install.consoleToken) {
    throw new SafeInputError("Hosted Relay did not return a Console pairing.");
  }

  const now = new Date().toISOString();
  const next: LocalSecrets = {
    ...existing,
    setupMode: "relay-assisted",
    relay: {
      ...existing.relay,
      twitchTransportMode: "relay-chatbot",
      baseUrl,
      installationId: install.installationId,
      consoleToken: install.consoleToken,
      chatbotIdentityValidatedAt: undefined,
      chatbotIdentityValidationNote: undefined,
    },
    setupChecks: {
      ...existing.setupChecks,
      relay: {
        checkedAt: now,
        status: "ready",
        message:
          "Hosted Relay pairing is saved. Authorize the bot and broadcaster accounts next.",
      },
    },
    botValidation: {
      ...existing.botValidation,
      twitchEventSubRegisteredAt: undefined,
      twitchRelayTestSendPassedAt: undefined,
      twitchChatBotUserListConfirmedAt: undefined,
    },
  };
  writeLocalSecrets(next);
  appendSuiteTimelineEvent({
    sourceApp: "vaexcore-console",
    sourceAppName: "vaexcore console",
    kind: "twitch.relay.hosted.connect",
    title: "Hosted Twitch Relay paired",
    detail:
      "Console created a hosted Relay installation for Twitch Chat Bot setup.",
    metadata: {
      transport: "relay-chatbot",
      relayBaseUrl: baseUrl,
      installationId: install.installationId,
    },
  });

  let status: Awaited<ReturnType<typeof getRelayStatusRoute>> | null = null;
  try {
    status = await getRelayStatusRoute();
  } catch {
    status = null;
  }

  return {
    ok: true,
    alreadyPaired: false,
    config: getSafeConfig(),
    relay: getSafeRelayConfig(),
    install: {
      installationId: install.installationId,
      next: install.next ?? {},
    },
    status,
  };
};

const getDiscordReadiness = (secrets = readLocalSecrets()) => {
  const discord = secrets.discord;
  const checks = [
    {
      name: "Bot token",
      ok: Boolean(discord.botToken),
      detail: discord.botToken
        ? "Discord bot token is saved locally."
        : "Save a Discord bot token created in the Discord Developer Portal.",
    },
    {
      name: "Server ID",
      ok: Boolean(discord.guildId),
      detail: discord.guildId
        ? "Discord server ID is saved."
        : "Save the Discord server ID for the channel setup target.",
    },
    {
      name: "Announcement channel",
      ok: Boolean(getDiscordAnnouncementChannelId(discord)),
      detail: getDiscordAnnouncementChannelId(discord)
        ? "A stream announcement channel is selected."
        : "Apply the server setup or save a stream announcement channel ID.",
    },
  ];

  return {
    ready: checks.every((check) => check.ok),
    checks,
  };
};

const getDiscordStatus = async (searchParams: URLSearchParams) => {
  const secrets = readLocalSecrets();
  const validate = searchParams.get("validate") === "1";
  let bot: { id: string; username: string } | null = null;
  let validationError = "";

  if (validate && secrets.discord.botToken) {
    try {
      const currentUser = await createDiscordClient(
        secrets.discord.botToken,
      ).getCurrentUser();
      bot = {
        id: currentUser.id,
        username: currentUser.global_name || currentUser.username,
      };
    } catch (error) {
      validationError = safeErrorMessage(
        error,
        "Discord bot validation failed.",
      );
    }
  }

  return {
    ok: true,
    config: getSafeDiscordConfig(secrets),
    readiness: getDiscordReadiness(secrets),
    template: getDiscordSetupTemplate(secrets.discord.setupTemplateId),
    templates: discordSetupTemplates,
    bot,
    validationError,
  };
};

const getDiscordRolesRoute = async () => {
  const secrets = readLocalSecrets();
  const connectionError = discordConnectionError({
    requireAnnouncementChannel: false,
  });

  if (connectionError) {
    return {
      ok: true,
      connected: false,
      roles: [],
      error: connectionError,
      config: getSafeDiscordConfig(secrets),
    };
  }

  try {
    const guildId = secrets.discord.guildId ?? "";
    const roles = await createDiscordClient(
      secrets.discord.botToken ?? "",
    ).listGuildRoles(guildId);
    return {
      ok: true,
      connected: true,
      roles: roles
        .map((role) => ({
          id: role.id,
          name: role.name,
          managed: Boolean(role.managed),
          mentionable: Boolean(role.mentionable),
          staffEligible: role.id !== guildId && !role.managed,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      config: getSafeDiscordConfig(secrets),
    };
  } catch (error) {
    return {
      ok: true,
      connected: false,
      roles: [],
      error: safeErrorMessage(error, "Discord role loading failed."),
      config: getSafeDiscordConfig(secrets),
    };
  }
};

const getRelayStatusRoute = async () => {
  const secrets = readLocalSecrets();
  const relay = getSafeRelayConfig(secrets);
  const connectionError = relayConnectionError(secrets);
  if (connectionError) {
    return {
      ok: true,
      connected: false,
      relay,
      error: connectionError,
    };
  }

  try {
    const status = await createRelayChatClient(secrets).status();
    return {
      ok: true,
      connected: true,
      relay,
      installation: status.installation,
      readiness: status.readiness,
    };
  } catch (error) {
    return {
      ok: false,
      connected: false,
      relay,
      error: safeErrorMessage(error, "Relay status check failed."),
    };
  }
};

const registerRelayEventSubRoute = async () => {
  const secrets = readLocalSecrets();
  const connectionError = relayConnectionError(secrets);
  if (connectionError) {
    throw new SafeInputError(connectionError);
  }
  const result = await createRelayChatClient(secrets).registerEventSub();
  const current = readLocalSecrets();
  writeLocalSecrets({
    ...current,
    botValidation: {
      ...current.botValidation,
      twitchEventSubRegisteredAt: new Date().toISOString(),
    },
  });
  appendSuiteTimelineEvent({
    sourceApp: "vaexcore-console",
    sourceAppName: "vaexcore console",
    kind: "twitch.relay.eventsub.register",
    title: "Twitch Relay EventSub registered",
    detail: "Console registered the Relay chatbot EventSub subscription.",
    metadata: {
      transport: "relay-chatbot",
      subscription: result.subscription ?? null,
    },
  });
  return {
    ...result,
    relay: getSafeRelayConfig(),
  };
};

const sendRelayTestMessageRoute = async () => {
  const secrets = readLocalSecrets();
  const connectionError = relayConnectionError(secrets);
  if (connectionError) {
    return {
      ok: false,
      relay: getSafeRelayConfig(secrets),
      error: connectionError,
      failureCategory: "config",
    };
  }

  const result = await createRelayChatClient(secrets).send(
    "vaexcore console relay setup test.",
    {
      idempotencyKey: `console-test-send-${new Date().toISOString().slice(0, 10)}`,
    },
  );
  const structured = typeof result === "string" ? { status: result } : result;
  if (structured.status === "sent") {
    const current = readLocalSecrets();
    writeLocalSecrets({
      ...current,
      botValidation: {
        ...current.botValidation,
        twitchRelayTestSendPassedAt: new Date().toISOString(),
      },
    });
  }
  return {
    ok: structured.status === "sent",
    relay: getSafeRelayConfig(),
    error:
      structured.status === "sent"
        ? undefined
        : structured.reason || "Relay test chat message was not sent.",
    failureCategory: structured.failureCategory,
  };
};

const relayConnectionError = (secrets = readLocalSecrets()) => {
  const relay = secrets.relay;
  const readiness = relayConfigReadiness({
    baseUrl: relay.baseUrl,
    installationId: relay.installationId,
    consoleToken: relay.consoleToken,
  });
  if (!readiness.ready) {
    return "Start hosted Twitch setup before using Relay chatbot setup.";
  }
  return "";
};

const createRelayChatClient = (secrets = readLocalSecrets()) =>
  new RelayChatClient({
    baseUrl: secrets.relay.baseUrl,
    installationId: secrets.relay.installationId,
    consoleToken: secrets.relay.consoleToken,
  });

const saveDiscordConfig = (body: unknown) => {
  const input = objectInput(body);
  const existing = readLocalSecrets();
  const lockStaffCategory =
    input.lockStaffCategory === undefined
      ? Boolean(existing.discord.lockStaffCategory)
      : Boolean(input.lockStaffCategory);
  const setupTemplateId =
    normalizeDiscordSetupTemplateId(
      optionalInputString(input.setupTemplateId),
    ) ?? existing.discord.setupTemplateId;
  const normalized = normalizeDiscordConfigInput({
    botToken: optionalInputString(input.botToken),
    guildId: optionalInputString(input.guildId),
    streamAnnouncementChannelId: optionalInputString(
      input.streamAnnouncementChannelId,
    ),
    generalAnnouncementChannelId: optionalInputString(
      input.generalAnnouncementChannelId,
    ),
    streamAlertsRoleId: optionalInputString(input.streamAlertsRoleId),
    operatorRoleId: optionalInputString(input.operatorRoleId),
    staffRoleId: optionalInputString(input.staffRoleId),
    lockStaffCategory,
  });
  const guildChanged = Boolean(
    normalized.guildId && normalized.guildId !== existing.discord.guildId,
  );
  const nextDiscord: LocalSecrets["discord"] = {
    ...existing.discord,
    botToken: normalized.botToken || existing.discord.botToken,
    guildId: normalized.guildId || existing.discord.guildId,
    streamAnnouncementChannelId:
      normalized.streamAnnouncementChannelId ||
      (guildChanged ? undefined : existing.discord.streamAnnouncementChannelId),
    generalAnnouncementChannelId:
      normalized.generalAnnouncementChannelId ||
      (guildChanged
        ? undefined
        : existing.discord.generalAnnouncementChannelId),
    streamAlertsRoleId:
      normalized.streamAlertsRoleId ||
      (guildChanged ? undefined : existing.discord.streamAlertsRoleId),
    operatorRoleId:
      normalized.operatorRoleId ||
      (guildChanged ? undefined : existing.discord.operatorRoleId),
    staffRoleId:
      normalized.staffRoleId ||
      (guildChanged ? undefined : existing.discord.staffRoleId),
    lockStaffCategory: Boolean(normalized.lockStaffCategory),
    setupTemplateId,
    setupAppliedAt: guildChanged ? undefined : existing.discord.setupAppliedAt,
    createdChannelIds: guildChanged
      ? {}
      : (existing.discord.createdChannelIds ?? {}),
    createdRoleIds: guildChanged ? {} : (existing.discord.createdRoleIds ?? {}),
    createdMessageIds: guildChanged
      ? {}
      : (existing.discord.createdMessageIds ?? {}),
    starterMessagesAppliedAt: guildChanged
      ? undefined
      : existing.discord.starterMessagesAppliedAt,
  };

  writeLocalSecrets({
    ...existing,
    discord: nextDiscord,
  });

  return getSafeDiscordConfig();
};

const previewDiscordSetup = async (body: unknown) => {
  const input = objectInput(body);
  const includeRoles = Boolean(input.includeRoles);
  const secrets = readLocalSecrets();
  const template = getDiscordSetupTemplate(
    normalizeDiscordSetupTemplateId(optionalInputString(input.templateId)) ??
      secrets.discord.setupTemplateId,
  );
  const applyPermissions =
    input.applyPermissions === undefined
      ? true
      : Boolean(input.applyPermissions);
  const postStarterMessages =
    input.postStarterMessages === undefined
      ? Boolean(template.postStarterMessagesByDefault)
      : Boolean(input.postStarterMessages);
  const lockStaffCategory =
    input.lockStaffCategory === undefined
      ? Boolean(secrets.discord.lockStaffCategory)
      : Boolean(input.lockStaffCategory);
  const staffRoleId =
    optionalInputString(input.staffRoleId) ?? secrets.discord.staffRoleId;
  const connectionError = discordConnectionError({
    requireAnnouncementChannel: false,
  });

  if (connectionError) {
    return {
      ok: true,
      connected: false,
      message: connectionError,
      config: getSafeDiscordConfig(secrets),
      plan: planDiscordServerSetup({
        existingChannels: [],
        existingRoles: [],
        template,
        includeRoles,
        applyPermissions,
        postStarterMessages,
        existingMessageIds: secrets.discord.createdMessageIds ?? {},
        guildId: secrets.discord.guildId,
        lockStaffCategory,
        staffRoleId,
      }),
      template,
    };
  }

  const client = createDiscordClient(secrets.discord.botToken ?? "");
  const guildId = secrets.discord.guildId ?? "";
  const [existingChannels, existingRoles] = await Promise.all([
    client.listGuildChannels(guildId),
    client.listGuildRoles(guildId),
  ]);

  return {
    ok: true,
    connected: true,
    config: getSafeDiscordConfig(secrets),
    plan: planDiscordServerSetup({
      existingChannels,
      existingRoles,
      template,
      includeRoles,
      applyPermissions,
      postStarterMessages,
      existingMessageIds: secrets.discord.createdMessageIds ?? {},
      guildId,
      lockStaffCategory,
      staffRoleId,
    }),
    template,
  };
};

const applyDiscordSetup = async (body: unknown) => {
  const input = objectInput(body);
  const includeRoles = Boolean(input.includeRoles);
  const secrets = readLocalSecrets();
  const botToken = secrets.discord.botToken;
  const guildId = secrets.discord.guildId;
  const template = getDiscordSetupTemplate(
    normalizeDiscordSetupTemplateId(optionalInputString(input.templateId)) ??
      secrets.discord.setupTemplateId,
  );
  const applyPermissions =
    input.applyPermissions === undefined
      ? true
      : Boolean(input.applyPermissions);
  const postStarterMessages =
    input.postStarterMessages === undefined
      ? Boolean(template.postStarterMessagesByDefault)
      : Boolean(input.postStarterMessages);
  const lockStaffCategory =
    input.lockStaffCategory === undefined
      ? Boolean(secrets.discord.lockStaffCategory)
      : Boolean(input.lockStaffCategory);
  const staffRoleId =
    optionalInputString(input.staffRoleId) ?? secrets.discord.staffRoleId;

  if (!botToken || !guildId) {
    throw new SafeInputError("Discord bot token and server ID are required.");
  }

  const client = createDiscordClient(botToken);
  const bot = await client.getCurrentUser();
  const result = await applyDiscordServerSetup({
    client,
    guildId,
    template,
    includeRoles,
    applyPermissions,
    postStarterMessages,
    existingMessageIds: secrets.discord.createdMessageIds ?? {},
    lockStaffCategory,
    staffRoleId,
    botUserId: bot.id,
  });
  const latest = readLocalSecrets();
  const operatorRoleId =
    result.recommended.operatorRoleId || latest.discord.operatorRoleId;
  const createdMessageIds = {
    ...(latest.discord.createdMessageIds ?? {}),
    ...result.createdMessageIds,
  };
  const starterMessagesAppliedAt =
    result.starterMessagesPosted > 0
      ? result.appliedAt
      : latest.discord.starterMessagesAppliedAt;
  writeLocalSecrets({
    ...latest,
    discord: {
      ...latest.discord,
      setupAppliedAt: result.appliedAt,
      createdChannelIds: result.channelIds,
      createdRoleIds: result.roleIds,
      streamAnnouncementChannelId:
        result.recommended.streamAnnouncementChannelId ||
        latest.discord.streamAnnouncementChannelId,
      generalAnnouncementChannelId:
        result.recommended.generalAnnouncementChannelId ||
        latest.discord.generalAnnouncementChannelId,
      streamAlertsRoleId:
        result.recommended.streamAlertsRoleId ||
        latest.discord.streamAlertsRoleId,
      operatorRoleId,
      staffRoleId: staffRoleId || latest.discord.staffRoleId,
      lockStaffCategory,
      setupTemplateId: template.id,
      createdMessageIds,
      starterMessagesAppliedAt,
    },
  });

  const relayOperatorRoleSync = operatorRoleId
    ? await syncDiscordOperatorRoleToRelay(operatorRoleId)
    : {
        ok: false,
        skipped: true,
        error: "No Discord operator role was resolved.",
      };

  appendSuiteTimelineEvent({
    sourceApp: "vaexcore-console",
    sourceAppName: "vaexcore console",
    kind: "discord.setup",
    title: "Discord setup applied",
    detail: `Console prepared ${result.createdChannels.length} Discord channels and ${result.createdRoles.length} roles.`,
    metadata: {
      guildId,
      includeRoles,
      applyPermissions,
      postStarterMessages,
      lockStaffCategory,
      createdChannelIds: Object.keys(result.channelIds),
      createdRoleIds: Object.keys(result.roleIds),
      createdMessageIds: Object.keys(createdMessageIds),
      permissionOverwritesApplied: result.permissionOverwritesApplied,
      starterMessagesPosted: result.starterMessagesPosted,
      operatorRoleId,
      relayOperatorRoleSynced: relayOperatorRoleSync.ok,
    },
  });

  return {
    ...result,
    relayOperatorRoleSync,
    config: getSafeDiscordConfig(),
  };
};

const sendDiscordAnnouncementRoute = async (body: unknown) => {
  const input = objectInput(body);
  const secrets = readLocalSecrets();
  const botToken = secrets.discord.botToken;
  const channelId =
    optionalInputString(input.channelId) ??
    getDiscordAnnouncementChannelId(secrets.discord);

  if (!botToken || !channelId) {
    throw new SafeInputError(
      "Discord bot token and announcement channel ID are required.",
    );
  }

  const announcement = discordAnnouncementInput(input, secrets);
  const sent = await sendDiscordAnnouncement({
    client: createDiscordClient(botToken),
    channelId,
    input: announcement,
  });

  appendSuiteTimelineEvent({
    sourceApp: "vaexcore-console",
    sourceAppName: "vaexcore console",
    kind: `discord.announcement.${announcement.kind}`,
    title: `Discord ${announcement.kind} announcement sent`,
    detail: announcement.title || "Discord stream announcement sent.",
    metadata: {
      channelId,
      messageId: sent.result.id,
      kind: announcement.kind,
    },
  });

  return {
    ok: true,
    channelId,
    messageId: sent.result.id,
    announcement,
  };
};

const discordAnnouncementInput = (
  input: Record<string, unknown>,
  secrets: LocalSecrets,
): DiscordAnnouncementInput => {
  const kind = optionalInputString(input.kind) || "live";
  if (
    !discordAnnouncementKinds.includes(kind as DiscordAnnouncementInput["kind"])
  ) {
    throw new SafeInputError("Discord announcement kind is not supported.");
  }

  const broadcasterName =
    optionalInputString(input.broadcasterName) ||
    secrets.twitch.broadcasterLogin ||
    "the channel";
  const defaultStreamUrl = secrets.twitch.broadcasterLogin
    ? `https://www.twitch.tv/${secrets.twitch.broadcasterLogin}`
    : undefined;
  const mentionRole = input.mentionRole !== false;

  return {
    kind: kind as DiscordAnnouncementInput["kind"],
    title: optionalInputString(input.title),
    detail: optionalInputString(input.detail),
    streamUrl: optionalInputString(input.streamUrl) || defaultStreamUrl,
    scheduledFor: optionalInputString(input.scheduledFor),
    broadcasterName,
    roleId: mentionRole
      ? optionalInputString(input.roleId) ||
        getDiscordStreamAlertsRoleId(secrets.discord)
      : undefined,
  };
};

const getDiscordRelayStatusRoute = async () => {
  const secrets = readLocalSecrets();
  const relay = getSafeDiscordRelayConfig(secrets);
  const connectionError = discordRelayConnectionError(secrets);
  if (connectionError) {
    return {
      ok: true,
      connected: false,
      relay,
      error: connectionError,
    };
  }

  try {
    const status = await createDiscordRelayClient(secrets).status();
    return {
      ok: true,
      connected: true,
      relay,
      readiness: status.readiness,
      hosted: status.config,
      templates: status.templates,
    };
  } catch (error) {
    return {
      ok: false,
      connected: false,
      relay,
      error: safeErrorMessage(error, "Discord Relay status check failed."),
    };
  }
};

const startDiscordRelayInstallRoute = async () => {
  const secrets = readLocalSecrets();
  const connectionError = discordRelayConnectionError(secrets);
  if (connectionError) {
    throw new SafeInputError(connectionError);
  }
  return createDiscordRelayClient(secrets).startInstall();
};

const previewDiscordRelaySetupRoute = async (body: unknown) => {
  const secrets = readLocalSecrets();
  const connectionError = discordRelayConnectionError(secrets);
  if (connectionError) {
    throw new SafeInputError(connectionError);
  }
  return createDiscordRelayClient(secrets).previewSetup(objectInput(body));
};

const applyDiscordRelaySetupRoute = async (body: unknown) => {
  const secrets = readLocalSecrets();
  const connectionError = discordRelayConnectionError(secrets);
  if (connectionError) {
    throw new SafeInputError(connectionError);
  }
  const input = objectInput(body);
  const client = createDiscordRelayClient(secrets);
  let result = await client.applySetup(input);
  let chunks = 1;
  while (discordRelaySetupNeedsContinuation(result) && chunks < 10) {
    await wait(250);
    result = await client.applySetup(input);
    chunks += 1;
  }
  appendSuiteTimelineEvent({
    sourceApp: "vaexcore-console",
    sourceAppName: "vaexcore console",
    kind: "discord.relay.setup",
    title: discordRelaySetupNeedsContinuation(result)
      ? "Hosted Discord setup partially applied"
      : "Hosted Discord setup applied",
    detail: discordRelaySetupNeedsContinuation(result)
      ? "Relay applied part of the hosted Discord server setup. Run Apply setup again to continue."
      : "Relay applied the hosted Discord server setup without exposing a bot token in Console.",
    metadata: {
      templateId:
        typeof result.template === "object" &&
        result.template &&
        "id" in result.template
          ? result.template.id
          : undefined,
      chunks,
    },
  });
  return result;
};

const discordRelaySetupNeedsContinuation = (result: Record<string, unknown>) =>
  result.needsContinuation === true;

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const registerDiscordRelayCommandsRoute = async () => {
  const secrets = readLocalSecrets();
  const connectionError = discordRelayConnectionError(secrets);
  if (connectionError) {
    throw new SafeInputError(connectionError);
  }
  const result = await createDiscordRelayClient(secrets).registerCommands();
  const current = readLocalSecrets();
  writeLocalSecrets({
    ...current,
    botValidation: {
      ...current.botValidation,
      discordSlashCommandsRegisteredAt: new Date().toISOString(),
    },
  });
  appendSuiteTimelineEvent({
    sourceApp: "vaexcore-console",
    sourceAppName: "vaexcore console",
    kind: "discord.relay.commands.register",
    title: "Discord slash commands registered",
    detail: `Console registered ${result.commands.length} Discord slash commands through Relay.`,
    metadata: {
      scope: result.scope,
      registeredAt: result.registeredAt,
      commands: result.commands,
    },
  });
  return result;
};

const getDiscordRelayEventsRoute = async () => {
  const secrets = readLocalSecrets();
  const connectionError = discordRelayConnectionError(secrets);
  if (connectionError) {
    throw new SafeInputError(connectionError);
  }
  const result = await createDiscordRelayClient(secrets).events(50);
  const persisted = persistDiscordRelayActions(db, result.events || []);
  if (persisted > 0) {
    writeAuditLog(
      db,
      localUiActor,
      "discord.relay.actions.load",
      "discord_relay_actions",
      {
        persisted,
        eventCount: result.events.length,
      },
    );
  }
  return {
    ...result,
    actions: listDiscordRelayActions(db, { status: "active", limit: 50 }),
  };
};

const getDiscordRelayActionsRoute = (searchParams: URLSearchParams) => ({
  ok: true,
  actions: listDiscordRelayActions(db, {
    status: parseDiscordRelayActionFilter(searchParams.get("status")),
    limit: searchParams.get("limit"),
  }),
});

const updateDiscordRelayActionStatusRoute = (body: unknown) => {
  const input = objectInput(body);
  const id =
    optionalInputString(input.relayEventId) || optionalInputString(input.id);
  if (!id) {
    throw new SafeInputError("Discord Relay action ID is required.");
  }
  const status = parseDiscordRelayActionStatus(input.status);
  const action = updateDiscordRelayActionStatus(db, id, status);
  if (!action) {
    throw new SafeInputError("Discord Relay action was not found.");
  }
  writeAuditLog(
    db,
    localUiActor,
    `discord.relay.action.${status}`,
    action.relayEventId,
    {
      commandName: action.commandName,
      username: action.username,
      status,
    },
  );
  return { ok: true, action };
};

const getDiscordRelaySuggestionsRoute = async (
  searchParams: URLSearchParams,
) => {
  const secrets = readLocalSecrets();
  const connectionError = discordRelayConnectionError(secrets);
  if (connectionError) {
    throw new SafeInputError(connectionError);
  }
  return createDiscordRelayClient(secrets).suggestions(
    optionalRelaySuggestionStatus(searchParams.get("status")),
  );
};

const updateDiscordRelaySuggestionRoute = async (body: unknown) => {
  const input = objectInput(body);
  const id = optionalInputString(input.id);
  if (!id) {
    throw new SafeInputError("Discord suggestion ID is required.");
  }
  const status = relaySuggestionStatus(input.status);
  const secrets = readLocalSecrets();
  const connectionError = discordRelayConnectionError(secrets);
  if (connectionError) {
    throw new SafeInputError(connectionError);
  }
  return createDiscordRelayClient(secrets).updateSuggestionStatus(id, status);
};

const discordRelayConnectionError = (secrets = readLocalSecrets()) => {
  const relay = secrets.relay;
  const readiness = relayConfigReadiness({
    baseUrl: relay.baseUrl,
    installationId: relay.installationId,
    consoleToken: relay.consoleToken,
  });
  if (!readiness.ready) {
    return "Save Relay URL, installation ID, and console token before using Discord slash command Relay mode.";
  }
  return "";
};

const createDiscordRelayClient = (secrets = readLocalSecrets()) =>
  new DiscordRelayClient({
    baseUrl: secrets.relay.baseUrl,
    installationId: secrets.relay.installationId,
    consoleToken: secrets.relay.consoleToken,
  });

const syncDiscordOperatorRoleToRelay = async (operatorRoleId: string) => {
  const secrets = readLocalSecrets();
  const connectionError = discordRelayConnectionError(secrets);
  if (connectionError) {
    return { ok: false, skipped: true, error: connectionError };
  }
  try {
    const result = await createDiscordRelayClient(secrets).updateConfig({
      operatorRoleId,
    });
    return { ...result, skipped: false };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      error: safeErrorMessage(
        error,
        "Relay could not save the Discord operator role.",
      ),
    };
  }
};

const recordRelayChatbotIdentityValidation = (body: unknown) => {
  const input = objectInput(body);
  const existing = readLocalSecrets();
  const confirmed = input.confirmed !== false;
  const note = sanitizeOptionalText(
    optionalInputString(input.note),
    "Chat Bot identity validation note",
    240,
  );
  writeLocalSecrets({
    ...existing,
    relay: {
      ...existing.relay,
      chatbotIdentityValidatedAt: confirmed
        ? new Date().toISOString()
        : undefined,
      chatbotIdentityValidationNote: confirmed ? note : undefined,
    },
    botValidation: {
      ...existing.botValidation,
      twitchChatBotUserListConfirmedAt: confirmed
        ? new Date().toISOString()
        : undefined,
    },
  });
  return { ok: true, relay: getSafeRelayConfig() };
};

const getBotCompletionRoute = async () => {
  const secrets = readLocalSecrets();
  const [relayStatus, relayReport, discordRelayStatus] = await Promise.all([
    getRelayStatusRoute(),
    getRelayReadinessReport(secrets),
    getDiscordRelayStatusRoute(),
  ]);
  const validation = getSafeBotValidation(secrets);
  const relay = getSafeRelayConfig(secrets);
  const localDiscord = getDiscordReadiness(secrets);
  const records = validation.records;
  const checks = buildBotCompletionChecks({
    secrets,
    relayStatus,
    relayReport,
    discordRelayStatus,
    localDiscord,
    records,
    setupMode: getSetupMode(secrets),
  });
  const sections = buildBotCompletionSections(checks);
  const nextActions = checks
    .filter((check) => !check.complete)
    .map((check) => check.nextAction)
    .filter(Boolean)
    .slice(0, 8);
  const completed = checks.filter((check) => check.complete).length;
  const completionPercent = Math.round((completed / checks.length) * 100);
  const operatorStatus = botCompletionOperatorStatus({
    completionPercent,
    sections,
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    status: operatorStatus.status,
    statusLabel: operatorStatus.label,
    statusDetail: operatorStatus.detail,
    completionPercent,
    completed,
    total: checks.length,
    checks,
    sections,
    nextActions,
    validation,
    relay,
    relayStatus,
    relayReadinessReport: relayReport,
    setupChecks: getSafeSetupChecks(secrets),
    modeCapabilities: getSetupCapabilitySummary(getSetupMode(secrets)),
    discordSetup: getDiscordSetupSummary(secrets),
    discord: {
      localReadiness: localDiscord,
      localConfig: getSafeDiscordConfig(secrets),
      relay: discordRelayStatus,
    },
    setupMode: getSetupMode(secrets),
    transportMode: secrets.relay.twitchTransportMode,
  };
};

const getSetupCapabilitySummary = (setupMode: SetupMode) => {
  const local = [
    "Local Twitch chat send while Console is running.",
    "Local Discord announcements and server layout setup.",
    "Giveaway controls and OBS overlay from this machine.",
  ];
  const relay = [
    "Hosted Relay handles public callbacks and webhook endpoints.",
    "Relay Chat Bot identity and Discord slash-command workflows.",
    "Console remains the local operator review surface.",
  ];

  if (setupMode === "advanced") {
    return [...local, ...relay];
  }

  return setupMode === "relay-assisted" ? relay : local;
};

const getDiscordSetupSummary = (secrets = readLocalSecrets()) => {
  const discord = getSafeDiscordConfig(secrets);
  return {
    templateId: discord.setupTemplateId,
    templateName: discord.setupTemplate.name,
    setupAppliedAt: discord.setupAppliedAt,
    staffPrivacy: {
      enabled: discord.lockStaffCategory,
      staffRoleSelected: Boolean(discord.staffRoleId),
      staffRoleId: discord.staffRoleId,
    },
    createdChannelKeys: Object.keys(discord.createdChannelIds || {}).sort(),
    createdRoleKeys: Object.keys(discord.createdRoleIds || {}).sort(),
    recommendedMappings: {
      streamAlerts: discord.streamAnnouncementChannelId,
      announcements: discord.generalAnnouncementChannelId,
      streamAlertsRole: discord.streamAlertsRoleId,
    },
  };
};

const getRelayReadinessReport = async (
  secrets = readLocalSecrets(),
): Promise<
  | { ok: true; connected: true; report: RelayBotReadinessReport }
  | { ok: false; connected: false; error: string }
> => {
  if (relayConnectionError(secrets)) {
    return {
      ok: false,
      connected: false,
      error:
        "Relay readiness report was not requested because local Relay pairing is incomplete.",
    };
  }

  try {
    return {
      ok: true,
      connected: true,
      report: await createRelayChatClient(secrets).readinessReport(),
    };
  } catch (error) {
    return {
      ok: false,
      connected: false,
      error: safeErrorMessage(error, "Relay readiness report failed."),
    };
  }
};

const buildBotCompletionChecks = ({
  secrets,
  relayStatus,
  relayReport,
  discordRelayStatus,
  localDiscord,
  records,
  setupMode,
}: {
  secrets: LocalSecrets;
  relayStatus: Awaited<ReturnType<typeof getRelayStatusRoute>>;
  relayReport: Awaited<ReturnType<typeof getRelayReadinessReport>>;
  discordRelayStatus: Awaited<ReturnType<typeof getDiscordRelayStatusRoute>>;
  localDiscord: ReturnType<typeof getDiscordReadiness>;
  records: Record<BotValidationKey, string>;
  setupMode: SetupMode;
}) => {
  const relayReadinessChecks =
    relayReport.ok && relayReport.report
      ? relayReport.report.checks || []
      : relayStatus.connected
        ? relayStatus.readiness?.checks || []
        : [];
  const checkByKey = (key: string) =>
    relayReadinessChecks.find((item) => item.key === key);
  const discordChecks = discordRelayStatus.ok
    ? discordRelayStatus.readiness?.checks || []
    : relayReport.ok && relayReport.report
      ? relayReport.report.checks || []
      : [];
  const discordCheckByKey = (key: string) =>
    discordChecks.find((item) => item.key === key);

  const localMissing = [
    secrets.twitch.clientId ? null : "Client ID",
    secrets.twitch.clientSecret ? null : "Client Secret",
    secrets.twitch.redirectUri ? null : "Redirect URI",
    secrets.twitch.broadcasterLogin ? null : "Broadcaster Login",
    secrets.twitch.botLogin ? null : "Bot Login",
  ].filter(Boolean) as string[];
  const localChecks = [
    botCompletionCheck(
      "twitch-transport-local",
      "Twitch transport is Local",
      secrets.relay.twitchTransportMode !== "relay-chatbot",
      "Select Local mode when you want chat sends to use the local Twitch OAuth token.",
    ),
    botCompletionCheck(
      "twitch-local-config",
      "Local Twitch setup fields are saved",
      localMissing.length === 0,
      `Save ${localMissing.join(", ")} for local Twitch setup.`,
    ),
    botCompletionCheck(
      "twitch-local-oauth",
      "Local Twitch OAuth token is saved",
      Boolean(secrets.twitch.accessToken),
      "Use Connect Twitch as Bot Login for local chat sends.",
    ),
    botCompletionCheck(
      "discord-local-setup",
      "Local Discord announcements and layout are ready",
      localDiscord.ready,
      "Save Discord bot token, server ID, and announcement channel if Console should manage local Discord setup.",
    ),
  ];
  const relayCompletionChecks = [
    botCompletionCheck(
      "relay-paired",
      "Console paired to Relay",
      !relayConnectionError(secrets),
      "Start hosted Twitch setup.",
    ),
    botCompletionCheck(
      "twitch-transport-relay",
      "Twitch transport is relay-chatbot",
      secrets.relay.twitchTransportMode === "relay-chatbot",
      "Select Hosted mode in Settings.",
    ),
    botCompletionCheck(
      "twitch-bot-oauth",
      botValidationLabels.twitchBotOAuthCompletedAt,
      Boolean(records.twitchBotOAuthCompletedAt || checkByKey("bot-grant")?.ok),
      "Log in as vaexcorebot when Console opens the bot auth window.",
    ),
    botCompletionCheck(
      "twitch-broadcaster-oauth",
      botValidationLabels.twitchBroadcasterOAuthCompletedAt,
      Boolean(
        records.twitchBroadcasterOAuthCompletedAt ||
        checkByKey("broadcaster-grant")?.ok,
      ),
      "Log in as the channel owner when Console opens the broadcaster auth window.",
    ),
    botCompletionCheck(
      "twitch-separate-account",
      "Twitch bot and broadcaster accounts are separate",
      Boolean(checkByKey("separate-bot-account")?.ok),
      "Relay must show vaexcorebot and broadcaster grants as separate accounts.",
    ),
    botCompletionCheck(
      "twitch-eventsub",
      botValidationLabels.twitchEventSubRegisteredAt,
      Boolean(
        records.twitchEventSubRegisteredAt ||
        checkByKey("latest-eventsub-registration")?.ok,
      ),
      "Register EventSub through Console after OAuth grants are ready.",
    ),
    botCompletionCheck(
      "twitch-test-send",
      botValidationLabels.twitchRelayTestSendPassedAt,
      Boolean(
        records.twitchRelayTestSendPassedAt ||
        checkByKey("latest-outbound-send")?.ok,
      ),
      "Send a Relay test message through Console.",
    ),
    botCompletionCheck(
      "twitch-chatbot-user-list",
      botValidationLabels.twitchChatBotUserListConfirmedAt,
      Boolean(
        records.twitchChatBotUserListConfirmedAt ||
        secrets.relay.chatbotIdentityValidatedAt,
      ),
      "Confirm Twitch lists vaexcorebot as a Chat Bot in the channel user list.",
    ),
    botCompletionCheck(
      "discord-worker-config",
      "Discord Worker secrets are configured",
      Boolean(
        discordCheckByKey("discord-bot-token")?.ok &&
        discordCheckByKey("discord-public-key")?.ok &&
        discordCheckByKey("discord-application-id")?.ok &&
        discordCheckByKey("discord-client-secret")?.ok,
      ),
      "Set Discord Worker secrets on Relay.",
    ),
    botCompletionCheck(
      "discord-guild-connected",
      "Discord server is connected",
      Boolean(discordCheckByKey("discord-guild-id")?.ok),
      "Connect Discord from Console so Relay knows which server to manage.",
    ),
    botCompletionCheck(
      "discord-interaction-endpoint",
      botValidationLabels.discordInteractionEndpointAcceptedAt,
      Boolean(
        records.discordInteractionEndpointAcceptedAt ||
        discordCheckByKey("discord-interaction-url")?.ok,
      ),
      "Set the Discord Interactions Endpoint to the Relay URL.",
    ),
    botCompletionCheck(
      "discord-slash-commands",
      botValidationLabels.discordSlashCommandsRegisteredAt,
      Boolean(
        records.discordSlashCommandsRegisteredAt ||
        discordCheckByKey("discord-command-registration")?.ok,
      ),
      "Register Discord slash commands through Console after Discord is connected.",
    ),
    botCompletionCheck(
      "discord-suggest-tested",
      botValidationLabels.discordSuggestCommandTestedAt,
      Boolean(records.discordSuggestCommandTestedAt),
      "Run /suggest in Discord and confirm it appears in Console.",
    ),
    botCompletionCheck(
      "discord-announcement-tested",
      botValidationLabels.discordAnnouncementCommandTestedAt,
      Boolean(records.discordAnnouncementCommandTestedAt),
      "Run /live, /late, /cancelled, or /scheduled and confirm Console review behavior.",
    ),
  ];

  if (setupMode === "local-only") {
    return localChecks;
  }

  if (setupMode === "advanced") {
    return [...localChecks, ...relayCompletionChecks];
  }

  return relayCompletionChecks;
};

const botCompletionCheck = (
  key: string,
  label: string,
  complete: boolean,
  nextAction: string,
) => ({
  key,
  label,
  complete,
  state: complete ? "ready" : "todo",
  nextAction: complete ? "" : nextAction,
});

const buildBotCompletionSections = (
  checks: ReturnType<typeof botCompletionCheck>[],
) => {
  const byKey = new Map(checks.map((check) => [check.key, check]));
  const sectionDefinitions = [
    {
      key: "local-console",
      title: "Local Twitch",
      incompleteState: "blocked",
      readyDetail:
        "Local Twitch setup is ready to send chat through the saved OAuth user token.",
      blockedDetail:
        "Complete local Twitch app fields and OAuth before local chat sends can pass.",
      checkKeys: [
        "twitch-transport-local",
        "twitch-local-config",
        "twitch-local-oauth",
      ],
    },
    {
      key: "local-discord",
      title: "Local Discord",
      incompleteState: "needs setup",
      readyDetail:
        "Console can manage Discord announcements and server layout locally.",
      blockedDetail:
        "Save Discord bot token, server ID, and announcement channel before local Discord actions are ready.",
      checkKeys: ["discord-local-setup"],
    },
    {
      key: "relay-pairing",
      title: "Relay pairing",
      incompleteState: "blocked",
      readyDetail:
        "Console is paired to Relay and configured for hosted Chat Bot transport.",
      blockedDetail:
        "Pair Console with Relay and select relay-chatbot transport before live setup can proceed.",
      checkKeys: ["relay-paired", "twitch-transport-relay"],
    },
    {
      key: "twitch-credentials",
      title: "Twitch credentials",
      incompleteState: "needs credentials",
      readyDetail:
        "OAuth grants, account separation, and EventSub records are present.",
      blockedDetail:
        "Complete the bot grant, broadcaster grant, account separation, and EventSub records.",
      checkKeys: [
        "twitch-bot-oauth",
        "twitch-broadcaster-oauth",
        "twitch-separate-account",
        "twitch-eventsub",
      ],
    },
    {
      key: "discord-relay",
      title: "Discord Relay",
      incompleteState: "needs setup",
      readyDetail:
        "Discord server, Worker secrets, endpoint, and slash commands are ready.",
      blockedDetail:
        "Connect Discord to this Relay installation, verify Worker secrets, and register commands.",
      checkKeys: [
        "discord-worker-config",
        "discord-guild-connected",
        "discord-interaction-endpoint",
        "discord-slash-commands",
      ],
    },
    {
      key: "live-validation",
      title: "Live validation",
      incompleteState: "live validation required",
      readyDetail:
        "Twitch test sends, Chat Bot user-list confirmation, and Discord command tests are recorded.",
      blockedDetail:
        "Run the Twitch and Discord live checks, then record the operator confirmations.",
      checkKeys: [
        "twitch-test-send",
        "twitch-chatbot-user-list",
        "discord-suggest-tested",
        "discord-announcement-tested",
      ],
    },
  ] as const;

  const sections = sectionDefinitions.flatMap((definition) => {
    const sectionChecks = definition.checkKeys
      .map((key) => byKey.get(key))
      .filter((check): check is ReturnType<typeof botCompletionCheck> =>
        Boolean(check),
      );
    if (!sectionChecks.length) {
      return [];
    }
    const pending = sectionChecks.filter((check) => !check.complete);
    return [
      {
        key: definition.key,
        title: definition.title,
        state: pending.length ? definition.incompleteState : "ready",
        detail: pending.length
          ? definition.blockedDetail
          : definition.readyDetail,
        complete: pending.length === 0,
        completed: sectionChecks.length - pending.length,
        total: sectionChecks.length,
        nextAction: pending[0]?.nextAction ?? "",
        checks: sectionChecks,
      },
    ];
  });

  return [
    ...sections,
    {
      key: "support-export",
      title: "Support/export",
      state: "ready",
      detail:
        "Bot-only support bundle copy and export use the secret-safe support route.",
      complete: true,
      completed: 1,
      total: 1,
      nextAction: "",
      checks: [],
    },
  ];
};

const botCompletionOperatorStatus = ({
  completionPercent,
  sections,
}: {
  completionPercent: number;
  sections: ReturnType<typeof buildBotCompletionSections>;
}) => {
  if (completionPercent === 100) {
    return {
      status: "ready",
      label: "ready",
      detail:
        "Code readiness is complete. Remaining risk is external live-service validation.",
    };
  }

  const blocked = sections.find((section) => section.state === "blocked");
  if (blocked) {
    return {
      status: "blocked",
      label: "blocked",
      detail: blocked.nextAction || blocked.detail,
    };
  }

  const credentials = sections.find(
    (section) =>
      section.state === "needs credentials" || section.state === "needs setup",
  );
  if (credentials) {
    return {
      status:
        credentials.state === "needs setup"
          ? "needs-setup"
          : "needs-credentials",
      label:
        credentials.state === "needs setup"
          ? "needs setup"
          : "needs credentials",
      detail: credentials.nextAction || credentials.detail,
    };
  }

  const liveValidation = sections.find(
    (section) => section.state === "live validation required",
  );
  if (liveValidation) {
    return {
      status: "live-validation-required",
      label: "live validation required",
      detail: liveValidation.nextAction || liveValidation.detail,
    };
  }

  return {
    status: "needs-review",
    label: "needs review",
    detail: "Review bot completion checks before calling setup complete.",
  };
};

const recordBotValidation = (body: unknown) => {
  const input = objectInput(body);
  const key = botValidationKey(input.key);
  const confirmed = input.confirmed !== false;
  const existing = readLocalSecrets();
  const timestamp = confirmed ? new Date().toISOString() : undefined;
  const next: LocalSecrets = {
    ...existing,
    botValidation: {
      ...existing.botValidation,
      [key]: timestamp,
    },
  };

  if (key === "twitchChatBotUserListConfirmedAt") {
    next.relay = {
      ...next.relay,
      chatbotIdentityValidatedAt: timestamp,
      chatbotIdentityValidationNote: confirmed
        ? "Operator confirmed Twitch user list shows vaexcorebot as Chat Bot."
        : undefined,
    };
  }

  writeLocalSecrets(next);
  return { ok: true, validation: getSafeBotValidation() };
};

const botValidationKey = (value: unknown): BotValidationKey => {
  if (
    typeof value === "string" &&
    botValidationKeys.includes(value as BotValidationKey)
  ) {
    return value as BotValidationKey;
  }
  throw new SafeInputError("Unknown bot validation record key.");
};

const getBotSupportBundleRoute = async () => {
  const [completion, supportBundle, discordEvents, discordSuggestions] =
    await Promise.all([
      getBotCompletionRoute(),
      getSupportBundle(),
      getOptionalDiscordRelayEvents(),
      getOptionalDiscordRelaySuggestions(),
    ]);
  const discordActionHistory = listDiscordRelayActions(db, {
    status: undefined,
    limit: 100,
  });
  return {
    ok: true,
    bundleVersion: 1,
    generatedAt: new Date().toISOString(),
    note: "Secret-safe bot setup support bundle. It reports presence and readiness only, never tokens or secrets.",
    completion,
    setup: {
      mode: completion.setupMode,
      setupChecks: completion.setupChecks,
      modeCapabilities: completion.modeCapabilities,
    },
    discordSetup: completion.discordSetup,
    relayDiagnostics: completion.relayReadinessReport,
    validationRecords: completion.validation,
    queuedDiscordActions: discordActionHistory.filter((action) =>
      ["queued", "approved"].includes(action.status),
    ),
    discordActionHistory,
    relayEventFetch: {
      ok: discordEvents.ok,
      error: "error" in discordEvents ? discordEvents.error : undefined,
    },
    suggestions: discordSuggestions.suggestions,
    recentSendOutcomes: supportBundle.recent.outbound.slice(0, 20),
    nextActions: completion.nextActions,
  };
};

const getOptionalDiscordRelayEvents = async () => {
  try {
    return await getDiscordRelayEventsRoute();
  } catch (error) {
    return {
      ok: false,
      events: [],
      error: safeErrorMessage(error, "Discord Relay events are unavailable."),
    };
  }
};

const getOptionalDiscordRelaySuggestions = async () => {
  try {
    return await getDiscordRelaySuggestionsRoute(new URLSearchParams());
  } catch (error) {
    return {
      ok: false,
      suggestions: [],
      error: safeErrorMessage(
        error,
        "Discord Relay suggestions are unavailable.",
      ),
    };
  }
};

const runBotSetupRehearsalRoute = async () => {
  const completion = await getBotCompletionRoute();
  const setupUrls = getRelaySetupUrls(readLocalSecrets().relay);
  const steps = [
    dryRunStep(
      "twitch-callback",
      "Hosted Twitch callback URL",
      Boolean(setupUrls.twitchCallbackUrl),
      setupUrls.twitchCallbackUrl ||
        "Start hosted Twitch setup before generating the callback URL.",
    ),
    dryRunStep(
      "bot-oauth",
      "Generate bot OAuth URL",
      Boolean(setupUrls.twitchBotOAuthUrl),
      setupUrls.twitchBotOAuthUrl || "Save Relay installation ID first.",
    ),
    dryRunStep(
      "broadcaster-oauth",
      "Generate broadcaster OAuth URL",
      Boolean(setupUrls.twitchBroadcasterOAuthUrl),
      setupUrls.twitchBroadcasterOAuthUrl ||
        "Save Relay installation ID first.",
    ),
    dryRunStep(
      "eventsub",
      "Mock Twitch EventSub registration",
      true,
      "Dry run would call Relay EventSub registration after OAuth grants are live.",
    ),
    dryRunStep(
      "relay-send",
      "Mock Relay chat send",
      true,
      "Dry run would send a Relay test chat message with an idempotency key.",
    ),
    dryRunStep(
      "chatbot-identity",
      "Mock Twitch Chat Bot user-list confirmation",
      true,
      "Dry run keeps this as an operator validation record until live Twitch confirms it.",
    ),
    dryRunStep(
      "discord-endpoint",
      "Generate Discord interaction endpoint",
      Boolean(setupUrls.discordInteractionUrl),
      setupUrls.discordInteractionUrl ||
        "Save Relay URL before generating the Discord interaction endpoint.",
    ),
    dryRunStep(
      "discord-commands",
      "Mock Discord slash command registration",
      true,
      "Dry run would register /suggest, /live, /late, /cancelled, /scheduled, and /setup-status after Discord Worker secrets are live.",
    ),
    dryRunStep(
      "discord-command-tests",
      "Mock Discord command validation",
      true,
      "Dry run would confirm /suggest queues a suggestion and announcement commands queue operator-visible actions.",
    ),
  ];
  return {
    ok: true,
    dryRun: true,
    generatedAt: new Date().toISOString(),
    steps,
    completion,
    nextActions: completion.nextActions,
  };
};

const runFullLocalRehearsalRoute = async () => {
  const secrets = readLocalSecrets();
  const setupMode = getSetupMode(secrets);
  const generatedAt = new Date().toISOString();
  const [
    completion,
    botRehearsal,
    relayStatus,
    discordPreview,
    diagnostics,
    supportBundle,
  ] = await Promise.all([
    getBotCompletionRoute(),
    runBotSetupRehearsalRoute(),
    getRelayStatusRoute(),
    previewDiscordSetup({ includeRoles: true }),
    Promise.resolve(getDiagnosticsReport()),
    getSupportBundle(),
  ]);
  const giveawayState = getGiveawayState();
  const giveawayExport = giveawaysService.exportResults();
  const supportBundleSafe = supportBundleExcludesSecrets(
    supportBundle,
    secrets,
  );
  const discordPlan = discordPreview.plan;
  const discordActions = Array.isArray(discordPlan?.actions)
    ? discordPlan.actions.length
    : 0;
  const activeTimers = supportBundle.recent.timers.filter(
    (timer) => timer.enabled,
  ).length;
  const relayOptional = setupMode === "local-only";
  const relayReady = relayStatus.ok && (relayStatus.connected || relayOptional);
  const steps = [
    dryRunStep(
      "setup-mode",
      "Resolve operating mode",
      true,
      `${setupModeDisplayLabel(setupMode)} contract loaded with ${completion.modeCapabilities.length} capability note(s).`,
    ),
    dryRunStep(
      "bot-completion",
      "Refresh bot completion",
      completion.ok === true,
      `${completion.completed}/${completion.total} checks complete; status is ${completion.statusLabel}.`,
    ),
    dryRunStep(
      "relay-status",
      "Check Relay status contract",
      relayReady,
      relayStatus.connected
        ? "Relay status responded with installation/readiness metadata."
        : relayOptional
          ? "Local mode does not require Relay to be paired."
          : relayStatus.error || "Relay status was not available.",
    ),
    dryRunStep(
      "discord-baseline-preview",
      "Preview Discord baseline setup",
      discordPreview.ok === true,
      discordPreview.connected
        ? `Preview loaded from Discord with ${discordActions} planned action(s).`
        : `${discordActions} local template action(s) can be previewed without applying changes.`,
    ),
    dryRunStep(
      "giveaway-state",
      "Read giveaway operator state",
      giveawayState.ok === true,
      `${giveawayState.summary.status} giveaway state, ${giveawayState.summary.entryCount} entrant(s), ${giveawayState.summary.pendingConfirmationCount} pending winner(s), ${giveawayState.summary.expiredWinnerCount} expired winner(s).`,
    ),
    dryRunStep(
      "giveaway-export",
      "Build redacted giveaway export",
      Boolean(giveawayExport),
      "Giveaway export built from local audit/history data without game keys.",
    ),
    dryRunStep(
      "timers",
      "Inspect timer readiness",
      true,
      `${activeTimers} enabled timer(s) found; rehearsal does not send timer messages.`,
    ),
    dryRunStep(
      "diagnostics",
      "Run diagnostics",
      diagnostics.ok === true,
      diagnostics.readiness.nextAction,
    ),
    dryRunStep(
      "support-bundle-redaction",
      "Verify support export redaction",
      supportBundleSafe,
      supportBundleSafe
        ? "Support bundle excludes saved token, secret, and bot token values."
        : "Support bundle contained a saved secret value and must not be shared.",
    ),
  ];

  return {
    ok: steps.every((step) => step.ok),
    dryRun: true,
    generatedAt,
    setupMode,
    status: steps.every((step) => step.ok) ? "ready" : "attention",
    steps,
    completion,
    botRehearsal,
    relayStatus,
    discordPreview: {
      ok: discordPreview.ok,
      connected: discordPreview.connected,
      message: "message" in discordPreview ? discordPreview.message : "",
      template: discordPreview.template,
      plan: discordPreview.plan,
    },
    giveaway: {
      summary: giveawayState.summary,
      assurance: giveawayState.assurance,
      export: giveawayExport,
    },
    diagnostics: {
      ok: diagnostics.ok,
      readiness: diagnostics.readiness,
      generatedAt: diagnostics.generatedAt,
    },
    supportBundle: {
      ok: supportBundle.ok,
      generatedAt: supportBundle.generatedAt,
      setup: supportBundle.setup,
      discordSetup: supportBundle.discordSetup,
      recentCounts: {
        outbound: supportBundle.recent.outbound.length,
        audit: supportBundle.recent.audit.length,
        timers: supportBundle.recent.timers.length,
        customCommandInvocations:
          supportBundle.recent.customCommandInvocations.length,
      },
      redacted: supportBundleSafe,
    },
    nextActions: completion.nextActions,
  };
};

const supportBundleExcludesSecrets = (
  supportBundle: unknown,
  secrets: LocalSecrets,
) => {
  const serialized = JSON.stringify(supportBundle);
  const forbidden = [
    secrets.twitch.clientSecret,
    secrets.twitch.accessToken,
    secrets.twitch.refreshToken,
    secrets.discord.botToken,
    secrets.relay.consoleToken,
  ].filter((value): value is string => Boolean(value && value.length > 3));

  return forbidden.every((value) => !serialized.includes(value));
};

const dryRunStep = (
  key: string,
  label: string,
  ok: boolean,
  detail: string,
) => ({
  key,
  label,
  ok,
  status: ok ? "pass" : "todo",
  detail,
});

const optionalRelaySuggestionStatus = (
  value: string | null,
): DiscordRelaySuggestionStatus | undefined =>
  value ? relaySuggestionStatus(value) : undefined;

const relaySuggestionStatus = (
  value: unknown,
): DiscordRelaySuggestionStatus => {
  if (
    value === "new" ||
    value === "reviewed" ||
    value === "accepted" ||
    value === "rejected" ||
    value === "archived"
  ) {
    return value;
  }
  throw new SafeInputError(
    "Discord suggestion status must be new, reviewed, accepted, rejected, or archived.",
  );
};

const discordConnectionError = (
  options: { requireAnnouncementChannel?: boolean } = {},
) => {
  const discord = readLocalSecrets().discord;
  if (!discord.botToken) {
    return "Save a Discord bot token before using Discord setup.";
  }
  if (!discord.guildId) {
    return "Save the Discord server ID before using Discord setup.";
  }
  if (
    options.requireAnnouncementChannel &&
    !getDiscordAnnouncementChannelId(discord)
  ) {
    return "Apply Discord setup or save a stream announcement channel ID before sending announcements.";
  }

  return "";
};

const createDiscordClient = (botToken: string) =>
  new DiscordApiClient({
    botToken,
    apiBaseUrl: process.env.DISCORD_API_BASE_URL,
  });

const getDiscordAnnouncementChannelId = (
  discord: LocalSecrets["discord"],
): string | undefined => {
  const template = getDiscordSetupTemplate(discord.setupTemplateId);
  return (
    discord.streamAnnouncementChannelId ||
    discord.createdChannelIds?.[
      template.recommended.streamAnnouncementChannelId
    ]
  );
};

const getDiscordStreamAlertsRoleId = (
  discord: LocalSecrets["discord"],
): string | undefined => {
  const template = getDiscordSetupTemplate(discord.setupTemplateId);
  return (
    discord.streamAlertsRoleId ||
    discord.createdRoleIds?.[template.recommended.streamAlertsRoleId]
  );
};

const objectInput = (body: unknown): Record<string, unknown> =>
  body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};

const optionalInputString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const normalizeDiscordSetupTemplateId = (
  value?: string,
): string | undefined => {
  if (!value) return undefined;
  const template = discordSetupTemplates.find((item) => item.id === value);
  if (!template) {
    throw new SafeInputError("Select a valid Discord server layout preset.");
  }
  return template.id;
};

const getTwitchCreatorOpsState = () => {
  const secrets = readLocalSecrets();
  const twitch = secrets.twitch;
  const hasScope = (scope: string) => (twitch.scopes ?? []).includes(scope);
  const identityReady = Boolean(
    twitch.clientId &&
    twitch.accessToken &&
    twitch.broadcasterUserId &&
    twitch.botUserId,
  );
  const scopeChecks = optionalCreatorOpsScopes.map((scope) => ({
    scope,
    ok: hasScope(scope),
  }));
  const logs = getRecentAuditLogs(db, 100).filter((log) =>
    log.action.startsWith("twitch.creator_ops."),
  );

  return {
    ok: true,
    readiness: {
      ready: identityReady && scopeChecks.every((scope) => scope.ok),
      identityReady,
      broadcasterLogin: twitch.broadcasterLogin ?? "",
      botLogin: twitch.botLogin ?? "",
      missingScopes: scopeChecks
        .filter((scope) => !scope.ok)
        .map((scope) => scope.scope),
      checks: [
        {
          name: "Twitch identity",
          ok: identityReady,
          detail: identityReady
            ? "Twitch bot and broadcaster IDs are saved."
            : "Complete Twitch setup before using creator ops.",
        },
        ...scopeChecks.map((scope) => ({
          name: scope.scope,
          ok: scope.ok,
          detail: scope.ok
            ? `${scope.scope} is granted.`
            : `Reconnect Twitch with ${scope.scope}.`,
        })),
      ],
    },
    logs,
  };
};

const runTwitchCreatorOpsRoute = async (path: string, body: unknown) => {
  const input = objectInput(body);

  if (input.confirmed !== true) {
    return {
      ok: false,
      confirmationRequired: true,
      error: "Guarded Live confirmation is required for Twitch creator ops.",
      state: getTwitchCreatorOpsState(),
    };
  }

  try {
    const action = path.replace("/api/twitch/creator-ops/", "");
    const result = await runTwitchCreatorOpsAction(action, input);
    return {
      ok: true,
      action,
      result,
      state: getTwitchCreatorOpsState(),
    };
  } catch (error) {
    logger.warn(
      { error: redactSecrets(error), path },
      "Twitch creator ops action failed",
    );
    return {
      ok: false,
      error: safeErrorMessage(error, "Twitch creator ops action failed."),
      state: getTwitchCreatorOpsState(),
    };
  }
};

const runTwitchCreatorOpsAction = async (
  action: string,
  input: Record<string, unknown>,
) => {
  const client = createTwitchCreatorOpsClient();
  const execute = async (activeClient: TwitchCreatorOpsClient) => {
    switch (action) {
      case "poll":
        return activeClient.createPoll(normalizePollInput(input));
      case "poll/end":
        return activeClient.endPoll({
          id: creatorOpsId(input.id, "Poll ID"),
          status:
            optionalInputString(input.status) === "ARCHIVED"
              ? "ARCHIVED"
              : "TERMINATED",
        });
      case "prediction":
        return activeClient.createPrediction(normalizePredictionInput(input));
      case "prediction/end":
        return activeClient.endPrediction(normalizeEndPredictionInput(input));
      case "announcement":
        return activeClient.sendAnnouncement(normalizeAnnouncementInput(input));
      case "shoutout":
        return activeClient.sendShoutout({
          targetLogin: creatorOpsLogin(input.targetLogin, "Shoutout target"),
        });
      case "raid":
        return activeClient.startRaid({
          targetLogin: creatorOpsLogin(input.targetLogin, "Raid target"),
        });
      case "raid/cancel":
        return activeClient.cancelRaid();
      default:
        throw new SafeInputError(
          `Unsupported Twitch creator ops action: ${action}`,
        );
    }
  };

  try {
    const result = await execute(client);
    auditTwitchCreatorOps(action, input, result);
    return result;
  } catch (error) {
    if (!(error instanceof TwitchCreatorOpsError) || error.status !== 401) {
      throw error;
    }

    const refreshed = await refreshStoredTwitchToken({
      expectedClientId: readLocalSecrets().twitch.clientId,
      expectedBotUserId: readLocalSecrets().twitch.botUserId,
      expectedBotLogin: readLocalSecrets().twitch.botLogin,
      logger,
    });
    const retryClient = createTwitchCreatorOpsClient(refreshed.secrets);
    const result = await execute(retryClient);
    auditTwitchCreatorOps(action, input, result, { refreshed: true });
    return result;
  }
};

const createTwitchCreatorOpsClient = (secrets = readLocalSecrets()) => {
  const twitch = secrets.twitch;

  if (
    !twitch.clientId ||
    !twitch.accessToken ||
    !twitch.broadcasterUserId ||
    !twitch.botUserId
  ) {
    throw new SafeInputError("Complete Twitch setup before using creator ops.");
  }

  return new TwitchCreatorOpsClient({
    clientId: twitch.clientId,
    accessToken: twitch.accessToken,
    broadcasterId: twitch.broadcasterUserId,
    moderatorId: twitch.botUserId,
    logger,
    apiBaseUrl: process.env.TWITCH_API_BASE_URL,
  });
};

const normalizePollInput = (input: Record<string, unknown>): PollInput => ({
  title: creatorOpsText(input.title, "Poll title", 60),
  choices: creatorOpsList(input.choices, "Poll choices", 2, 5, 60),
  durationSeconds: parseSafeInteger(input.durationSeconds, {
    field: "Poll duration",
    fallback: 120,
    min: 15,
    max: 1800,
  }),
  channelPointsVotingEnabled: Boolean(input.channelPointsVotingEnabled),
  channelPointsPerVote: parseSafeInteger(input.channelPointsPerVote ?? "0", {
    field: "Channel points per vote",
    fallback: 0,
    min: 0,
    max: 1_000_000,
  }),
});

const normalizePredictionInput = (
  input: Record<string, unknown>,
): PredictionInput => ({
  title: creatorOpsText(input.title, "Prediction title", 60),
  outcomes: creatorOpsList(input.outcomes, "Prediction outcomes", 2, 10, 60),
  predictionWindowSeconds: parseSafeInteger(input.predictionWindowSeconds, {
    field: "Prediction window",
    fallback: 120,
    min: 30,
    max: 1800,
  }),
});

const normalizeEndPredictionInput = (
  input: Record<string, unknown>,
): EndPredictionInput => {
  const statusInput = optionalInputString(input.status);
  const status =
    statusInput === "RESOLVED" ||
    statusInput === "CANCELED" ||
    statusInput === "LOCKED"
      ? statusInput
      : "LOCKED";

  return {
    id: creatorOpsId(input.id, "Prediction ID"),
    status,
    winningOutcomeId:
      status === "RESOLVED"
        ? creatorOpsId(input.winningOutcomeId, "Winning outcome ID")
        : undefined,
  };
};

const normalizeAnnouncementInput = (
  input: Record<string, unknown>,
): AnnouncementInput => {
  const color = optionalInputString(input.color);
  const allowedColors = ["blue", "green", "orange", "purple", "primary"];

  return {
    message: creatorOpsText(input.message, "Announcement message", 500),
    color: allowedColors.includes(color ?? "")
      ? (color as AnnouncementInput["color"])
      : "primary",
  };
};

const creatorOpsText = (value: unknown, field: string, maxLength: number) =>
  sanitizeText(typeof value === "string" ? value : "", {
    field,
    maxLength,
    required: true,
  });

const creatorOpsId = (value: unknown, field: string) =>
  sanitizeText(typeof value === "string" ? value : "", {
    field,
    maxLength: 120,
    required: true,
  });

const creatorOpsLogin = (value: unknown, field: string) =>
  normalizeTwitchLogin(creatorOpsText(value, field, 40), field);

const creatorOpsList = (
  value: unknown,
  field: string,
  min: number,
  max: number,
  maxItemLength: number,
) => {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(/\r?\n|,/)
        .map((item) => item.trim());
  const items = raw
    .map((item) =>
      sanitizeText(String(item), {
        field,
        maxLength: maxItemLength,
        required: false,
      }),
    )
    .filter(Boolean);

  if (items.length < min || items.length > max) {
    throw new SafeInputError(`${field} must include ${min}-${max} items.`);
  }

  return items;
};

const auditTwitchCreatorOps = (
  action: string,
  input: Record<string, unknown>,
  result: unknown,
  metadata: Record<string, unknown> = {},
) => {
  writeAuditLog(db, localUiActor, `twitch.creator_ops.${action}`, action, {
    ...metadata,
    input: redactSecrets(input),
    result: summarizeCreatorOpsResult(result),
  });
};

const summarizeCreatorOpsResult = (result: unknown) => {
  if (!result || typeof result !== "object") {
    return result;
  }

  const data =
    "data" in result && Array.isArray(result.data) ? result.data[0] : result;

  if (!data || typeof data !== "object") {
    return {};
  }

  const summary = data as Record<string, unknown>;
  return {
    id: summary.id,
    status: summary.status,
    title: summary.title,
    target:
      "target" in summary &&
      summary.target &&
      typeof summary.target === "object"
        ? (summary.target as { login?: unknown }).login
        : undefined,
  };
};

const getTwitchStreamKey = async (): Promise<
  | {
      ok: true;
      streamKey: string;
      broadcasterLogin: string;
      broadcasterUserId: string;
    }
  | { ok: false; statusCode: number; error: string }
> => {
  const secrets = readLocalSecrets();
  const twitch = secrets.twitch;

  if (!twitch.clientId || !twitch.accessToken || !twitch.broadcasterUserId) {
    return {
      ok: false,
      statusCode: 409,
      error:
        "Console needs a connected Twitch account and resolved broadcaster identity first.",
    };
  }

  let validation: Awaited<ReturnType<typeof validateStoredTwitchToken>>;
  try {
    validation = await validateStoredTwitchToken({ secrets, logger });
  } catch (error) {
    return {
      ok: false,
      statusCode: 401,
      error: safeErrorMessage(
        error,
        "Twitch token validation failed. Reconnect Twitch in Console.",
      ),
    };
  }

  const activeTwitch = validation.twitch;
  const token = validation.token;
  const clientId = activeTwitch.clientId ?? twitch.clientId;
  const accessToken = activeTwitch.accessToken;
  const broadcasterUserId =
    activeTwitch.broadcasterUserId ?? twitch.broadcasterUserId;
  const broadcasterLogin =
    activeTwitch.broadcasterLogin ?? twitch.broadcasterLogin ?? token.login;

  if (!clientId || !accessToken || !broadcasterUserId) {
    return {
      ok: false,
      statusCode: 409,
      error:
        "Console is missing the active Twitch client, token, or broadcaster ID.",
    };
  }

  if (!token.scopes.includes("channel:read:stream_key")) {
    return {
      ok: false,
      statusCode: 403,
      error:
        "Reconnect Twitch in Console so it can request the channel:read:stream_key scope.",
    };
  }

  if (token.user_id !== broadcasterUserId) {
    return {
      ok: false,
      statusCode: 403,
      error:
        "Twitch only allows stream-key access when the OAuth token belongs to the broadcaster account. Reconnect Console as the broadcaster or make the bot login match the broadcaster.",
    };
  }

  const params = new URLSearchParams({ broadcaster_id: broadcasterUserId });
  const streamKeyResponse = await fetch(
    `https://api.twitch.tv/helix/streams/key?${params}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": clientId,
      },
    },
  );

  if (!streamKeyResponse.ok) {
    const body = await streamKeyResponse.text();
    return {
      ok: false,
      statusCode: streamKeyResponse.status,
      error: `Twitch stream key request failed: ${streamKeyResponse.status} ${body}`,
    };
  }

  const body = (await streamKeyResponse.json()) as {
    data?: Array<{ stream_key?: string }>;
  };
  const streamKey = body.data?.[0]?.stream_key;
  if (!streamKey) {
    return {
      ok: false,
      statusCode: 502,
      error: "Twitch did not return a stream key.",
    };
  }

  if (validation.refreshed) {
    void queueLaunchPreparation("token_refreshed");
  }

  appendSuiteTimelineEvent({
    sourceApp: "vaexcore-console",
    sourceAppName: "vaexcore console",
    kind: "twitch.stream_key",
    title: "Twitch stream key prepared",
    detail: `Console made ${broadcasterLogin}'s stream key available to Studio.`,
    metadata: {
      broadcasterLogin,
      broadcasterUserId,
    },
  });

  return {
    ok: true,
    streamKey,
    broadcasterLogin,
    broadcasterUserId,
  };
};

const getPlatformStatus = () => {
  const twitch = readLocalSecrets().twitch;
  const broadcasterLogin = twitch.broadcasterLogin ?? "";

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    suiteSession: readSuiteSessionDocument(),
    twitch: {
      broadcasterLogin,
      channelUrl: broadcasterLogin
        ? `https://www.twitch.tv/${broadcasterLogin}`
        : null,
      embedReady: Boolean(broadcasterLogin),
    },
    console: {
      bot: getBotProcessSnapshot(),
      queue: chatQueue.snapshot(),
    },
    timeline: readSuiteTimelineEvents(50),
  };
};

const buildPlatformPage = (status: ReturnType<typeof getPlatformStatus>) => {
  const channel = status.twitch.broadcasterLogin;
  const playerSrc = channel
    ? `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=localhost&parent=127.0.0.1&muted=false`
    : "";
  const chatSrc = channel
    ? `https://www.twitch.tv/embed/${encodeURIComponent(channel)}/chat?parent=localhost&parent=127.0.0.1`
    : "";
  const timelineRows = status.timeline
    .map(
      (item) => String.raw`<li>
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.detail)}</span>
        <time>${escapeHtml(formatPlatformTimestamp(item.createdAt))}</time>
      </li>`,
    )
    .join("");

  return String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>VaexCore Platform</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #080b16; color: #eff4ff; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; background: #080b16; }
      main { width: min(1480px, calc(100vw - 32px)); margin: 0 auto; padding: 24px 0 40px; }
      header { display: flex; align-items: end; justify-content: space-between; gap: 24px; padding: 4px 0 18px; border-bottom: 1px solid #26314d; }
      h1 { margin: 0; font-size: 28px; font-weight: 760; letter-spacing: 0; }
      p { margin: 6px 0 0; color: #aeb9d8; }
      .status { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
      .pill { border: 1px solid #334064; border-radius: 999px; padding: 6px 10px; color: #c9d4ef; background: #11172a; font-size: 13px; }
      .grid { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 18px; margin-top: 18px; align-items: start; }
      .frame, aside { border: 1px solid #26314d; background: #0d1224; border-radius: 8px; overflow: hidden; }
      .player { aspect-ratio: 16 / 9; width: 100%; min-height: 360px; }
      iframe { display: block; width: 100%; border: 0; background: #050710; }
      .chat { height: 560px; }
      aside { padding: 16px; }
      h2 { margin: 0 0 12px; font-size: 16px; letter-spacing: 0; }
      ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
      li { display: grid; gap: 4px; padding: 10px 0; border-bottom: 1px solid #202941; }
      li:last-child { border-bottom: 0; }
      strong { font-size: 14px; }
      span, time { color: #9faacf; font-size: 13px; line-height: 1.35; }
      .empty { display: grid; place-items: center; min-height: 360px; color: #aeb9d8; padding: 24px; text-align: center; }
      @media (max-width: 980px) {
        main { width: min(100vw - 20px, 720px); padding-top: 14px; }
        header { align-items: start; flex-direction: column; }
        .status { justify-content: flex-start; }
        .grid { grid-template-columns: 1fr; }
        .player { min-height: 300px; }
        .chat { height: 420px; }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>VaexCore Platform</h1>
          <p>${escapeHtml(channel ? `Live channel: ${channel}` : "Connect Twitch in Console to enable the live embed.")}</p>
        </div>
        <div class="status">
          <span class="pill">${escapeHtml(status.console.bot.status)}</span>
          <span class="pill">${escapeHtml(status.suiteSession?.title ?? "No suite session")}</span>
        </div>
      </header>
      <div class="grid">
        <section class="frame">
          ${
            channel
              ? `<iframe class="player" src="${escapeAttr(playerSrc)}" allowfullscreen></iframe><iframe class="chat" src="${escapeAttr(chatSrc)}"></iframe>`
              : `<div class="empty">Twitch broadcaster login is not configured.</div>`
          }
        </section>
        <aside>
          <h2>Suite Timeline</h2>
          ${timelineRows ? `<ul>${timelineRows}</ul>` : `<div class="empty">No shared suite activity yet.</div>`}
        </aside>
      </div>
    </main>
  </body>
</html>`;
};

type SuiteTimelineEvent = {
  schemaVersion: number;
  eventId: string;
  sourceApp: string;
  sourceAppName: string;
  kind: string;
  title: string;
  detail: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};

type SuiteAppStatus = {
  appId: string;
  appName: string;
  launchName: string;
  bundleIdentifier: string;
  installed: boolean;
  running: boolean;
  reachable: boolean;
  stale: boolean;
  discoveryFile: string;
  pid: number | null;
  apiUrl: string | null;
  healthUrl: string | null;
  updatedAt: string | null;
  capabilities: string[];
  suiteSessionId: string | null;
  activity: string | null;
  activityDetail: string | null;
  localRuntime: SuiteLocalRuntime | null;
  detail: string;
};

const appendSuiteTimelineEvent = (
  event: Omit<SuiteTimelineEvent, "schemaVersion" | "eventId" | "createdAt">,
) => {
  const directory = suiteDiscoveryDir();
  mkdirSync(directory, { recursive: true });
  const document: SuiteTimelineEvent = {
    schemaVersion: suiteDiscoverySchemaVersion,
    eventId: `console-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
    ...event,
  };
  appendFileSync(
    join(directory, "timeline.jsonl"),
    `${JSON.stringify(document)}\n`,
  );
};

const getSuiteStatus = () => ({
  ok: true,
  generatedAt: new Date().toISOString(),
  protocol: {
    schemaVersion: suiteDiscoverySchemaVersion,
    directory: suiteDiscoveryDir(),
    sessionFile: join(suiteDiscoveryDir(), "session.json"),
    timelineFile: join(suiteDiscoveryDir(), "timeline.jsonl"),
  },
  session: readSuiteSessionDocument(),
  apps: vaexcoreSuiteAppDefinitions.map(suiteAppStatus),
  timeline: readSuiteTimelineEvents(50),
});

const readSuiteTimelineEvents = (limit: number): SuiteTimelineEvent[] => {
  const path = join(suiteDiscoveryDir(), "timeline.jsonl");
  if (!existsSync(path)) {
    return [];
  }

  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as SuiteTimelineEvent;
      } catch {
        return null;
      }
    })
    .filter((item): item is SuiteTimelineEvent => Boolean(item))
    .slice(-limit)
    .reverse();
};

const formatPlatformTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const escapeAttr = escapeHtml;

const getCachedTokenReadiness = (config = getSafeConfig()) => {
  const missing = missingSafeConfigFields(config);
  const requiredScopesPresent = requiredTwitchScopes.every((scope) =>
    (config.scopes || []).includes(scope),
  );
  const expiresAtMs = Date.parse(config.tokenExpiresAt || "");
  const expiresSoon =
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= Date.now() + tokenRefreshLeadMs;
  const validatedAtMs = Date.parse(config.tokenValidatedAt || "");
  const validationStale =
    !Number.isFinite(validatedAtMs) ||
    validatedAtMs <= Date.now() - tokenValidationMaxAgeMs;
  const identitiesResolved = config.hasBotUserId && config.hasBroadcasterUserId;
  const ready = Boolean(
    config.hasAccessToken &&
    identitiesResolved &&
    requiredScopesPresent &&
    !expiresSoon &&
    !validationStale,
  );
  const checks: SetupCheck[] = [
    {
      name: "Saved setup",
      ok: missing.length === 0,
      detail:
        missing.length === 0
          ? "Required saved Twitch setup fields are present."
          : `Missing setup fields: ${missing.join(", ")}.`,
    },
    {
      name: "Token valid",
      ok: Boolean(config.hasAccessToken && !expiresSoon && !validationStale),
      detail:
        config.hasAccessToken && !expiresSoon && !validationStale
          ? `Saved token is valid until ${config.tokenExpiresAt}.`
          : "Saved token is missing, expired, close to expiry, or due for validation.",
    },
    {
      name: "Required scopes",
      ok: requiredScopesPresent,
      detail: requiredScopesPresent
        ? requiredTwitchScopes.join(", ")
        : "Saved token scopes are missing required chat access.",
    },
    {
      name: "Twitch identities",
      ok: identitiesResolved,
      detail: identitiesResolved
        ? "Saved bot and broadcaster identities are resolved."
        : "Bot or broadcaster identity must be resolved.",
    },
  ];

  return {
    ready,
    requiredScopesPresent,
    expiresSoon,
    validationStale,
    identitiesResolved,
    checks,
  };
};

const getTwitchBroadcastReadiness = () => {
  const config = getSafeConfig();
  const tokenReadiness = getCachedTokenReadiness(config);
  const streamKeyScopeReady = (config.scopes || []).includes(
    "channel:read:stream_key",
  );
  const broadcasterReady = Boolean(
    config.broadcasterLogin && config.hasBroadcasterUserId,
  );
  const channelUrl = config.broadcasterLogin
    ? `https://www.twitch.tv/${config.broadcasterLogin}`
    : null;
  const checks = [
    ...tokenReadiness.checks,
    {
      name: "Broadcaster channel",
      ok: broadcasterReady,
      detail: broadcasterReady
        ? `${config.broadcasterLogin} is resolved as the broadcaster.`
        : "Set Broadcaster Login and validate Twitch setup.",
    },
    {
      name: "Stream-key scope",
      ok: streamKeyScopeReady,
      detail: streamKeyScopeReady
        ? "Saved OAuth scopes include channel:read:stream_key."
        : "Reconnect Twitch with the channel:read:stream_key scope before Studio can import a stream key.",
    },
  ];
  const ok = checks.every((check) => check.ok);
  const nextAction = ok
    ? "Studio can import the Twitch stream key and prepare an RTMP destination."
    : streamKeyScopeReady
      ? "Run launch checks and validate Twitch setup."
      : "Reconnect Twitch in Console with stream-key access, then import the key from Studio.";

  return {
    ok,
    status: ok ? "ready" : config.hasAccessToken ? "attention" : "blocked",
    summary: ok
      ? `Twitch broadcast path is ready for ${config.broadcasterLogin}.`
      : nextAction,
    nextAction,
    generatedAt: new Date().toISOString(),
    twitch: {
      broadcasterLogin: config.broadcasterLogin || null,
      channelUrl,
      streamKeyScopeReady,
    },
    checks,
  };
};

const saveConfig = (body: unknown) => {
  const input = body as Record<string, string>;
  const existing = readLocalSecrets();
  const setupMode = parseSetupMode(input.setupMode, getSetupMode(existing));
  const redirectUri = sanitizeRedirectUri(input.redirectUri);
  const clientId = valueOrExisting(
    sanitizeOptionalText(input.clientId, "Client ID", 120),
    existing.twitch.clientId,
  );
  const clientSecret = valueOrExisting(
    sanitizeOptionalText(input.clientSecret, "Client secret", 200),
    existing.twitch.clientSecret,
  );
  const broadcasterLogin = valueOrExistingLogin(
    input,
    "broadcasterLogin",
    existing.twitch.broadcasterLogin,
  );
  const botLogin = valueOrExistingLogin(
    input,
    "botLogin",
    existing.twitch.botLogin,
  );
  const appConfigChanged =
    clientId !== existing.twitch.clientId ||
    clientSecret !== existing.twitch.clientSecret ||
    redirectUri !== (existing.twitch.redirectUri ?? defaultRedirectUri);
  const broadcasterChanged =
    broadcasterLogin !== existing.twitch.broadcasterLogin;
  const botChanged = botLogin !== existing.twitch.botLogin;
  const relayBaseUrl = valueOrExisting(
    sanitizeRelayBaseUrl(input.relayBaseUrl),
    existing.relay.baseUrl,
  );
  const relayInstallationId = valueOrExisting(
    sanitizeOptionalText(
      input.relayInstallationId,
      "Relay installation ID",
      120,
    ),
    existing.relay.installationId,
  );
  const relayConsoleToken = valueOrExisting(
    sanitizeOptionalText(input.relayConsoleToken, "Relay console token", 240),
    existing.relay.consoleToken,
  );
  const twitchTransportMode =
    input.twitchTransportMode === "relay-chatbot"
      ? "relay-chatbot"
      : "local-user-token";
  const relayChanged =
    twitchTransportMode !== existing.relay.twitchTransportMode ||
    relayBaseUrl !== existing.relay.baseUrl ||
    relayInstallationId !== existing.relay.installationId ||
    relayConsoleToken !== existing.relay.consoleToken;
  const twitch: LocalSecrets["twitch"] = {
    ...existing.twitch,
    clientId,
    clientSecret,
    redirectUri,
    broadcasterLogin,
    botLogin,
  };

  if (appConfigChanged || botChanged) {
    Object.assign(twitch, clearTwitchAuthorization(twitch));
  }

  if (appConfigChanged || broadcasterChanged) {
    twitch.broadcasterUserId = undefined;
    twitch.tokenValidatedAt = undefined;
  }

  const next: LocalSecrets = {
    mode: input.mode === "local" ? "local" : "live",
    setupMode,
    twitch,
    discord: existing.discord,
    relay: {
      twitchTransportMode,
      baseUrl: relayBaseUrl,
      installationId: relayInstallationId,
      consoleToken: relayConsoleToken,
      chatbotIdentityValidatedAt: relayChanged
        ? undefined
        : existing.relay.chatbotIdentityValidatedAt,
      chatbotIdentityValidationNote: relayChanged
        ? undefined
        : existing.relay.chatbotIdentityValidationNote,
    },
    setupChecks: existing.setupChecks,
    botValidation: existing.botValidation,
  };

  writeLocalSecrets(next);
  return getSafeConfig();
};

const saveSetupMode = (body: unknown) => {
  const input = objectInput(body);
  const existing = readLocalSecrets();
  const setupMode = parseSetupMode(input.setupMode, getSetupMode(existing));
  const twitchTransportMode = deriveTwitchTransportForSetupMode(
    setupMode,
    existing.relay.twitchTransportMode,
  );

  writeLocalSecrets({
    ...existing,
    setupMode,
    relay: {
      ...existing.relay,
      twitchTransportMode,
    },
  });

  return getSafeConfig();
};

const disconnectTwitch = () => {
  const secrets = readLocalSecrets();
  writeLocalSecrets({
    ...secrets,
    twitch: clearTwitchAuthorization(secrets.twitch, {
      clearBroadcasterIdentity: true,
    }),
  });
  return getSafeConfig();
};

const redirectToOAuthNotice = (response: ServerResponse, error: string) => {
  const params = new URLSearchParams({
    window: "settings",
    error,
  });
  redirect(response, `/?${params.toString()}`);
};

const redirectToTwitch = (response: ServerResponse) => {
  const secrets = readLocalSecrets();
  const twitch = secrets.twitch;

  if (!twitch.clientId || !twitch.clientSecret) {
    redirectToOAuthNotice(response, "missing_client_credentials");
    return;
  }

  const state = randomBytes(16).toString("hex");
  oauthStates.set(state, Date.now() + 10 * 60 * 1000);

  const authorizeUrl = new URL("https://id.twitch.tv/oauth2/authorize");
  authorizeUrl.searchParams.set("client_id", twitch.clientId);
  authorizeUrl.searchParams.set(
    "redirect_uri",
    twitch.redirectUri ?? defaultRedirectUri,
  );
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set(
    "scope",
    [
      ...requiredTwitchScopes,
      ...optionalModerationScopes,
      ...optionalCreatorOpsScopes,
    ].join(" "),
  );
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("force_verify", "true");

  redirect(response, authorizeUrl.toString());
};

const handleTwitchCallback = async (url: URL, response: ServerResponse) => {
  const error = url.searchParams.get("error");

  if (error) {
    redirectToOAuthNotice(response, error);
    return;
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state || !consumeOauthState(state)) {
    redirectToOAuthNotice(response, "invalid_oauth_state");
    return;
  }

  const secrets = readLocalSecrets();
  const twitch = secrets.twitch;

  if (!twitch.clientId || !twitch.clientSecret) {
    redirectToOAuthNotice(response, "missing_client_credentials");
    return;
  }

  let tokens: TwitchOAuthTokenResponse & { refresh_token: string };

  try {
    tokens = await exchangeCode({
      code,
      clientId: twitch.clientId,
      clientSecret: twitch.clientSecret,
      redirectUri: twitch.redirectUri ?? defaultRedirectUri,
    });
  } catch (error) {
    logger.warn(
      { error: redactSecrets(error) },
      "Twitch OAuth token exchange failed",
    );
    redirectToOAuthNotice(response, classifyOAuthExchangeError(error));
    return;
  }

  let validation: Awaited<ReturnType<typeof validateToken>>;

  try {
    validation = await validateToken(tokens.access_token);
  } catch (error) {
    logger.warn(
      { error: redactSecrets(error) },
      "Twitch OAuth token validation failed after exchange",
    );
    redirectToOAuthNotice(response, "oauth_token_validation_failed");
    return;
  }
  const expiresAt = getTokenExpiresAt(tokens.expires_in);
  const tokenLogin = normalizeTwitchLogin(validation.login);
  const configuredBotLogin = twitch.botLogin
    ? normalizeTwitchLogin(twitch.botLogin)
    : undefined;
  const tokenMatchesConfiguredBot =
    !configuredBotLogin || configuredBotLogin === tokenLogin;

  if (!tokenMatchesConfiguredBot) {
    writeLocalSecrets({
      ...secrets,
      twitch: clearTwitchAuthorization(twitch),
    });
    const params = new URLSearchParams({
      error: "wrong_bot_account",
      connected_login: tokenLogin,
      expected_login: configuredBotLogin ?? "",
    });
    redirect(response, `/?window=settings&${params.toString()}`);
    return;
  }

  writeLocalSecrets({
    ...secrets,
    twitch: {
      ...twitch,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      scopes: validation.scopes,
      tokenExpiresAt: expiresAt,
      tokenValidatedAt: new Date().toISOString(),
      botLogin: configuredBotLogin || tokenLogin,
      botUserId: tokenMatchesConfiguredBot ? validation.user_id : undefined,
    },
  });

  void queueLaunchPreparation("oauth_connected");
  redirect(response, "/?window=settings&connected=1");
};

const validateSetup = async () => {
  const secrets = readLocalSecrets();
  const twitch = secrets.twitch;
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  const fail = (name: string, detail: string) =>
    checks.push({ name, ok: false, detail });
  const pass = (name: string, detail: string) =>
    checks.push({ name, ok: true, detail });

  if (!twitch.clientId || !twitch.clientSecret) {
    fail("Twitch app credentials", "Client ID and client secret are required.");
    return { ok: false, checks };
  }

  if (!twitch.accessToken) {
    fail("OAuth token", "Click Connect Twitch first.");
    return { ok: false, checks };
  }

  let validated: Awaited<ReturnType<typeof validateStoredTwitchToken>>;

  try {
    validated = await validateStoredTwitchToken({ secrets, logger });
  } catch (error) {
    const detail = safeErrorMessage(
      error,
      "Twitch token validation failed. Reconnect Twitch and try again.",
    );
    fail("OAuth token", detail);
    return { ok: false, checks, error: detail };
  }

  const activeSecrets = validated.secrets;
  const activeTwitch = validated.twitch;
  const token = validated.token;
  const activeAccessToken = activeTwitch.accessToken;
  const activeClientId = activeTwitch.clientId ?? twitch.clientId;

  if (!activeClientId || !activeAccessToken) {
    fail(
      "OAuth token",
      "Validated Twitch token was not available after refresh.",
    );
    return { ok: false, checks };
  }

  pass(
    validated.refreshed ? "Token refreshed" : "Token valid",
    validated.refreshed
      ? `Access token refreshed for ${token.login}.`
      : `Token belongs to ${token.login}.`,
  );

  if (token.client_id !== activeClientId) {
    fail(
      "Twitch app",
      "OAuth token belongs to a different Twitch application.",
    );
  } else {
    pass("Twitch app", "OAuth token matches the saved Client ID.");
  }

  const missingScopes = requiredTwitchScopes.filter(
    (scope) => !token.scopes.includes(scope),
  );

  if (missingScopes.length > 0) {
    fail("Required scopes", `Missing: ${missingScopes.join(", ")}.`);
  } else {
    pass("Required scopes", token.scopes.join(", "));
  }

  const missingModerationScopes = optionalModerationScopes.filter(
    (scope) => !token.scopes.includes(scope),
  );

  pass(
    "Moderation enforcement scopes",
    missingModerationScopes.length
      ? `Warn-only moderation works. Reconnect Twitch to grant optional scope(s): ${missingModerationScopes.join(", ")}.`
      : "Delete and timeout enforcement scopes are present.",
  );

  const missingCreatorOpsScopes = optionalCreatorOpsScopes.filter(
    (scope) => !token.scopes.includes(scope),
  );

  pass(
    "Creator ops scopes",
    missingCreatorOpsScopes.length
      ? `Core chat works. Reconnect Twitch to grant creator ops scope(s): ${missingCreatorOpsScopes.join(", ")}.`
      : "Poll, prediction, raid, announcement, and shoutout scopes are present.",
  );

  const botLogin = activeTwitch.botLogin ?? twitch.botLogin;
  const broadcasterLogin =
    activeTwitch.broadcasterLogin ?? twitch.broadcasterLogin;
  const botUser = botLogin
    ? await getTwitchUserByLogin(
        { clientId: activeClientId, accessToken: activeAccessToken },
        botLogin,
      )
    : undefined;
  const broadcasterUser = broadcasterLogin
    ? await getTwitchUserByLogin(
        { clientId: activeClientId, accessToken: activeAccessToken },
        broadcasterLogin,
      )
    : undefined;

  if (!botUser) {
    fail("Bot identity", "Bot login was not found.");
  } else if (botUser.id !== token.user_id) {
    fail(
      "Bot identity",
      `OAuth token belongs to ${token.login}, but bot login resolves to ${botUser.login}.`,
    );
  } else {
    pass("Bot identity", `${botUser.login} (${botUser.id})`);
  }

  if (!broadcasterUser) {
    fail("Broadcaster identity", "Broadcaster login was not found.");
  } else {
    pass(
      "Broadcaster identity",
      `${broadcasterUser.login} (${broadcasterUser.id})`,
    );
  }

  const setupOk = checks.every((check) => check.ok);
  const nextTwitch: LocalSecrets["twitch"] = {
    ...activeTwitch,
    scopes: token.scopes,
    tokenExpiresAt: token.expires_in
      ? getTokenExpiresAt(token.expires_in)
      : activeTwitch.tokenExpiresAt,
    tokenValidatedAt: setupOk ? new Date().toISOString() : undefined,
    botUserId: undefined,
    broadcasterUserId: undefined,
  };

  if (botUser && botUser.id === token.user_id) {
    nextTwitch.botLogin = botUser.login;
    nextTwitch.botUserId = botUser.id;
  }

  if (broadcasterUser) {
    nextTwitch.broadcasterLogin = broadcasterUser.login;
    nextTwitch.broadcasterUserId = broadcasterUser.id;
  }

  writeLocalSecrets({
    ...activeSecrets,
    twitch: nextTwitch,
  });

  return { ok: setupOk, checks };
};

const sendTestMessage = async () => {
  if (readLocalSecrets().relay.twitchTransportMode === "relay-chatbot") {
    return sendRelayTestMessageRoute();
  }

  const validation = await validateSetup();

  if (!validation.ok) {
    return {
      ok: false,
      checks: validation.checks,
      error: "Validation must pass before sending a test message.",
    };
  }

  const secrets = readLocalSecrets();
  const twitch = secrets.twitch;

  if (
    !twitch.clientId ||
    !twitch.accessToken ||
    !twitch.broadcasterUserId ||
    !twitch.botUserId
  ) {
    return { ok: false, error: "Setup is missing resolved Twitch IDs." };
  }

  const result = await sendConfiguredChatMessage(
    "vaexcore console setup test.",
  );
  const structured = typeof result === "string" ? { status: result } : result;
  return {
    ok: structured.status === "sent",
    error:
      structured.status === "sent"
        ? undefined
        : structured.reason || "Test chat message was not sent.",
    failureCategory: structured.failureCategory,
  };
};

const getOperatorStatus = async () => {
  let config = getSafeConfig();
  let tokenValid = false;
  let requiredScopesPresent = false;
  let tokenRefreshed = false;
  const cachedReadiness = getCachedTokenReadiness(config);

  if (cachedReadiness.ready) {
    tokenValid = true;
    requiredScopesPresent = true;
  } else {
    try {
      const secrets = readLocalSecrets();
      const validation = secrets.twitch.accessToken
        ? await validateStoredTwitchToken({ secrets, logger })
        : undefined;
      const token = validation?.token;
      tokenRefreshed = Boolean(validation?.refreshed);
      tokenValid = Boolean(token);
      requiredScopesPresent = token
        ? requiredTwitchScopes.every((scope) => token.scopes.includes(scope))
        : false;
      if (tokenRefreshed) {
        config = getSafeConfig();
      }
    } catch {
      tokenValid = false;
      requiredScopesPresent = false;
    }
  }

  const giveaway = giveawaysService.getOperatorState();
  const queue = chatQueue.snapshot();
  const outbound = outboundHistory.summary();
  const featureGateStates = featureGates.list();
  const timers = timersService.listTimers();
  const moderation = moderationService.getState();

  return {
    ok: true,
    launchPreparation: getLaunchPreparationSnapshot(),
    config,
    runtime: {
      mode: config.mode,
      botLogin: config.botLogin,
      broadcasterLogin: config.broadcasterLogin,
      tokenValid,
      tokenRefreshed,
      requiredScopesPresent,
      botProcess: getBotProcessSnapshot(),
      eventSubConnected: botProcess.eventSubConnected,
      chatSubscriptionActive: botProcess.chatSubscriptionActive,
      queueReady: chatQueue.isReady(),
      queue,
      queueHealth: summarizeQueueHealth(queue, outbound),
      outboundChat: outbound,
      outboundRecovery: summarizeOutboundRecovery(),
      liveChatConfirmed: botProcess.liveChatConfirmed,
      note: botProcess.child
        ? "Live bot runtime is managed by this setup console."
        : "Start the live bot runtime from Dashboard or Settings to receive chat commands.",
    },
    featureGates: featureGateStates,
    timers: summarizeTimers(timers),
    moderation: moderation.summary,
    localRuntime: buildConsoleLocalRuntime(),
    giveaway: summarizeGiveawayState(giveaway),
  };
};

const runPreflightCheck = async () => {
  const status = await getOperatorStatus();
  const runtime = status.runtime;
  const giveawayState = getGiveawayState();
  const assurance = giveawayState.assurance;
  const outbound = outboundHistory.summary();
  const checks = [
    {
      name: "Twitch setup",
      ok: isSafeConfigComplete(),
      detail: isSafeConfigComplete()
        ? "Required local Twitch fields are present."
        : "Open Settings -> Setup Guide and complete credentials, usernames, OAuth, and validation.",
    },
    {
      name: "Token and scopes",
      ok: runtime.tokenValid && runtime.requiredScopesPresent,
      detail:
        runtime.tokenValid && runtime.requiredScopesPresent
          ? "OAuth token is valid and required chat scopes are present."
          : "Reconnect Twitch if automatic launch validation cannot confirm the saved token.",
    },
    {
      name: "Setup queue",
      ok: runtime.queueReady,
      detail: runtime.queueReady
        ? "Outbound setup queue is ready."
        : "Restart the setup console if queue readiness does not recover.",
    },
    {
      name: "Bot runtime",
      ok: Boolean(runtime.botProcess.running),
      detail: runtime.botProcess.running
        ? `Bot process is ${runtime.botProcess.status}.`
        : "Start bot process from Dashboard.",
    },
    {
      name: "EventSub chat listener",
      ok: runtime.eventSubConnected && runtime.chatSubscriptionActive,
      detail:
        runtime.eventSubConnected && runtime.chatSubscriptionActive
          ? "Chat subscription is active."
          : "Wait for the bot process to connect to EventSub and create the chat subscription.",
    },
    {
      name: "Live chat confirmation",
      ok: runtime.liveChatConfirmed,
      detail: runtime.liveChatConfirmed
        ? "Live chat has responded to !ping."
        : "Type !ping in Twitch chat after the bot starts.",
    },
    {
      name: "Critical outbound failures",
      ok: outbound.criticalFailed === 0 && !assurance.blockContinue,
      detail:
        outbound.criticalFailed === 0 && !assurance.blockContinue
          ? "No critical giveaway chat failures are currently tracked."
          : assurance.nextAction ||
            "Resend failed critical giveaway messages before continuing.",
    },
    {
      name: "Giveaway controls",
      ok:
        giveawayState.summary.status === "none" ||
        giveawayState.summary.status === "open" ||
        giveawayState.summary.status === "closed",
      detail:
        giveawayState.summary.status === "none"
          ? "No active giveaway; start controls are ready."
          : `Giveaway is ${giveawayState.summary.status}; next action: ${giveawayState.summary.status === "open" ? "close entries before drawing" : "draw or finish delivery"}.`,
    },
  ];
  const failed = checks.find((check) => !check.ok);

  return {
    ok: checks.every((check) => check.ok),
    checks,
    nextAction: failed?.detail ?? "Giveaway controls ready.",
    summary: giveawayState.summary,
  };
};

type SetupCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

type LaunchPreparationStatus =
  | "pending"
  | "running"
  | "setup_required"
  | "attention"
  | "ready"
  | "error";

type LaunchPreparationState = {
  ok: boolean;
  status: LaunchPreparationStatus;
  reason: string;
  step: string;
  startedAt: string;
  completedAt: string;
  setupReady: boolean;
  preflightReady: boolean;
  summary: string;
  nextAction: string;
  checks: SetupCheck[];
  validation?: {
    ok: boolean;
    checks: SetupCheck[];
    error?: string;
  };
  preflight?: {
    ok: boolean;
    checks: SetupCheck[];
    nextAction: string;
    summary?: unknown;
  };
  error?: string;
};

function createLaunchPreparationState(): LaunchPreparationState {
  return {
    ok: false,
    status: "pending",
    reason: "startup",
    step: "pending",
    startedAt: "",
    completedAt: "",
    setupReady: false,
    preflightReady: false,
    summary: "Launch preparation has not run yet.",
    nextAction: "Waiting for vaexcore console to start.",
    checks: [],
  };
}

function resetLaunchPreparation(
  status: LaunchPreparationStatus,
  summary: string,
  nextAction: string,
) {
  pendingLaunchPreparationReason = undefined;
  const now = new Date().toISOString();
  launchPreparation = {
    ...createLaunchPreparationState(),
    status,
    reason: "reset",
    step: status,
    startedAt: now,
    completedAt: now,
    summary,
    nextAction,
    checks: [
      {
        name: "Saved setup",
        ok: false,
        detail: nextAction,
      },
    ],
  };
}

const getLaunchPreparationSnapshot = () => ({
  ...launchPreparation,
  checks: launchPreparation.checks.map((check) => ({ ...check })),
  validation: launchPreparation.validation
    ? {
        ...launchPreparation.validation,
        checks: launchPreparation.validation.checks.map((check) => ({
          ...check,
        })),
      }
    : undefined,
  preflight: launchPreparation.preflight
    ? {
        ...launchPreparation.preflight,
        checks: launchPreparation.preflight.checks.map((check) => ({
          ...check,
        })),
      }
    : undefined,
});

const queueLaunchPreparation = (reason: string) => {
  if (launchPreparationPromise) {
    pendingLaunchPreparationReason = reason;
    return launchPreparationPromise;
  }

  launchPreparationPromise = runLaunchPreparation(reason)
    .catch((error: unknown) => {
      const detail = safeErrorMessage(error, "Launch preparation failed.");
      launchPreparation = {
        ...launchPreparation,
        ok: false,
        status: "error",
        step: "error",
        completedAt: new Date().toISOString(),
        summary: "Automatic launch preparation failed.",
        nextAction: detail,
        error: detail,
        checks: [
          ...launchPreparation.checks,
          { name: "Launch preparation", ok: false, detail },
        ],
      };
      logger.error(
        { error: redactSecrets(error) },
        "Automatic launch preparation failed",
      );
    })
    .finally(() => {
      launchPreparationPromise = undefined;
      const pendingReason = pendingLaunchPreparationReason;
      pendingLaunchPreparationReason = undefined;
      if (pendingReason) {
        void queueLaunchPreparation(pendingReason);
      }
    });

  return launchPreparationPromise;
};

const runLaunchPreparation = async (reason: string) => {
  const startedAt = new Date().toISOString();
  launchPreparation = {
    ...createLaunchPreparationState(),
    status: "running",
    reason,
    step: "setup",
    startedAt,
    summary: "Checking saved setup and Twitch connection.",
    nextAction: "Automatic launch checks are running.",
  };

  const config = getSafeConfig();
  const missing = missingSafeConfigFields(config);

  if (missing.length > 0) {
    const detail = `Missing setup fields: ${missing.join(", ")}.`;
    launchPreparation = {
      ...launchPreparation,
      ok: false,
      status: "setup_required",
      step: "setup_required",
      completedAt: new Date().toISOString(),
      setupReady: false,
      preflightReady: false,
      summary: "One-time setup is not complete yet.",
      nextAction: "Open Configuration Settings -> Setup Guide.",
      checks: [{ name: "Saved setup", ok: false, detail }],
    };
    return;
  }

  launchPreparation = {
    ...launchPreparation,
    step: "validation",
    summary: "Validating saved Twitch OAuth and refreshing tokens if needed.",
  };

  const cachedReadiness = getCachedTokenReadiness(config);
  const validation = cachedReadiness.ready
    ? { ok: true, checks: cachedReadiness.checks }
    : await validateSetup();
  const failedValidation = validation.checks.find((check) => !check.ok);

  if (!validation.ok) {
    launchPreparation = {
      ...launchPreparation,
      ok: false,
      status: "error",
      step: "validation",
      completedAt: new Date().toISOString(),
      setupReady: false,
      preflightReady: false,
      summary: "Saved Twitch setup needs attention.",
      nextAction:
        failedValidation?.detail ??
        "Reconnect Twitch in Configuration Settings.",
      checks: validation.checks,
      validation,
    };
    return;
  }

  launchPreparation = {
    ...launchPreparation,
    step: "preflight",
    setupReady: true,
    summary: "Running automatic preflight.",
  };

  const preflight = await runPreflightCheck();
  const checks = [
    ...validation.checks,
    ...preflight.checks.filter(
      (check) =>
        !validation.checks.some(
          (validationCheck) => validationCheck.name === check.name,
        ),
    ),
  ];

  launchPreparation = {
    ...launchPreparation,
    ok: preflight.ok,
    status: preflight.ok ? "ready" : "attention",
    step: "complete",
    completedAt: new Date().toISOString(),
    setupReady: true,
    preflightReady: preflight.ok,
    summary: preflight.ok
      ? "Launch preparation completed automatically."
      : "Saved setup is ready. Live preflight still needs operator attention.",
    nextAction: preflight.nextAction,
    checks,
    validation,
    preflight,
  };
};

type DiagnosticCheck = {
  name: string;
  ok: boolean;
  severity: "blocker" | "warning" | "info";
  detail: string;
};

const getDiagnosticsReport = () => {
  const generatedAt = new Date().toISOString();
  const packageInfo = getPackageInfo();
  const config = getSafeConfig();
  const database = getDatabaseDiagnostics();
  const queue = chatQueue.snapshot();
  const outbound = outboundHistory.summary();
  const giveaway = giveawaysService.getOperatorState();
  const giveawayState = getGiveawayState();
  const commands = customCommandsService.listCommands();
  const featureGateStates = featureGates.list();
  const timers = timersService.listTimers();
  const moderation = moderationService.getState();
  const queueHealth = summarizeQueueHealth(queue, outbound);
  const setupUi = getSetupUiDiagnostics();
  const botSnapshot = getBotProcessSnapshot();
  const firstRun = getFirstRunStatus({ config, database, setupUi });
  const checks = getDiagnosticChecks({
    config,
    database,
    setupUi,
    queue,
    queueHealth,
    outbound,
    giveawayState,
    botSnapshot,
    featureGates: featureGateStates,
  });
  const blockers = checks.filter(
    (check) => !check.ok && check.severity === "blocker",
  );
  const warnings = checks.filter(
    (check) => !check.ok && check.severity === "warning",
  );

  return {
    ok: blockers.length === 0,
    generatedAt,
    app: {
      name: packageInfo.name,
      version: packageInfo.version,
      runtime: getRuntimeKind(),
      node: process.versions.node,
      electron: process.versions.electron ?? "",
      platform: process.platform,
      arch: process.arch,
    },
    paths: {
      configDir: dirname(getLocalSecretsPath()),
      secretsPath: getLocalSecretsPath(),
      databaseUrl: safeDatabaseUrl(databaseUrl),
      databasePath: resolveDatabasePath(databaseUrl),
      setupUiDir: getSetupUiDir(),
    },
    launchPreparation: getLaunchPreparationSnapshot(),
    setupUi,
    firstRun,
    config,
    database,
    runtime: {
      botProcess: botSnapshot,
      eventSubConnected: botProcess.eventSubConnected,
      chatSubscriptionActive: botProcess.chatSubscriptionActive,
      liveChatConfirmed: botProcess.liveChatConfirmed,
      queueReady: chatQueue.isReady(),
      queue,
      queueHealth,
      outboundChat: outbound,
    },
    giveaway: summarizeGiveawayState(giveaway),
    customCommands: {
      featureGate: featureGates.get("custom_commands"),
      total: commands.length,
      enabled: commands.filter((command) => command.enabled).length,
      disabled: commands.filter((command) => !command.enabled).length,
      aliases: commands.reduce(
        (total, command) => total + command.aliases.length,
        0,
      ),
      uses: commands.reduce((total, command) => total + command.useCount, 0),
    },
    timers: summarizeTimers(timers),
    moderation: moderation.summary,
    featureGates: featureGateStates,
    readiness: {
      status:
        blockers.length > 0
          ? "not_ready"
          : warnings.length > 0
            ? "attention"
            : "ready",
      blockers: blockers.map((check) => `${check.name}: ${check.detail}`),
      warnings: warnings.map((check) => `${check.name}: ${check.detail}`),
      nextAction:
        blockers[0]?.detail ?? warnings[0]?.detail ?? "Diagnostics are clear.",
    },
    checks,
  };
};

const getSupportBundle = async () => {
  const secrets = readLocalSecrets();
  const setupMode = getSetupMode(secrets);
  const diagnostics = getDiagnosticsReport();
  const completion = await getBotCompletionRoute();
  const giveawayState = getGiveawayState();
  const giveawayExport = giveawaysService.exportResults();
  const outbound = outboundHistory
    .list()
    .slice(0, 50)
    .map((record) => ({
      id: record.id,
      source: record.source,
      status: record.status,
      category: record.category,
      action: record.action,
      importance: record.importance,
      attempts: record.attempts,
      queuedAt: record.queuedAt,
      updatedAt: record.updatedAt,
      reason: safeSupportText(record.reason),
      failureCategory: record.failureCategory,
      retryAfterMs: record.retryAfterMs,
      nextAttemptAt: record.nextAttemptAt,
      queueDepth: record.queueDepth,
      giveawayId: record.giveawayId,
      messagePreview: safeSupportText(record.message).slice(0, 180),
    }));
  const audit = giveawaysService.getRecentAuditLogs(50).map((log) => ({
    id: log.id,
    actor: log.actor_twitch_user_id,
    action: log.action,
    target: log.target,
    createdAt: log.created_at,
    metadata: safeAuditMetadata(log.metadata_json),
  }));
  const customCommandInvocations = customCommandsService
    .getRecentInvocations(50)
    .map((entry) => ({
      id: entry.id,
      commandName: entry.commandName,
      aliasUsed: entry.aliasUsed,
      userLogin: entry.userLogin,
      createdAt: entry.createdAt,
      responsePreview: safeSupportText(entry.responseText).slice(0, 180),
    }));
  const timers = timersService.listTimers().map((timer) => ({
    id: timer.id,
    name: timer.name,
    enabled: timer.enabled,
    intervalMinutes: timer.intervalMinutes,
    minChatMessages: timer.minChatMessages,
    chatMessagesSinceLastFire: timer.chatMessagesSinceLastFire,
    fireCount: timer.fireCount,
    lastSentAt: timer.lastSentAt,
    nextFireAt: timer.nextFireAt,
    lastStatus: timer.lastStatus,
    lastError: safeSupportText(timer.lastError),
    messagePreview: safeSupportText(timer.message).slice(0, 180),
  }));
  const moderation = moderationService.getState();
  const botLogs = getBotProcessSnapshot()
    .recentLogs.slice(-40)
    .map(safeSupportText);

  return {
    ok: true,
    bundleVersion: 1,
    generatedAt: new Date().toISOString(),
    note: "Secret-safe local support bundle. Twitch client secrets, access tokens, and refresh tokens are not included.",
    setup: {
      mode: setupMode,
      setupChecks: getSafeSetupChecks(secrets),
      modeCapabilities: getSetupCapabilitySummary(setupMode),
    },
    operations: {
      status: completion.status,
      statusLabel: completion.statusLabel,
      statusDetail: completion.statusDetail,
      completionPercent: completion.completionPercent,
      providerSetupChecks: {
        redacted: true,
        local: completion.setupChecks.local ?? safeSetupCheck(undefined),
        relay: completion.setupChecks.relay ?? safeSetupCheck(undefined),
      },
      lastChecks: {
        botCompletion: completion.generatedAt,
        localSetup: completion.setupChecks.local?.checkedAt ?? "",
        relaySetup: completion.setupChecks.relay?.checkedAt ?? "",
        diagnostics: diagnostics.generatedAt,
      },
      capabilities: completion.modeCapabilities,
      relay: summarizeRelayReadinessForSupport(completion.relayReadinessReport),
      giveaway: {
        status: giveawayState.summary.status,
        operatorState: giveawayState.summary.operatorState,
        entryCount: giveawayState.summary.entryCount,
        pendingConfirmationCount:
          giveawayState.summary.pendingConfirmationCount,
        expiredWinnerCount: giveawayState.summary.expiredWinnerCount,
        exportGeneratedAt:
          giveawayExport.available === true ? giveawayExport.exportedAt : "",
        exportEntrantCount:
          giveawayExport.available === true ? giveawayExport.entries.length : 0,
        exportWinnerCount:
          giveawayExport.available === true ? giveawayExport.winners.length : 0,
        redacted: true,
      },
    },
    discordSetup: getDiscordSetupSummary(secrets),
    diagnostics,
    featureGates: featureGates.list(),
    recent: {
      botLogs,
      outbound,
      audit,
      customCommandInvocations,
      timers,
      moderationHits: moderation.hits.map((hit) => ({
        id: hit.id,
        filterType: hit.filterType,
        action: hit.action,
        userLogin: hit.userLogin,
        detail: safeSupportText(hit.detail),
        messagePreview: safeSupportText(hit.messagePreview),
        createdAt: hit.createdAt,
      })),
    },
    recovery: diagnostics.firstRun.recoverySteps,
  };
};

const summarizeRelayReadinessForSupport = (
  relayReadinessReport: Awaited<ReturnType<typeof getRelayReadinessReport>>,
) => {
  if (!relayReadinessReport.ok) {
    return {
      connected: false,
      state: "not connected",
      detail: relayReadinessReport.error,
      lastCheckedAt: "",
      schemaReady: false,
      queueReady: false,
      eventSubFresh: false,
      discordCommandsFresh: false,
    };
  }

  const report = relayReadinessReport.report;
  if (report.codeReadiness) {
    return {
      connected: true,
      state: report.codeReadiness.state ?? report.summary?.state ?? "unknown",
      detail:
        report.codeReadiness.detail ??
        report.summary?.detail ??
        "Relay readiness report was returned.",
      lastCheckedAt:
        report.codeReadiness.lastCheckedAt ??
        report.summary?.lastCheckedAt ??
        report.generatedAt,
      schemaReady: report.codeReadiness.schemaReady === true,
      queueReady: report.codeReadiness.queueReady === true,
      eventSubFresh: report.codeReadiness.eventSubFresh === true,
      discordCommandsFresh: report.codeReadiness.discordCommandsFresh === true,
      queueAges: {
        twitchChatOldestAgeMs:
          report.codeReadiness.queueAges?.twitchChatOldestAgeMs ?? null,
        discordInteractionOldestAgeMs:
          report.codeReadiness.queueAges?.discordInteractionOldestAgeMs ?? null,
        outboundRetryOldestAgeMs:
          report.codeReadiness.queueAges?.outboundRetryOldestAgeMs ?? null,
      },
      latestRecordMetadata:
        report.codeReadiness.latestRecordMetadata ??
        report.latestRecordMetadata ??
        {},
    };
  }

  return {
    connected: true,
    state: report.summary?.state ?? "unknown",
    detail: report.summary?.detail ?? "Relay readiness report was returned.",
    lastCheckedAt: report.summary?.lastCheckedAt ?? report.generatedAt,
    schemaReady: report.schema?.ready === true,
    queueReady:
      (report.queues?.outboundRetry?.dueRetry ?? 0) === 0 &&
      (report.queues?.outboundRetry?.deadLettered ?? 0) === 0,
    eventSubFresh: report.freshness?.eventSub?.present === true,
    discordCommandsFresh:
      report.freshness?.discordCommandRegistration?.present === true,
    queueAges: {
      twitchChatOldestAgeMs:
        report.queues?.twitchChatEvents?.oldestAgeMs ?? null,
      discordInteractionOldestAgeMs:
        report.queues?.discordInteractions?.oldestAgeMs ?? null,
      outboundRetryOldestAgeMs:
        report.queues?.outboundRetry?.oldestRetryAgeMs ?? null,
    },
    latestRecordMetadata: report.latestRecordMetadata ?? {},
  };
};

const summarizeTimers = (timers: ReturnType<TimersService["listTimers"]>) => ({
  total: timers.length,
  enabled: timers.filter((timer) => timer.enabled).length,
  disabled: timers.filter((timer) => !timer.enabled).length,
  due: timers.filter(
    (timer) =>
      timer.enabled &&
      timer.nextFireAt &&
      Date.parse(timer.nextFireAt) <= Date.now(),
  ).length,
  sent: timers.reduce((total, timer) => total + timer.fireCount, 0),
  nextFireAt:
    timers
      .filter((timer) => timer.enabled && timer.nextFireAt)
      .map((timer) => timer.nextFireAt)
      .sort()[0] ?? "",
  blocked: timers.filter((timer) => timer.lastStatus === "blocked").length,
  waitingForActivity: timers.filter((timer) => timerNeedsActivity(timer))
    .length,
});

const getDiagnosticChecks = (input: {
  config: ReturnType<typeof getSafeConfig>;
  database: ReturnType<typeof getDatabaseDiagnostics>;
  setupUi: ReturnType<typeof getSetupUiDiagnostics>;
  queue: ReturnType<MessageQueue["snapshot"]>;
  queueHealth: ReturnType<typeof summarizeQueueHealth>;
  outbound: ReturnType<typeof outboundHistory.summary>;
  giveawayState: ReturnType<typeof getGiveawayState>;
  botSnapshot: ReturnType<typeof getBotProcessSnapshot>;
  featureGates: FeatureGateState[];
}): DiagnosticCheck[] => [
  {
    name: "Setup UI assets",
    ok: input.setupUi.appJs && input.setupUi.stylesCss,
    severity: "blocker",
    detail:
      input.setupUi.appJs && input.setupUi.stylesCss
        ? "Static setup UI assets are present."
        : "Rebuild vaexcore console so setup UI assets are available.",
  },
  {
    name: "Database",
    ok: input.database.ok,
    severity: "blocker",
    detail: input.database.ok
      ? `${input.database.driver} responded to SELECT 1.`
      : input.database.error || "Database did not respond.",
  },
  {
    name: "better-sqlite3",
    ok: input.database.driver === "better-sqlite3",
    severity: "warning",
    detail:
      input.database.driver === "better-sqlite3"
        ? "Native better-sqlite3 is active."
        : "Using SQLite fallback; rebuild the app package if this appears in Electron.",
  },
  {
    name: "Required Twitch config",
    ok: isSafeConfigComplete(),
    severity: "blocker",
    detail: isSafeConfigComplete()
      ? "Required Twitch config fields are present."
      : "Open Settings -> Setup Guide and complete missing Twitch fields.",
  },
  {
    name: "OAuth refresh",
    ok: input.config.hasClientSecret && input.config.hasRefreshToken,
    severity: "warning",
    detail:
      input.config.hasClientSecret && input.config.hasRefreshToken
        ? "Token refresh is available."
        : "Reconnect Twitch or add refresh-capable CLI config to enable automatic token refresh.",
  },
  {
    name: "Validated identities",
    ok: input.config.hasBotUserId && input.config.hasBroadcasterUserId,
    severity: "blocker",
    detail:
      input.config.hasBotUserId && input.config.hasBroadcasterUserId
        ? "Bot and broadcaster identities are resolved."
        : "Automatic launch validation has not resolved Twitch identities yet.",
  },
  {
    name: "Outbound queue",
    ok: input.queue.ready && input.queueHealth.status !== "blocked",
    severity: "blocker",
    detail:
      input.queue.ready && input.queueHealth.status !== "blocked"
        ? "Outbound queue is ready."
        : input.queueHealth.nextAction,
  },
  {
    name: "Critical giveaway chat",
    ok:
      input.outbound.criticalFailed === 0 &&
      !input.giveawayState.assurance.blockContinue,
    severity: "blocker",
    detail:
      input.outbound.criticalFailed === 0 &&
      !input.giveawayState.assurance.blockContinue
        ? "No blocking critical giveaway chat issue is tracked."
        : input.giveawayState.assurance.nextAction ||
          "Resolve critical giveaway chat delivery before continuing.",
  },
  {
    name: "Bot runtime",
    ok: Boolean(input.botSnapshot.running),
    severity: "warning",
    detail: input.botSnapshot.running
      ? `Bot process is ${input.botSnapshot.status}.`
      : "Start Bot when you are ready for live chat commands.",
  },
  {
    name: "Live chat confirmation",
    ok: botProcess.liveChatConfirmed,
    severity: "warning",
    detail: botProcess.liveChatConfirmed
      ? "Live chat confirmation has been observed."
      : "Type !ping in chat after starting the bot.",
  },
  {
    name: "Feature gates",
    ok: true,
    severity: "info",
    detail: input.featureGates
      .map((gate) => `${gate.label}: ${gate.mode}`)
      .join("; "),
  },
];

const getFirstRunStatus = (input: {
  config: ReturnType<typeof getSafeConfig>;
  database: ReturnType<typeof getDatabaseDiagnostics>;
  setupUi: ReturnType<typeof getSetupUiDiagnostics>;
}) => {
  const configFilePresent = existsSync(getLocalSecretsPath());
  const missingConfig = missingSafeConfigFields(input.config);
  const identitiesResolved =
    input.config.hasBotUserId && input.config.hasBroadcasterUserId;
  const cleanInstall =
    !configFilePresent &&
    !input.config.hasClientId &&
    !input.config.hasAccessToken;
  const blockers = [
    !input.setupUi.appJs || !input.setupUi.stylesCss
      ? "Setup UI assets are missing; rebuild vaexcore console."
      : undefined,
    !input.database.ok
      ? "SQLite did not respond; rebuild or reset the local app data folder."
      : undefined,
    missingConfig.length > 0
      ? `Missing Twitch setup fields: ${missingConfig.join(", ")}.`
      : undefined,
    missingConfig.length === 0 && !identitiesResolved
      ? "Twitch identities are not validated; automatic launch validation will retry after OAuth is connected."
      : undefined,
  ].filter(Boolean) as string[];
  const warnings = [
    input.database.driver !== "better-sqlite3"
      ? "SQLite fallback is active; rebuild the packaged app if this appears in Electron."
      : undefined,
    input.config.hasClientSecret && !input.config.hasRefreshToken
      ? "Automatic token refresh is not available; reconnect Twitch to store a refresh token."
      : undefined,
  ].filter(Boolean) as string[];

  const nextAction = cleanInstall
    ? "Open Settings -> Setup Guide."
    : (blockers[0] ?? warnings[0] ?? "Start Bot when you are ready.");

  return {
    cleanInstall,
    configFilePresent,
    setupComplete: missingConfig.length === 0 && identitiesResolved,
    missingConfig,
    blockers,
    warnings,
    nextAction,
    recoverySteps: firstRunRecoverySteps({
      cleanInstall,
      blockers,
      warnings,
      configFilePresent,
      databaseOk: input.database.ok,
      setupUiOk: input.setupUi.appJs && input.setupUi.stylesCss,
    }),
  };
};

const missingSafeConfigFields = (config: ReturnType<typeof getSafeConfig>) => {
  const missing: string[] = [];
  if (!config.hasClientId) missing.push("Client ID");
  if (!config.hasClientSecret) missing.push("Client Secret");
  if (!config.redirectUri) missing.push("Redirect URI");
  if (!config.broadcasterLogin) missing.push("Broadcaster Login");
  if (!config.botLogin) missing.push("Bot Login");
  if (!config.hasAccessToken) missing.push("Twitch OAuth");
  return missing;
};

const firstRunRecoverySteps = (input: {
  cleanInstall: boolean;
  blockers: string[];
  warnings: string[];
  configFilePresent: boolean;
  databaseOk: boolean;
  setupUiOk: boolean;
}) => {
  if (input.cleanInstall) {
    return [
      "Open Settings -> Setup Guide.",
      "Create or reuse a Twitch Developer application.",
      "Save credentials and usernames, then Connect Twitch.",
      "Automatic validation and preflight will run; then send a test message and start the bot.",
    ];
  }

  if (!input.setupUiOk) {
    return [
      "Run npm run build, then reopen vaexcore console or rerun npm run setup.",
    ];
  }

  if (!input.databaseOk) {
    return [
      "Quit vaexcore console.",
      "Back up the local app data folder if needed.",
      "Rebuild the app; reset the local data folder only if SQLite remains unhealthy.",
    ];
  }

  if (input.blockers.length > 0) {
    return [
      "Open Settings -> Setup Guide.",
      "Complete the missing setup item shown in Diagnostics.",
      "Let automatic launch validation complete before starting the bot.",
    ];
  }

  if (input.warnings.length > 0) {
    return [
      "Review the warning before going live.",
      "If token refresh is missing, reconnect Twitch.",
      "If SQLite fallback appears in Electron, rebuild the packaged app.",
    ];
  }

  return ["Start Bot, then type !ping in Twitch chat to confirm live chat."];
};

const getDatabaseDiagnostics = () => {
  try {
    const row = db.prepare("SELECT 1 AS ok").get() as
      | { ok?: unknown }
      | undefined;
    const ok = row?.ok === 1;

    return {
      ok,
      driver: db.pragma ? "better-sqlite3" : "node:sqlite fallback",
      path: resolveDatabasePath(databaseUrl),
      error: ok ? "" : "Unexpected SELECT 1 result.",
    };
  } catch (error) {
    return {
      ok: false,
      driver: db.pragma ? "better-sqlite3" : "node:sqlite fallback",
      path: resolveDatabasePath(databaseUrl),
      error: safeErrorMessage(error, "Database probe failed."),
    };
  }
};

const getSetupUiDiagnostics = () => {
  const dir = getSetupUiDir();
  return {
    dir,
    appJs: existsSync(join(dir, "app.js")),
    stylesCss: existsSync(join(dir, "styles.css")),
    logoJpg: Boolean(resolveSetupUiAssetPath("logo.jpg")),
  };
};

const getPackageInfo = () => {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), "package.json"),
    resolve(currentDir, "..", "package.json"),
    resolve(currentDir, "..", "..", "package.json"),
  ];

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        const parsed = JSON.parse(readFileSync(candidate, "utf8")) as {
          name?: string;
          version?: string;
        };
        return {
          name: parsed.name ?? "vaexcore",
          version: parsed.version ?? "unknown",
        };
      }
    } catch {
      continue;
    }
  }

  return { name: "vaexcore", version: "unknown" };
};

const getRuntimeKind = () => {
  if (process.versions.electron) {
    return "electron";
  }

  return dirname(fileURLToPath(import.meta.url)).includes("dist-bundle")
    ? "bundled-node"
    : "source-tsx";
};

const safeDatabaseUrl = (value: string) => {
  if (value === ":memory:") {
    return value;
  }

  if (value.startsWith("file:")) {
    return "file:<local sqlite path>";
  }

  return "<local sqlite path>";
};

const safeAuditMetadata = (raw: string) => {
  try {
    return redactSecrets(JSON.parse(raw));
  } catch {
    return safeSupportText(raw);
  }
};

const safeSupportText = (value: unknown) =>
  redactSecretText(String(value ?? ""));

const summarizeQueueHealth = (
  queue: ReturnType<MessageQueue["snapshot"]>,
  outbound: ReturnType<typeof outboundHistory.summary>,
) => {
  const blockers = [
    !queue.ready ? "Outbound queue is not running." : undefined,
    queue.oldestAgeMs > queueStaleWarningMs
      ? `Oldest queued message has waited ${formatDuration(queue.oldestAgeMs)}.`
      : undefined,
    queue.rateLimitDelayMs > 0
      ? `Outbound queue is waiting ${formatDuration(queue.rateLimitDelayMs)} for the send throttle.`
      : undefined,
    outbound.criticalFailed > 0
      ? `${outbound.criticalFailed} critical outbound message(s) failed.`
      : undefined,
  ].filter(Boolean) as string[];
  const status =
    !queue.ready || outbound.criticalFailed > 0
      ? "blocked"
      : blockers.length ||
          queue.processing ||
          queue.queued > 0 ||
          queue.rateLimitDelayMs > 0 ||
          queue.retryDelayMs > 0
        ? "watch"
        : "clear";
  const nextAction = !queue.ready
    ? "Restart the setup console if queue readiness does not recover."
    : outbound.criticalFailed > 0
      ? "Use panic resend or phase resend after confirming chat missed the message."
      : queue.retryDelayMs > 0
        ? `Waiting ${formatDuration(queue.retryDelayMs)} before the next retry.`
        : queue.rateLimitDelayMs > 0
          ? `Waiting ${formatDuration(queue.rateLimitDelayMs)} for the outbound send throttle.`
          : queue.oldestAgeMs > queueStaleWarningMs
            ? "Wait for the queue to flush or restart the bot if the age keeps rising."
            : queue.queued > 0 || queue.processing
              ? "Wait for queued chat messages to send."
              : "Outbound queue clear.";

  return {
    status,
    blockers,
    nextAction,
    stale: queue.oldestAgeMs > queueStaleWarningMs,
    oldestAgeMs: queue.oldestAgeMs,
    oldestAge: formatDuration(queue.oldestAgeMs),
    oldestAction: queue.oldestAction,
    oldestImportance: queue.oldestImportance,
    nextAttemptAt: queue.nextAttemptAt,
    retryDelayMs: queue.retryDelayMs,
    retryDelay: formatDuration(queue.retryDelayMs),
    rateLimited: queue.rateLimitDelayMs > 0,
    rateLimitedUntil: queue.rateLimitedUntil,
    rateLimitDelayMs: queue.rateLimitDelayMs,
    rateLimitDelay: formatDuration(queue.rateLimitDelayMs),
    pending: queue.queued,
    processing: queue.processing,
    maxAttempts: queue.maxAttempts,
    rateLimitedPending: outbound.rateLimited,
  };
};

const summarizeOutboundRecovery = () => {
  const latestCritical = latestFailedCriticalGiveawayMessage();
  const latestFailed = latestCritical ?? outboundHistory.latestFailed();

  if (!latestFailed) {
    return {
      needed: false,
      severity: "clear",
      safeToResend: false,
      nextAction: "No outbound recovery needed.",
      steps: ["Keep monitoring Live Mode during giveaway transitions."],
    };
  }

  const safeToResend = canSendConfiguredChat();
  const critical = latestFailed.importance === "critical";

  return {
    needed: true,
    severity: critical ? "critical" : "warning",
    safeToResend,
    id: latestFailed.id,
    category: latestFailed.category,
    action: latestFailed.action,
    importance: latestFailed.importance,
    failureCategory: latestFailed.failureCategory,
    reason: latestFailed.reason || "No failure reason recorded.",
    updatedAt: latestFailed.updatedAt,
    attempts: latestFailed.attempts,
    giveawayId: latestFailed.giveawayId,
    nextAction: outboundRecoveryNextAction(latestFailed, safeToResend),
    steps: outboundRecoverySteps(latestFailed, safeToResend),
  };
};

const outboundRecoveryNextAction = (
  latestFailed: OutboundMessageRecord,
  safeToResend: boolean,
) => {
  if (!safeToResend) {
    return latestFailed.failureCategory === "auth" ||
      latestFailed.failureCategory === "config"
      ? "Fix Twitch setup and let automatic validation complete before resending outbound chat."
      : "Automatic validation must pass before resending outbound chat.";
  }

  if (latestFailed.failureCategory === "rate_limit") {
    return "Wait for the queue to clear, then resend only if Twitch chat missed the message.";
  }

  if (latestFailed.importance === "critical") {
    return "Use panic resend or phase resend if Twitch chat did not receive this critical message.";
  }

  return "Use resend if the message is still useful.";
};

const outboundRecoverySteps = (
  latestFailed: OutboundMessageRecord,
  safeToResend: boolean,
) => {
  const categorySteps: Record<
    OutboundMessageRecord["failureCategory"],
    string
  > = {
    none: "No failure category was recorded.",
    config: "Open Settings and complete missing Twitch IDs or credentials.",
    auth: "Reconnect Twitch with the bot account and required chat scopes.",
    rate_limit: "Wait for Twitch rate limiting to clear before retrying.",
    twitch_rejected: "Check the message and Twitch response before retrying.",
    network: "Confirm local network connectivity before retrying.",
    timeout: "Retry after Twitch/network latency settles.",
    unknown: "Review the failure reason before retrying.",
  };

  return [
    categorySteps[latestFailed.failureCategory],
    "Check Twitch chat for the original message.",
    safeToResend
      ? "Resend only if the message is missing or still relevant."
      : "Automatic validation must pass before resending.",
    latestFailed.importance === "critical"
      ? "Use Live Mode -> Panic Resend for the latest failed critical giveaway message."
      : "Use Outbound Chat History -> Resend for this message.",
    "Watch Queue Health until pending messages clear.",
  ];
};

const formatDuration = (ageMs: number) => {
  if (!Number.isFinite(ageMs) || ageMs <= 0) {
    return "0s";
  }

  const seconds = Math.round(ageMs / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
};

const isSafeConfigComplete = () => {
  const config = getSafeConfig();
  return Boolean(
    config.hasClientId &&
    config.hasClientSecret &&
    config.hasAccessToken &&
    config.hasBroadcasterUserId &&
    config.hasBotUserId &&
    config.tokenValidatedAt,
  );
};

type GiveawayReminderState = {
  enabled: boolean;
  intervalMinutes: number;
  lastSentAt: string;
  nextSendAt: string;
  lastError: string;
  timer: NodeJS.Timeout | undefined;
};

type GiveawayReminderSettingsRow = {
  enabled: number;
  interval_minutes: number;
  last_sent_at: string;
};

function createGiveawayReminderState(): GiveawayReminderState {
  const saved = readGiveawayReminderSettings();
  return {
    enabled: saved.enabled,
    intervalMinutes: saved.intervalMinutes,
    lastSentAt: saved.lastSentAt,
    nextSendAt: saved.enabled
      ? nextGiveawayReminderAt(saved.intervalMinutes)
      : "",
    lastError: "",
    timer: undefined,
  };
}

const getGiveawayReminder = () => {
  const status = giveawaysService.status();
  return {
    ok: true,
    reminder: {
      enabled: giveawayReminder.enabled,
      intervalMinutes: giveawayReminder.intervalMinutes,
      lastSentAt: giveawayReminder.lastSentAt,
      nextSendAt: giveawayReminder.nextSendAt,
      lastError: giveawayReminder.lastError,
      openGiveaway: Boolean(status?.giveaway.status === "open"),
      giveawayTitle: status?.giveaway.title ?? "",
    },
  };
};

const setGiveawayReminder = (body: unknown) => {
  const input = body as {
    enabled?: boolean;
    intervalMinutes?: number | string;
  };
  const intervalMinutes = parseSafeInteger(
    input.intervalMinutes ?? giveawayReminder.intervalMinutes,
    {
      field: "Reminder interval",
      min: 2,
      max: 60,
    },
  );
  const intervalChanged = intervalMinutes !== giveawayReminder.intervalMinutes;

  giveawayReminder.enabled = Boolean(input.enabled);
  giveawayReminder.intervalMinutes = intervalMinutes;
  giveawayReminder.lastError = "";

  if (!giveawayReminder.enabled) {
    giveawayReminder.nextSendAt = "";
    clearGiveawayReminderTimer();
    persistGiveawayReminderSettings();
    return getGiveawayReminder();
  }

  if (intervalChanged || !giveawayReminder.nextSendAt) {
    giveawayReminder.nextSendAt = nextGiveawayReminderAt(intervalMinutes);
  }

  persistGiveawayReminderSettings();
  scheduleGiveawayReminder();
  return getGiveawayReminder();
};

const sendGiveawayReminderNow = () => {
  const result = queueGiveawayReminderAnnouncement({ manual: true });

  if (result.ok) {
    giveawayReminder.lastSentAt = new Date().toISOString();
    giveawayReminder.lastError = "";
    persistGiveawayReminderSettings();
    if (giveawayReminder.enabled) {
      giveawayReminder.nextSendAt = nextGiveawayReminderAt(
        giveawayReminder.intervalMinutes,
      );
      scheduleGiveawayReminder();
    }
  } else {
    giveawayReminder.lastError = result.error ?? "Reminder was not queued.";
  }

  return {
    ...getGiveawayReminder(),
    ...result,
  };
};

const queueGiveawayReminderAnnouncement = (
  options: { manual?: boolean } = {},
) => {
  const status = giveawaysService.status();

  if (!status || status.giveaway.status !== "open") {
    if (!options.manual) {
      return {
        ok: true,
        queued: false,
        skipped: true,
        reason: "No open giveaway.",
      };
    }

    return {
      ok: false,
      error: "Reminder requires an open giveaway.",
    };
  }

  const queued = maybeQueueGiveawayAnnouncements(
    giveawayAnnouncement(
      giveawayTemplates.reminder(status.giveaway, status.entries),
      "reminder",
      status.giveaway.id,
      "important",
    ),
  );

  if (!queued) {
    return {
      ok: false,
      error: "Reminder could not queue because chat is not fully configured.",
    };
  }

  return {
    ok: true,
    queued: true,
  };
};

const scheduleGiveawayReminder = () => {
  clearGiveawayReminderTimer();

  if (!giveawayReminder.enabled) {
    return;
  }

  const nextAt = Date.parse(giveawayReminder.nextSendAt);
  const delayMs = Number.isFinite(nextAt)
    ? Math.max(1000, nextAt - Date.now())
    : giveawayReminder.intervalMinutes * 60 * 1000;

  giveawayReminder.timer = setTimeout(() => {
    giveawayReminder.timer = undefined;
    const result = queueGiveawayReminderAnnouncement();

    if (result.ok && result.queued) {
      giveawayReminder.lastSentAt = new Date().toISOString();
      giveawayReminder.lastError = "";
      persistGiveawayReminderSettings();
    } else if (!result.ok) {
      giveawayReminder.lastError = result.error ?? "Reminder was not queued.";
      logger.warn(
        { error: giveawayReminder.lastError },
        "Giveaway reminder was not queued",
      );
    }

    giveawayReminder.nextSendAt = nextGiveawayReminderAt(
      giveawayReminder.intervalMinutes,
    );
    scheduleGiveawayReminder();
  }, delayMs);
  giveawayReminder.timer.unref?.();
};

const clearGiveawayReminderTimer = () => {
  if (!giveawayReminder.timer) {
    return;
  }

  clearTimeout(giveawayReminder.timer);
  giveawayReminder.timer = undefined;
};

function readGiveawayReminderSettings() {
  const row = db
    .prepare(
      "SELECT enabled, interval_minutes, last_sent_at FROM giveaway_reminder_settings WHERE id = 1",
    )
    .get() as GiveawayReminderSettingsRow | undefined;
  const interval = Number(row?.interval_minutes ?? 10);

  return {
    enabled: row?.enabled === 1,
    intervalMinutes:
      Number.isInteger(interval) && interval >= 2 && interval <= 60
        ? interval
        : 10,
    lastSentAt: row?.last_sent_at ?? "",
  };
}

function persistGiveawayReminderSettings() {
  db.prepare(
    `
      INSERT INTO giveaway_reminder_settings (
        id,
        enabled,
        interval_minutes,
        last_sent_at,
        updated_at
      ) VALUES (
        1,
        @enabled,
        @intervalMinutes,
        @lastSentAt,
        @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        enabled = excluded.enabled,
        interval_minutes = excluded.interval_minutes,
        last_sent_at = excluded.last_sent_at,
        updated_at = excluded.updated_at
    `,
  ).run({
    enabled: giveawayReminder.enabled ? 1 : 0,
    intervalMinutes: giveawayReminder.intervalMinutes,
    lastSentAt: giveawayReminder.lastSentAt,
    updatedAt: new Date().toISOString(),
  });
}

function nextGiveawayReminderAt(intervalMinutes: number) {
  return new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString();
}

type BotProcessState = {
  child: ChildProcess | undefined;
  status: "stopped" | "starting" | "running" | "stopping" | "exited" | "failed";
  pid: number | undefined;
  startedAt: string;
  stoppedAt: string;
  exitCode: number | null | undefined;
  signal: NodeJS.Signals | string | null | undefined;
  eventSubConnected: boolean;
  chatSubscriptionActive: boolean;
  liveChatConfirmed: boolean;
  lastError: string;
  recentLogs: string[];
  stdoutBuffer: string;
  stderrBuffer: string;
};

function createBotProcessState(): BotProcessState {
  return {
    child: undefined,
    status: "stopped",
    pid: undefined,
    startedAt: "",
    stoppedAt: "",
    exitCode: undefined,
    signal: undefined,
    eventSubConnected: false,
    chatSubscriptionActive: false,
    liveChatConfirmed: false,
    lastError: "",
    recentLogs: [],
    stdoutBuffer: "",
    stderrBuffer: "",
  };
}

const startBotProcess = async () => {
  if (botProcess.child && !botProcess.child.killed) {
    return {
      ok: true,
      alreadyRunning: true,
      botProcess: getBotProcessSnapshot(),
    };
  }

  const validation = await validateSetup();
  const startReadiness = getBotStartReadiness(validation.checks);

  if (!validation.ok || !startReadiness.ok) {
    const failed = startReadiness.checks.find((check) => !check.ok);
    return {
      ok: false,
      error:
        failed?.detail ||
        "Resolve readiness blockers before starting the live bot.",
      nextAction:
        failed?.detail ||
        "Let automatic launch validation complete before starting the bot.",
      checks: startReadiness.checks,
      diagnostics: getDiagnosticsReport(),
      botProcess: getBotProcessSnapshot(),
    };
  }

  let command: ReturnType<typeof getBotRuntimeCommand>;

  try {
    command = getBotRuntimeCommand();
  } catch (error) {
    const detail = safeErrorMessage(
      error,
      "Unable to find vaexcore console live bot entrypoint.",
    );
    return {
      ok: false,
      error: detail,
      nextAction: "Run npm run build, then try Start Bot again.",
      checks: [
        ...startReadiness.checks,
        { name: "Bot runtime entrypoint", ok: false, detail },
      ],
      diagnostics: getDiagnosticsReport(),
      botProcess: getBotProcessSnapshot(),
    };
  }

  resetBotProcessForStart();

  const child = spawn(command.executable, command.args, {
    cwd: command.cwd,
    env: getBotRuntimeEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });

  botProcess.child = child;
  botProcess.pid = child.pid;
  botProcess.status = "starting";
  appendBotLog("system", `Starting live bot process: ${command.display}`);

  child.stdout.on("data", (chunk: Buffer) => handleBotOutput("stdout", chunk));
  child.stderr.on("data", (chunk: Buffer) => handleBotOutput("stderr", chunk));
  child.once("spawn", () => {
    botProcess.status = "running";
  });
  child.once("error", (error) => {
    botProcess.status = "failed";
    botProcess.lastError = safeErrorMessage(
      error,
      "Bot process failed to start.",
    );
    appendBotLog("error", botProcess.lastError);
  });
  child.once("exit", (code, signal) => {
    flushBotOutput();
    botProcess.child = undefined;
    botProcess.pid = undefined;
    botProcess.stoppedAt = new Date().toISOString();
    botProcess.exitCode = code;
    botProcess.signal = signal;
    botProcess.eventSubConnected = false;
    botProcess.chatSubscriptionActive = false;
    botProcess.status =
      botProcess.status === "stopping"
        ? "stopped"
        : code === 0
          ? "exited"
          : "failed";
    if (code !== 0 && botProcess.status === "failed") {
      botProcess.lastError = `Bot process exited with code ${code ?? "unknown"}.`;
    }
    appendBotLog("system", `Live bot process ${botProcess.status}.`);
  });

  return {
    ok: true,
    started: true,
    nextAction: "Wait for EventSub, then type !ping in Twitch chat.",
    checks: startReadiness.checks,
    botProcess: getBotProcessSnapshot(),
  };
};

const getBotStartReadiness = (
  validationChecks: Array<{ name: string; ok: boolean; detail: string }>,
) => {
  const queue = chatQueue.snapshot();
  const checks = [
    ...validationChecks,
    {
      name: "Outbound queue",
      ok: queue.ready,
      detail: queue.ready
        ? "Outbound queue is ready."
        : "Restart the setup console if queue readiness does not recover.",
    },
  ];

  return {
    ok: checks.every((check) => check.ok),
    checks,
  };
};

const stopBotProcess = async (options: { force?: boolean } = {}) => {
  const child = botProcess.child;

  if (!child) {
    return {
      ok: true,
      alreadyStopped: true,
      botProcess: getBotProcessSnapshot(),
    };
  }

  botProcess.status = "stopping";
  appendBotLog("system", "Stopping live bot process.");
  child.kill("SIGTERM");

  const stopped = await waitForBotExit(child, options.force ? 1500 : 10000);

  if (!stopped && options.force) {
    child.kill("SIGKILL");
    await waitForBotExit(child, 1500);
  }

  return { ok: true, stopped: true, botProcess: getBotProcessSnapshot() };
};

const waitForBotExit = (child: ChildProcess, timeoutMs: number) =>
  new Promise<boolean>((resolve) => {
    if (!botProcess.child || botProcess.child !== child) {
      resolve(true);
      return;
    }

    const timeout = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });

const resetBotProcessForStart = () => {
  botProcess.status = "starting";
  botProcess.pid = undefined;
  botProcess.startedAt = new Date().toISOString();
  botProcess.stoppedAt = "";
  botProcess.exitCode = undefined;
  botProcess.signal = undefined;
  botProcess.eventSubConnected = false;
  botProcess.chatSubscriptionActive = false;
  botProcess.liveChatConfirmed = false;
  botProcess.lastError = "";
  botProcess.recentLogs = [];
  botProcess.stdoutBuffer = "";
  botProcess.stderrBuffer = "";
};

const getBotProcessSnapshot = () => ({
  status: botProcess.status,
  running: Boolean(botProcess.child),
  pid: botProcess.pid,
  startedAt: botProcess.startedAt,
  stoppedAt: botProcess.stoppedAt,
  exitCode: botProcess.exitCode,
  signal: botProcess.signal,
  eventSubConnected: botProcess.eventSubConnected,
  chatSubscriptionActive: botProcess.chatSubscriptionActive,
  liveChatConfirmed: botProcess.liveChatConfirmed,
  lastError: botProcess.lastError,
  recentLogs: botProcess.recentLogs.slice(-20),
});

const getBotRuntimeCommand = () => {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const sharedRoot = resolve(currentDir, "../..");
  const sourceRoot = resolve(sharedRoot, "../..");
  const bundledRoot = resolve(currentDir, "..");
  const sourceIndex = join(sharedRoot, "src/index.ts");
  const tsxCli = join(sourceRoot, "node_modules/tsx/dist/cli.mjs");
  const bundledIndex = join(currentDir, "live-bot.js");

  if (
    currentDir.endsWith(join("src", "setup")) &&
    existsSync(sourceIndex) &&
    existsSync(tsxCli)
  ) {
    return {
      executable: process.execPath,
      args: [tsxCli, "desktop/shared/src/index.ts"],
      cwd: sourceRoot,
      display: "tsx desktop/shared/src/index.ts",
    };
  }

  if (existsSync(bundledIndex)) {
    return {
      executable: process.execPath,
      args: [bundledIndex],
      cwd: bundledRoot,
      display: "node dist-bundle/live-bot.js",
    };
  }

  if (existsSync(sourceIndex) && existsSync(tsxCli)) {
    return {
      executable: process.execPath,
      args: [tsxCli, "desktop/shared/src/index.ts"],
      cwd: sourceRoot,
      display: "tsx desktop/shared/src/index.ts",
    };
  }

  throw new Error("Unable to find vaexcore console live bot entrypoint.");
};

const getBotRuntimeEnv = () => {
  const configDir = dirname(getLocalSecretsPath());
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VAEXCORE_MODE: "live",
    VAEXCORE_CONFIG_DIR: configDir,
    DATABASE_URL: databaseUrl,
  };

  if (process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = "1";
  } else {
    delete env.ELECTRON_RUN_AS_NODE;
  }

  return env;
};

const handleBotOutput = (stream: "stdout" | "stderr", chunk: Buffer) => {
  const key = stream === "stdout" ? "stdoutBuffer" : "stderrBuffer";
  botProcess[key] += chunk.toString("utf8");
  const parts = botProcess[key].split(/\r?\n/);
  botProcess[key] = parts.pop() ?? "";

  for (const line of parts) {
    processBotLog(stream, line);
  }
};

const flushBotOutput = () => {
  if (botProcess.stdoutBuffer) {
    processBotLog("stdout", botProcess.stdoutBuffer);
    botProcess.stdoutBuffer = "";
  }
  if (botProcess.stderrBuffer) {
    processBotLog("stderr", botProcess.stderrBuffer);
    botProcess.stderrBuffer = "";
  }
};

const processBotLog = (
  stream: "stdout" | "stderr" | "system" | "error",
  rawLine: string,
) => {
  const line = rawLine.trim();
  if (!line) return;

  updateBotStatusFromLog(line);
  appendBotLog(stream, line);
};

const appendBotLog = (stream: string, line: string) => {
  const safeLine = redactSecretText(line);
  botProcess.recentLogs.push(
    `${new Date().toISOString()} ${stream}: ${safeLine}`,
  );

  if (botProcess.recentLogs.length > 100) {
    botProcess.recentLogs.splice(0, botProcess.recentLogs.length - 100);
  }
};

const updateBotStatusFromLog = (line: string) => {
  try {
    const parsed = JSON.parse(line) as {
      msg?: string;
      operatorEvent?: string;
      code?: number;
      reason?: unknown;
      message?: unknown;
      outboundMessageId?: unknown;
      outboundStatus?: unknown;
      attempts?: unknown;
      attempt?: unknown;
      queued?: unknown;
      outboundCategory?: unknown;
      outboundAction?: unknown;
      outboundImportance?: unknown;
      failureCategory?: unknown;
      retryAfterMs?: unknown;
      nextAttemptAt?: unknown;
      giveawayId?: unknown;
      resentFrom?: unknown;
    };
    const msg = parsed.msg ?? "";
    const operatorEvent = parsed.operatorEvent ?? "";

    const outboundMessageId =
      typeof parsed.outboundMessageId === "string"
        ? parsed.outboundMessageId
        : "";
    const outboundStatus =
      typeof parsed.outboundStatus === "string" &&
      isOutboundStatus(parsed.outboundStatus)
        ? parsed.outboundStatus
        : undefined;

    if (outboundMessageId && outboundStatus) {
      outboundHistory.record({
        id: outboundMessageId,
        source: "bot",
        status: outboundStatus,
        message:
          typeof parsed.message === "string" ? parsed.message : undefined,
        attempts: parseOptionalNumber(parsed.attempts ?? parsed.attempt),
        reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
        failureCategory:
          typeof parsed.failureCategory === "string" &&
          isOutboundFailureCategory(parsed.failureCategory)
            ? parsed.failureCategory
            : undefined,
        retryAfterMs: parseOptionalNumber(parsed.retryAfterMs),
        nextAttemptAt:
          typeof parsed.nextAttemptAt === "string"
            ? parsed.nextAttemptAt
            : undefined,
        queueDepth: parseOptionalNumber(parsed.queued),
        metadata: {
          category:
            typeof parsed.outboundCategory === "string" &&
            isOutboundCategory(parsed.outboundCategory)
              ? parsed.outboundCategory
              : undefined,
          action:
            typeof parsed.outboundAction === "string"
              ? parsed.outboundAction
              : undefined,
          importance:
            typeof parsed.outboundImportance === "string" &&
            isOutboundImportance(parsed.outboundImportance)
              ? parsed.outboundImportance
              : undefined,
          giveawayId: parseOptionalNumber(parsed.giveawayId),
          resentFrom:
            typeof parsed.resentFrom === "string"
              ? parsed.resentFrom
              : undefined,
        },
      });
    }

    if (
      msg === "EventSub WebSocket opened" ||
      msg === "Startup checklist: EventSub connected"
    ) {
      botProcess.eventSubConnected = true;
    }
    if (
      operatorEvent === "chat subscription created" ||
      msg === "Startup checklist: chat subscription created"
    ) {
      botProcess.chatSubscriptionActive = true;
    }
    if (msg === "LIVE CHAT CONFIRMED") {
      botProcess.liveChatConfirmed = true;
    }
    if (msg === "EventSub WebSocket closed") {
      botProcess.eventSubConnected = false;
      botProcess.chatSubscriptionActive = false;
    }
    if (line.includes("failed") || line.includes("error")) {
      botProcess.lastError = msg || line;
    }
  } catch {
    if (line.includes("LIVE CHAT CONFIRMED")) {
      botProcess.liveChatConfirmed = true;
    }
  }
};

const isOutboundStatus = (value: string): value is MessageQueueEventStatus =>
  ["queued", "sending", "retrying", "sent", "failed"].includes(value);

const parseOptionalNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const enqueueChatMessage = async (
  message: string | undefined,
  metadata: MessageQueueMetadata = {},
) => {
  const text = sanitizeChatMessage(message);

  const validation = await validateSetup();

  if (!validation.ok) {
    return {
      ok: false,
      error: "Validation must pass before sending chat messages.",
      checks: validation.checks,
    };
  }

  const outboundMessageId = chatQueue.enqueue(text, metadata);
  return { ok: true, queued: true, outboundMessageId };
};

const getOperatorMessages = () => ({
  ok: true,
  templates: operatorMessages.list(),
});

const saveOperatorMessages = (body: unknown) => ({
  ...getOperatorMessages(),
  templates: operatorMessages.save(body),
});

const resetOperatorMessages = (ids: unknown) => ({
  ...getOperatorMessages(),
  templates: operatorMessages.reset(ids),
});

const sendOperatorMessage = async (body: {
  id?: string;
  confirmed?: boolean;
}) => {
  const template = operatorMessages.find(body.id);

  if (!template) {
    return {
      ...getOperatorMessages(),
      ok: false,
      error: "Unknown operator message preset.",
    };
  }

  if (template.requiresConfirmation && body.confirmed !== true) {
    return {
      ...getOperatorMessages(),
      ok: false,
      error: `${template.label} requires confirmation before sending.`,
    };
  }

  const result = await enqueueChatMessage(template.template, {
    category: "operator",
    action: template.id,
    importance: template.requiresConfirmation ? "important" : "normal",
  });

  return {
    ...getOperatorMessages(),
    ...result,
    sentPreset: template.id,
  };
};

const exportBotConfigBundle = () => {
  const moderation = moderationService.getState();
  const reminder = getGiveawayReminder().reminder;

  return {
    ok: true,
    version: 1,
    exportedAt: new Date().toISOString(),
    includesSecrets: false,
    note: "Safe bot behavior only. Twitch OAuth tokens, client secrets, runtime history, active giveaways, and prize data are excluded.",
    commands: customCommandsService.exportCommands().commands,
    timers: exportTimers().timers,
    moderation: {
      settings: safeModerationSettings(moderation.settings),
      terms: moderation.terms.map((term) => ({
        term: term.term,
        enabled: term.enabled,
      })),
      allowedLinks: moderation.allowedLinks.map((link) => ({
        domain: link.domain,
        enabled: link.enabled,
      })),
      blockedLinks: moderation.blockedLinks.map((link) => ({
        domain: link.domain,
        enabled: link.enabled,
      })),
    },
    operatorMacros: operatorMessages.list().map((template) => ({
      id: template.id,
      template: template.template,
    })),
    giveawayTemplates: giveawayTemplates.list().map((template) => ({
      action: template.action,
      template: template.template,
    })),
    giveawayReminder: {
      enabled: reminder.enabled,
      intervalMinutes: reminder.intervalMinutes,
    },
  };
};

const importBotConfigBundle = (body: unknown) => {
  try {
    const payload = body as Record<string, unknown>;
    const imported = {
      commands: 0,
      timers: 0,
      moderationSettings: 0,
      moderationTerms: 0,
      moderationAllowedLinks: 0,
      moderationBlockedLinks: 0,
      operatorMacros: 0,
      giveawayTemplates: 0,
      giveawayReminder: 0,
    };

    const commandEntries = bundleArray(payload.commands);
    if (commandEntries.length) {
      imported.commands = customCommandsService.importCommands(
        { commands: commandEntries },
        localUiActor,
        { reservedNames: getCustomCommandReservedNames() },
      ).length;
    }

    const timerEntries = bundleArray(payload.timers);
    if (timerEntries.length) {
      imported.timers = importTimerEntries(timerEntries);
    }

    const moderationPayload = payload.moderation as
      | Record<string, unknown>
      | undefined;
    if (moderationPayload && typeof moderationPayload === "object") {
      if (
        moderationPayload.settings &&
        typeof moderationPayload.settings === "object"
      ) {
        moderationService.saveSettings(
          moderationPayload.settings,
          localUiActor,
        );
        imported.moderationSettings = 1;
      }

      imported.moderationTerms = importModerationTerms(
        bundleArray(moderationPayload.terms),
      );
      imported.moderationAllowedLinks = importModerationLinks(
        bundleArray(moderationPayload.allowedLinks),
        "allowed",
      );
      imported.moderationBlockedLinks = importModerationLinks(
        bundleArray(moderationPayload.blockedLinks),
        "blocked",
      );
    }

    imported.operatorMacros = importOperatorMacros(
      payload.operatorMacros ?? payload.operatorMessages,
    );
    imported.giveawayTemplates = importGiveawayTemplates(
      payload.giveawayTemplates,
    );

    if (
      payload.giveawayReminder &&
      typeof payload.giveawayReminder === "object"
    ) {
      setGiveawayReminder(payload.giveawayReminder);
      imported.giveawayReminder = 1;
    }

    if (!Object.values(imported).some((count) => count > 0)) {
      throw new Error(
        "Import payload did not include commands, timers, moderation, operator macros, or giveaway templates.",
      );
    }

    writeAuditLog(
      db,
      localUiActor,
      "bot_config.import",
      "bot_config",
      imported,
    );

    return {
      ...exportBotConfigBundle(),
      ok: true,
      imported,
    };
  } catch (error) {
    return {
      ok: false,
      error: safeErrorMessage(error, "Bot config import failed"),
    };
  }
};

const importTimerEntries = (entries: unknown[]) => {
  const saved = entries.slice(0, 50).map((entry) => {
    const input = entry as Record<string, unknown>;
    const name = String(input.name ?? "")
      .trim()
      .toLowerCase();
    const existing = timersService
      .listTimers()
      .find((timer) => timer.name.toLowerCase() === name);

    return timersService.saveTimer(
      {
        ...input,
        id: existing?.id,
      },
      localUiActor,
    );
  });

  return saved.length;
};

const importModerationTerms = (entries: unknown[]) => {
  let imported = 0;

  for (const entry of entries.slice(0, 100)) {
    const input = entry as Record<string, unknown>;
    const term = String(input.term ?? "")
      .trim()
      .toLowerCase();
    const existing = moderationService
      .listTerms()
      .find((item) => item.term === term);

    moderationService.saveTerm(
      {
        ...input,
        id: existing?.id,
      },
      localUiActor,
    );
    imported += 1;
  }

  return imported;
};

const importModerationLinks = (
  entries: unknown[],
  type: "allowed" | "blocked",
) => {
  let imported = 0;

  for (const entry of entries.slice(0, 100)) {
    const input = entry as Record<string, unknown>;
    const domain = normalizeBundleDomain(input.domain);

    if (type === "allowed") {
      const existing = moderationService
        .listAllowedLinks()
        .find((item) => item.domain === domain);

      moderationService.saveAllowedLink(
        {
          ...input,
          id: existing?.id,
        },
        localUiActor,
      );
    } else {
      const existing = moderationService
        .listBlockedLinks()
        .find((item) => item.domain === domain);

      moderationService.saveBlockedLink(
        {
          ...input,
          id: existing?.id,
        },
        localUiActor,
      );
    }

    imported += 1;
  }

  return imported;
};

const importOperatorMacros = (input: unknown) => {
  const templates = bundleTemplateMap(input, "id", "template");

  if (Object.keys(templates).length === 0) {
    return 0;
  }

  operatorMessages.save({ templates });
  return Object.keys(templates).length;
};

const importGiveawayTemplates = (input: unknown) => {
  const templates = bundleTemplateMap(input, "action", "template");

  if (Object.keys(templates).length === 0) {
    return 0;
  }

  giveawayTemplates.save({ templates });
  return Object.keys(templates).length;
};

const bundleArray = (input: unknown) => {
  if (Array.isArray(input)) {
    return input;
  }

  if (input && typeof input === "object") {
    const body = input as Record<string, unknown>;
    if (Array.isArray(body.commands)) return body.commands;
    if (Array.isArray(body.timers)) return body.timers;
  }

  return [];
};

const bundleTemplateMap = (
  input: unknown,
  keyField: string,
  templateField: string,
) => {
  if (Array.isArray(input)) {
    return input.reduce<Record<string, unknown>>((templates, entry) => {
      const row = entry as Record<string, unknown>;
      const key = typeof row[keyField] === "string" ? row[keyField] : "";

      if (key) {
        templates[key] = row[templateField];
      }

      return templates;
    }, {});
  }

  if (input && typeof input === "object") {
    return input as Record<string, unknown>;
  }

  return {};
};

const normalizeBundleDomain = (value: unknown) => {
  const domain =
    String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/)[0] ?? "";

  return domain.replace(/:\d+$/, "").trim();
};

const safeModerationSettings = (
  settings: ReturnType<ModerationService["getSettings"]>,
) => ({
  blockedTermsEnabled: settings.blockedTermsEnabled,
  linkFilterEnabled: settings.linkFilterEnabled,
  capsFilterEnabled: settings.capsFilterEnabled,
  repeatFilterEnabled: settings.repeatFilterEnabled,
  symbolFilterEnabled: settings.symbolFilterEnabled,
  botShieldEnabled: settings.botShieldEnabled,
  blockedTermsAction: settings.blockedTermsAction,
  linkFilterAction: settings.linkFilterAction,
  capsFilterAction: settings.capsFilterAction,
  repeatFilterAction: settings.repeatFilterAction,
  symbolFilterAction: settings.symbolFilterAction,
  botShieldAction: settings.botShieldAction,
  botShieldScoreThreshold: settings.botShieldScoreThreshold,
  timeoutSeconds: settings.timeoutSeconds,
  warningMessage: settings.warningMessage,
  capsMinLength: settings.capsMinLength,
  capsRatio: settings.capsRatio,
  repeatWindowSeconds: settings.repeatWindowSeconds,
  repeatLimit: settings.repeatLimit,
  symbolMinLength: settings.symbolMinLength,
  symbolRatio: settings.symbolRatio,
  escalationEnabled: settings.escalationEnabled,
  escalationWindowSeconds: settings.escalationWindowSeconds,
  escalationDeleteAfter: settings.escalationDeleteAfter,
  escalationTimeoutAfter: settings.escalationTimeoutAfter,
  exemptBroadcaster: settings.exemptBroadcaster,
  exemptModerators: settings.exemptModerators,
  exemptVips: settings.exemptVips,
  exemptSubscribers: settings.exemptSubscribers,
});

const getFeatureGates = () => ({
  ok: true,
  featureGates: featureGates.list(),
});

const setFeatureGate = (body: { key?: FeatureKey; mode?: FeatureGateMode }) => {
  try {
    const featureGate = featureGates.setMode(body.key, body.mode, localUiActor);

    return {
      ...getFeatureGates(),
      ok: true,
      featureGate,
    };
  } catch (error) {
    return {
      ...getFeatureGates(),
      ok: false,
      error: safeErrorMessage(error, "Feature gate update failed"),
    };
  }
};

const getStreamPresets = () => {
  const gates = featureGates.list();

  return {
    ok: true,
    presets: streamPresetDefinitions.map((preset) =>
      inspectStreamPreset(preset, gates),
    ),
    featureGates: gates,
  };
};

const applyStreamPreset = (body: { id?: string; confirmed?: boolean }) => {
  try {
    const preset = streamPresetDefinitions.find((item) => item.id === body.id);

    if (!preset) {
      throw new Error("Stream preset was not found.");
    }

    if (presetRequiresConfirmation(preset) && body.confirmed !== true) {
      return {
        ...getStreamPresets(),
        ok: false,
        error: `${preset.label} requires confirmation before changing live feature gates.`,
      };
    }

    const before = featureGates.list();
    const applied = Object.entries(preset.modes).map(([key, mode]) =>
      featureGates.setMode(
        key as FeatureKey,
        mode as FeatureGateMode,
        localUiActor,
      ),
    );
    const after = featureGates.list();

    writeAuditLog(
      db,
      localUiActor,
      "stream_preset.apply",
      `stream_preset:${preset.id}`,
      {
        preset: preset.id,
        label: preset.label,
        modes: preset.modes,
        before: before.map(({ key, mode }) => ({ key, mode })),
        after: after.map(({ key, mode }) => ({ key, mode })),
      },
    );

    return {
      ...getStreamPresets(),
      ok: true,
      appliedPreset: preset.id,
      applied,
    };
  } catch (error) {
    return {
      ...getStreamPresets(),
      ok: false,
      error: safeErrorMessage(error, "Stream preset apply failed"),
    };
  }
};

const getTimers = () => {
  const timers = timersService.listTimers();
  const readiness = getTimerSendReadiness();

  return {
    ok: true,
    timers: timers.map((timer) => ({
      ...timer,
      inspection: inspectTimer(timer, readiness),
    })),
    featureGate: featureGates.get("timers"),
    readiness,
    presets: timerPresetDefinitions,
    summary: {
      total: timers.length,
      enabled: timers.filter((timer) => timer.enabled).length,
      disabled: timers.filter((timer) => !timer.enabled).length,
      sent: timers.reduce((total, timer) => total + timer.fireCount, 0),
      blocked: timers.filter((timer) => timer.lastStatus === "blocked").length,
      waitingForActivity: timers.filter((timer) => timerNeedsActivity(timer))
        .length,
      nextFireAt:
        timers
          .filter((timer) => timer.enabled && timer.nextFireAt)
          .map((timer) => timer.nextFireAt)
          .sort()[0] ?? "",
    },
  };
};

const exportTimers = () => ({
  version: 2,
  exportedAt: new Date().toISOString(),
  timers: timersService.listTimers().map((timer) => ({
    name: timer.name,
    message: timer.message,
    intervalMinutes: timer.intervalMinutes,
    minChatMessages: timer.minChatMessages,
    enabled: timer.enabled,
    fireCount: timer.fireCount,
    lastSentAt: timer.lastSentAt,
  })),
});

const importTimers = (body: unknown) => {
  try {
    const payload = body as { timers?: unknown[] };
    const entries = Array.isArray(payload.timers)
      ? payload.timers.slice(0, 50)
      : [];

    if (entries.length === 0) {
      throw new Error("Import payload must include at least one timer.");
    }

    const saved = entries.map((entry) => {
      const input = entry as Record<string, unknown>;
      const name = String(input.name ?? "")
        .trim()
        .toLowerCase();
      const existing = timersService
        .listTimers()
        .find((timer) => timer.name.toLowerCase() === name);
      return timersService.saveTimer(
        {
          ...input,
          minChatMessages: input.minChatMessages,
          id: existing?.id,
        },
        localUiActor,
      );
    });

    return {
      ...getTimers(),
      ok: true,
      imported: saved.length,
    };
  } catch (error) {
    return {
      ...getTimers(),
      ok: false,
      error: safeErrorMessage(error, "Timer import failed"),
    };
  }
};

const createTimerFromPreset = (id: string | undefined) => {
  try {
    const preset = timerPresetDefinitions.find((item) => item.id === id);

    if (!preset) {
      throw new Error("Unknown timer preset.");
    }

    const existing = timersService
      .listTimers()
      .find((timer) => timer.name.toLowerCase() === preset.name.toLowerCase());

    if (existing) {
      throw new Error(`Timer "${preset.name}" already exists.`);
    }

    const timer = timersService.saveTimer(
      {
        name: preset.name,
        message: preset.message,
        intervalMinutes: preset.intervalMinutes,
        minChatMessages: preset.minChatMessages,
        enabled: false,
      },
      localUiActor,
    );

    return {
      ...getTimers(),
      ok: true,
      timer,
    };
  } catch (error) {
    return {
      ...getTimers(),
      ok: false,
      error: safeErrorMessage(error, "Timer preset failed"),
    };
  }
};

const saveTimer = (body: unknown) => {
  try {
    const timer = timersService.saveTimer(
      body as Record<string, unknown>,
      localUiActor,
    );
    return {
      ...getTimers(),
      ok: true,
      timer,
    };
  } catch (error) {
    return {
      ...getTimers(),
      ok: false,
      error: safeErrorMessage(error, "Timer save failed"),
    };
  }
};

const setTimerEnabled = (body: { id?: number; enabled?: boolean }) => {
  try {
    const timer = timersService.setEnabled(
      parseSafeInteger(body.id, {
        field: "Timer ID",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
      Boolean(body.enabled),
      localUiActor,
    );

    return {
      ...getTimers(),
      ok: true,
      timer,
    };
  } catch (error) {
    return {
      ...getTimers(),
      ok: false,
      error: safeErrorMessage(error, "Timer update failed"),
    };
  }
};

const deleteTimer = (id: number | undefined) => {
  try {
    const timer = timersService.deleteTimer(
      parseSafeInteger(id, {
        field: "Timer ID",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
      localUiActor,
    );

    return {
      ...getTimers(),
      ok: true,
      deleted: timer,
    };
  } catch (error) {
    return {
      ...getTimers(),
      ok: false,
      error: safeErrorMessage(error, "Timer delete failed"),
    };
  }
};

const sendTimerNow = async (id: number | undefined) => {
  try {
    const timer = timersService.requireTimer(
      parseSafeInteger(id, {
        field: "Timer ID",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
    );
    const readiness = getTimerSendReadiness();

    if (!timer.enabled) {
      timersService.markBlocked(timer.id, "Timer is disabled.");
      return {
        ...getTimers(),
        ok: false,
        error: "Enable the timer before sending it.",
      };
    }

    if (!readiness.ok) {
      timersService.markBlocked(timer.id, readiness.reason);
      return {
        ...getTimers(),
        ok: false,
        error: readiness.reason,
      };
    }

    const result = await enqueueChatMessage(
      timer.message,
      timerMetadata(timer),
    );

    if (!result.ok || typeof result.outboundMessageId !== "string") {
      const error = result.error || "Timer message could not queue.";
      timersService.markBlocked(timer.id, error);
      return {
        ...getTimers(),
        ...result,
        ok: false,
        error,
      };
    }

    const sent = timersService.markQueued(timer.id, result.outboundMessageId);

    return {
      ...getTimers(),
      ok: true,
      queued: true,
      timer: sent,
      outboundMessageId: result.outboundMessageId,
    };
  } catch (error) {
    return {
      ...getTimers(),
      ok: false,
      error: safeErrorMessage(error, "Timer send failed"),
    };
  }
};

const timerPresetDefinitions = [
  {
    id: "discord",
    name: "Discord reminder",
    intervalMinutes: 15,
    minChatMessages: 5,
    message: "Join the Discord for stream updates: https://example.com",
  },
  {
    id: "socials",
    name: "Social links",
    intervalMinutes: 20,
    minChatMessages: 8,
    message: "Follow socials and find links here: https://example.com",
  },
  {
    id: "schedule",
    name: "Stream schedule",
    intervalMinutes: 30,
    minChatMessages: 5,
    message: "Stream schedule: check the channel panels for upcoming streams.",
  },
  {
    id: "commands",
    name: "Command reminder",
    intervalMinutes: 25,
    minChatMessages: 5,
    message:
      "Try !gstatus during giveaways, or ask a mod for current channel commands.",
  },
] as const;

const inspectTimer = (
  timer: ReturnType<TimersService["listTimers"]>[number],
  readiness = getTimerSendReadiness(),
) => {
  if (!timer.enabled) {
    return {
      status: "disabled",
      detail: "Timer is saved but disabled.",
      nextAction: "Enable when you want it to participate in live delivery.",
    };
  }

  if (!readiness.ok) {
    return {
      status: "blocked",
      detail: readiness.reason,
      nextAction: readiness.nextAction,
    };
  }

  if (timer.lastStatus === "blocked" && timer.lastError) {
    return {
      status: "recovering",
      detail: timer.lastError,
      nextAction: timer.nextFireAt
        ? `Will retry after ${timer.nextFireAt}.`
        : "Disable and re-enable the timer to schedule the next send.",
    };
  }

  if (!timer.nextFireAt) {
    return {
      status: "unscheduled",
      detail: "Timer is enabled but has no next fire time.",
      nextAction: "Disable and re-enable the timer to reschedule it.",
    };
  }

  const nextFireMs = Date.parse(timer.nextFireAt);
  const activity = timerActivityProgress(timer);

  if (Number.isFinite(nextFireMs) && nextFireMs <= Date.now()) {
    if (timerNeedsActivity(timer)) {
      const remaining = Math.max(
        0,
        timer.minChatMessages - timer.chatMessagesSinceLastFire,
      );
      return {
        status: "waiting_activity",
        detail: `Interval elapsed; waiting for ${remaining} more chat message${remaining === 1 ? "" : "s"} (${activity}).`,
        nextAction:
          "Let chat activity build or use Send now for an explicit operator send.",
      };
    }

    return {
      status: "due",
      detail:
        "Timer is due and will send on the next scheduler tick if the bot remains live-ready.",
      nextAction: "Wait for the scheduler tick or use Send now.",
    };
  }

  return {
    status: "scheduled",
    detail: timer.nextFireAt
      ? `Next send is scheduled for ${timer.nextFireAt}.`
      : "Timer is waiting for its next schedule.",
    nextAction:
      timer.minChatMessages > 0
        ? `Needs ${activity} chat activity before the next automatic send.`
        : "No action needed.",
  };
};

const timerNeedsActivity = (
  timer: ReturnType<TimersService["listTimers"]>[number],
) =>
  timer.enabled &&
  timer.minChatMessages > 0 &&
  timer.chatMessagesSinceLastFire < timer.minChatMessages &&
  Boolean(timer.nextFireAt) &&
  Date.parse(timer.nextFireAt) <= Date.now();

const timerActivityProgress = (
  timer: ReturnType<TimersService["listTimers"]>[number],
) =>
  timer.minChatMessages > 0
    ? `${Math.min(timer.chatMessagesSinceLastFire, timer.minChatMessages)}/${timer.minChatMessages}`
    : "off";

const getModerationState = () => ({
  ...moderationService.getState(),
  enforcement: getModerationEnforcementStatus(),
});

const getModerationEnforcementStatus = () => {
  const twitch = readLocalSecrets().twitch;
  const hasScope = (scope: string) => (twitch.scopes ?? []).includes(scope);
  const deleteScope = optionalModerationScopes[0];
  const timeoutScope = optionalModerationScopes[1];
  const identityReady = Boolean(
    twitch.accessToken &&
    twitch.clientId &&
    twitch.broadcasterUserId &&
    twitch.botUserId,
  );
  const deleteReady = identityReady && hasScope(deleteScope);
  const timeoutReady = identityReady && hasScope(timeoutScope);
  const missingScopes = optionalModerationScopes.filter(
    (scope) => !hasScope(scope),
  );

  return {
    ok: true,
    mode: featureGates.get("moderation_filters").mode,
    deleteMessages: {
      available: deleteReady,
      scope: deleteScope,
      reason: deleteReady
        ? "Message deletion is available for live moderation hits."
        : identityReady
          ? `Reconnect Twitch with ${deleteScope} to enable message deletion.`
          : "Complete Twitch setup and validation before message deletion can run.",
    },
    timeoutUsers: {
      available: timeoutReady,
      scope: timeoutScope,
      reason: timeoutReady
        ? "Timeouts are available for live moderation hits."
        : identityReady
          ? `Reconnect Twitch with ${timeoutScope} to enable timeouts.`
          : "Complete Twitch setup and validation before timeouts can run.",
    },
    missingScopes,
    nextAction: missingScopes.length
      ? `Reconnect Twitch to grant optional moderation scope(s): ${missingScopes.join(", ")}.`
      : "Choose delete or timeout actions per filter, test locally, then enable moderation live.",
  };
};

const saveModerationSettings = (body: unknown) => {
  try {
    return moderationService.saveSettings(body, localUiActor);
  } catch (error) {
    return {
      ...getModerationState(),
      ok: false,
      error: safeErrorMessage(error, "Moderation settings save failed"),
    };
  }
};

const saveModerationTerm = (body: unknown) => {
  try {
    return moderationService.saveTerm(body, localUiActor);
  } catch (error) {
    return {
      ...getModerationState(),
      ok: false,
      error: safeErrorMessage(error, "Blocked phrase save failed"),
    };
  }
};

const setModerationTermEnabled = (body: { id?: number; enabled?: boolean }) => {
  try {
    return moderationService.setTermEnabled(
      parseSafeInteger(body.id, {
        field: "Blocked phrase ID",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
      Boolean(body.enabled),
      localUiActor,
    );
  } catch (error) {
    return {
      ...getModerationState(),
      ok: false,
      error: safeErrorMessage(error, "Blocked phrase update failed"),
    };
  }
};

const deleteModerationTerm = (id: number | undefined) => {
  try {
    return moderationService.deleteTerm(
      parseSafeInteger(id, {
        field: "Blocked phrase ID",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
      localUiActor,
    );
  } catch (error) {
    return {
      ...getModerationState(),
      ok: false,
      error: safeErrorMessage(error, "Blocked phrase delete failed"),
    };
  }
};

const saveModerationAllowedLink = (body: unknown) => {
  try {
    return moderationService.saveAllowedLink(body, localUiActor);
  } catch (error) {
    return {
      ...getModerationState(),
      ok: false,
      error: safeErrorMessage(error, "Allowed domain save failed"),
    };
  }
};

const setModerationAllowedLinkEnabled = (body: {
  id?: number;
  enabled?: boolean;
}) => {
  try {
    return moderationService.setAllowedLinkEnabled(
      parseSafeInteger(body.id, {
        field: "Allowed domain ID",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
      Boolean(body.enabled),
      localUiActor,
    );
  } catch (error) {
    return {
      ...getModerationState(),
      ok: false,
      error: safeErrorMessage(error, "Allowed domain update failed"),
    };
  }
};

const deleteModerationAllowedLink = (id: number | undefined) => {
  try {
    return moderationService.deleteAllowedLink(
      parseSafeInteger(id, {
        field: "Allowed domain ID",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
      localUiActor,
    );
  } catch (error) {
    return {
      ...getModerationState(),
      ok: false,
      error: safeErrorMessage(error, "Allowed domain delete failed"),
    };
  }
};

const saveModerationBlockedLink = (body: unknown) => {
  try {
    return moderationService.saveBlockedLink(body, localUiActor);
  } catch (error) {
    return {
      ...getModerationState(),
      ok: false,
      error: safeErrorMessage(error, "Blocked domain save failed"),
    };
  }
};

const setModerationBlockedLinkEnabled = (body: {
  id?: number;
  enabled?: boolean;
}) => {
  try {
    return moderationService.setBlockedLinkEnabled(
      parseSafeInteger(body.id, {
        field: "Blocked domain ID",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
      Boolean(body.enabled),
      localUiActor,
    );
  } catch (error) {
    return {
      ...getModerationState(),
      ok: false,
      error: safeErrorMessage(error, "Blocked domain update failed"),
    };
  }
};

const deleteModerationBlockedLink = (id: number | undefined) => {
  try {
    return moderationService.deleteBlockedLink(
      parseSafeInteger(id, {
        field: "Blocked domain ID",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
      localUiActor,
    );
  } catch (error) {
    return {
      ...getModerationState(),
      ok: false,
      error: safeErrorMessage(error, "Blocked domain delete failed"),
    };
  }
};

const grantModerationLinkPermit = (body: unknown) => {
  try {
    return moderationService.grantLinkPermit(body, localUiActor);
  } catch (error) {
    return {
      ...getModerationState(),
      ok: false,
      error: safeErrorMessage(error, "Link permit grant failed"),
    };
  }
};

const simulateModeration = (body: {
  actor?: string;
  role?: LocalChatRole;
  text?: string;
}) => {
  try {
    const actor = createLocalChatMessage({
      login: body.actor || "viewer",
      role: body.role ?? "viewer",
      text: body.text || "",
    });
    const result = moderationService.evaluate(actor, { consumePermits: false });
    const enforcement = getModerationEnforcementStatus();
    const enforcementPlan = result.hit
      ? moderationService.planEnforcement(actor, result.hit, {
          canDeleteMessages: enforcement.deleteMessages.available,
          canTimeoutUsers: enforcement.timeoutUsers.available,
          deleteUnavailableReason: enforcement.deleteMessages.reason,
          timeoutUnavailableReason: enforcement.timeoutUsers.reason,
        })
      : undefined;

    return {
      ...getModerationState(),
      ok: true,
      result,
      enforcementPlan,
    };
  } catch (error) {
    return {
      ...getModerationState(),
      ok: false,
      error: safeErrorMessage(error, "Moderation simulation failed"),
    };
  }
};

const getTimerSendReadiness = () => {
  const gate = featureGates.get("timers");
  const queue = chatQueue.snapshot();
  const queueHealth = summarizeQueueHealth(queue, outboundHistory.summary());
  const checks = [
    {
      name: "Feature gate",
      ok: gate.mode === "live",
      detail:
        gate.mode === "live"
          ? "Timers are live."
          : gate.mode === "test"
            ? "Timers are in test mode and will not send to Twitch chat."
            : "Timers are off.",
    },
    {
      name: "Live bot",
      ok: Boolean(botProcess.child && getBotProcessSnapshot().running),
      detail:
        botProcess.child && getBotProcessSnapshot().running
          ? "Live bot is running."
          : "Start the live bot before timers can send.",
    },
    {
      name: "EventSub chat",
      ok: botProcess.eventSubConnected && botProcess.chatSubscriptionActive,
      detail:
        botProcess.eventSubConnected && botProcess.chatSubscriptionActive
          ? "EventSub chat is connected."
          : "Timers wait for EventSub chat to be connected.",
    },
    {
      name: "Live chat confirmation",
      ok: botProcess.liveChatConfirmed,
      detail: botProcess.liveChatConfirmed
        ? "Live chat was confirmed with !ping."
        : "Timers wait for live chat confirmation. Type !ping in chat.",
    },
    {
      name: "Outbound queue",
      ok: queueHealth.status === "clear",
      detail:
        queueHealth.status === "clear"
          ? "Outbound queue is clear."
          : queueHealth.nextAction,
    },
  ];

  if (gate.mode !== "live") {
    return {
      ok: false,
      reason:
        gate.mode === "test"
          ? "Timers are in test mode and will not send to Twitch chat."
          : "Timers are off. Move the Timers feature gate to Live before sending.",
      nextAction:
        gate.mode === "test"
          ? "Move Timers to Live when you are ready for Twitch delivery."
          : "Use the Timers feature gate card to switch to Live.",
      gateMode: gate.mode,
      checks,
    };
  }

  if (!botProcess.child || !getBotProcessSnapshot().running) {
    return {
      ok: false,
      reason: "Start the live bot before timers can send.",
      nextAction: "Start Bot from the setup console.",
      gateMode: gate.mode,
      checks,
    };
  }

  if (!botProcess.eventSubConnected || !botProcess.chatSubscriptionActive) {
    return {
      ok: false,
      reason: "Timers wait for EventSub chat to be connected.",
      nextAction:
        "Wait for EventSub chat subscription to connect or restart the bot.",
      gateMode: gate.mode,
      checks,
    };
  }

  if (!botProcess.liveChatConfirmed) {
    return {
      ok: false,
      reason: "Timers wait for live chat confirmation. Type !ping in chat.",
      nextAction: "Type !ping in Twitch chat and wait for pong.",
      gateMode: gate.mode,
      checks,
    };
  }

  if (queueHealth.status !== "clear") {
    return {
      ok: false,
      reason: queueHealth.nextAction,
      nextAction: queueHealth.nextAction,
      gateMode: gate.mode,
      checks,
    };
  }

  return {
    ok: true,
    reason: "Timers can queue.",
    nextAction: "No action needed.",
    gateMode: gate.mode,
    checks,
  };
};

const getCustomCommands = () => {
  const commands = customCommandsService.listCommands();
  const invocations = customCommandsService.getRecentInvocations(50);

  return {
    ok: true,
    commands,
    invocations,
    reservedNames: getCustomCommandReservedNames(),
    presets: customCommandPresetDefinitions.map((preset) =>
      inspectCustomCommandPreset(
        preset,
        commands,
        getCustomCommandReservedNames(),
      ),
    ),
    presetPacks: customCommandPresetPackDefinitions.map((pack) =>
      inspectCustomCommandPresetPack(
        pack,
        commands,
        getCustomCommandReservedNames(),
      ),
    ),
    featureGate: featureGates.get("custom_commands"),
    summary: {
      total: commands.length,
      enabled: commands.filter((command) => command.enabled).length,
      disabled: commands.filter((command) => !command.enabled).length,
      aliases: commands.reduce(
        (total, command) => total + command.aliases.length,
        0,
      ),
      uses: commands.reduce((total, command) => total + command.useCount, 0),
    },
  };
};

const saveCustomCommand = (body: unknown) => {
  try {
    const command = customCommandsService.saveCommand(
      body as Record<string, unknown>,
      localUiActor,
      {
        reservedNames: getCustomCommandReservedNames(),
      },
    );
    return {
      ...getCustomCommands(),
      ok: true,
      command,
    };
  } catch (error) {
    return {
      ...getCustomCommands(),
      ok: false,
      error: safeErrorMessage(error, "Custom command save failed"),
    };
  }
};

const setCustomCommandEnabled = (body: { id?: number; enabled?: boolean }) => {
  try {
    const command = customCommandsService.setEnabled(
      parseSafeInteger(body.id, {
        field: "Command ID",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
      Boolean(body.enabled),
      localUiActor,
    );
    return {
      ...getCustomCommands(),
      ok: true,
      command,
    };
  } catch (error) {
    return {
      ...getCustomCommands(),
      ok: false,
      error: safeErrorMessage(error, "Custom command update failed"),
    };
  }
};

const duplicateCustomCommand = (id: number | undefined) => {
  try {
    const command = customCommandsService.duplicateCommand(
      parseSafeInteger(id, {
        field: "Command ID",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
      localUiActor,
    );
    return {
      ...getCustomCommands(),
      ok: true,
      command,
    };
  } catch (error) {
    return {
      ...getCustomCommands(),
      ok: false,
      error: safeErrorMessage(error, "Custom command duplicate failed"),
    };
  }
};

const deleteCustomCommand = (id: number | undefined) => {
  try {
    const deleted = customCommandsService.deleteCommand(
      parseSafeInteger(id, {
        field: "Command ID",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
      localUiActor,
    );
    return {
      ...getCustomCommands(),
      ok: true,
      deleted,
    };
  } catch (error) {
    return {
      ...getCustomCommands(),
      ok: false,
      error: safeErrorMessage(error, "Custom command delete failed"),
    };
  }
};

const createCustomCommandFromPreset = (id: string | undefined) => {
  try {
    const preset = customCommandPresetDefinitions.find(
      (item) => item.id === id,
    );

    if (!preset) {
      throw new Error("Command preset was not found.");
    }

    const command = customCommandsService.saveCommand(
      {
        name: preset.commandName,
        permission: preset.permission,
        enabled: false,
        globalCooldownSeconds: preset.globalCooldownSeconds,
        userCooldownSeconds: preset.userCooldownSeconds,
        aliases: preset.aliases,
        responses: preset.responses,
      },
      localUiActor,
      { reservedNames: getCustomCommandReservedNames() },
    );

    return {
      ...getCustomCommands(),
      ok: true,
      command,
    };
  } catch (error) {
    return {
      ...getCustomCommands(),
      ok: false,
      error: safeErrorMessage(error, "Command preset create failed"),
    };
  }
};

const createCustomCommandPresetPack = (id: string | undefined) => {
  try {
    const pack = customCommandPresetPackDefinitions.find(
      (item) => item.id === id,
    );

    if (!pack) {
      throw new Error("Command preset pack was not found.");
    }

    const beforeCommands = customCommandsService.listCommands();
    const reservedNames = getCustomCommandReservedNames();
    const inspected = pack.presetIds
      .map((presetId) =>
        customCommandPresetDefinitions.find((preset) => preset.id === presetId),
      )
      .filter(
        (preset): preset is (typeof customCommandPresetDefinitions)[number] =>
          Boolean(preset),
      )
      .map((preset) =>
        inspectCustomCommandPreset(preset, beforeCommands, reservedNames),
      );
    const ready = inspected.filter(
      (preset) => preset.inspection.status === "ready",
    );

    if (!ready.length) {
      throw new Error("No preset commands in this pack are ready to create.");
    }

    const created = ready.map((preset) =>
      customCommandsService.saveCommand(
        {
          name: preset.commandName,
          permission: preset.permission,
          enabled: false,
          globalCooldownSeconds: preset.globalCooldownSeconds,
          userCooldownSeconds: preset.userCooldownSeconds,
          aliases: preset.aliases,
          responses: preset.responses,
        },
        localUiActor,
        { reservedNames },
      ),
    );
    const skipped = inspected
      .filter((preset) => preset.inspection.status !== "ready")
      .map((preset) => ({
        id: preset.id,
        commandName: preset.commandName,
        reason: preset.inspection.detail,
      }));

    writeAuditLog(
      db,
      localUiActor,
      "custom_command.preset_pack_create",
      `custom_command_pack:${pack.id}`,
      {
        packId: pack.id,
        label: pack.label,
        created: created.map((command) => command.name),
        skipped,
      },
    );

    return {
      ...getCustomCommands(),
      ok: true,
      pack,
      created,
      skipped,
    };
  } catch (error) {
    return {
      ...getCustomCommands(),
      ok: false,
      error: safeErrorMessage(error, "Command preset pack create failed"),
    };
  }
};

const importCustomCommands = (body: unknown) => {
  try {
    const commands = customCommandsService.importCommands(body, localUiActor, {
      reservedNames: getCustomCommandReservedNames(),
    });
    return {
      ...getCustomCommands(),
      ok: true,
      imported: commands.length,
    };
  } catch (error) {
    return {
      ...getCustomCommands(),
      ok: false,
      error: safeErrorMessage(error, "Custom command import failed"),
    };
  }
};

const previewCustomCommand = (body: unknown) => {
  try {
    const input = body as {
      commandId?: number;
      responseText?: unknown;
      actor?: string;
      role?: "viewer" | "mod" | "broadcaster";
      rawArgs?: unknown;
    };
    const actor = createLocalChatMessage({
      login: input.actor || "viewer",
      role: input.role ?? "viewer",
      text: "!preview",
    });
    return {
      ok: true,
      response: customCommandsService.preview({
        commandId: input.commandId,
        responseText: input.responseText,
        actor,
        rawArgs: input.rawArgs,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error: safeErrorMessage(error, "Custom command preview failed"),
    };
  }
};

const getCustomCommandReservedNames = () => {
  const names = new Set(getReservedCustomCommandNames());
  const active = giveawaysService.status()?.giveaway.keyword;

  if (active) {
    names.add(normalizeCommandName(active));
  }

  return [...names].sort();
};

const customCommandPresetDefinitions = [
  {
    id: "discord",
    label: "Discord",
    category: "Community",
    description: "Community Discord link.",
    commandName: "discord",
    permission: "viewer",
    globalCooldownSeconds: 30,
    userCooldownSeconds: 10,
    aliases: ["dc"],
    responses: ["Join the Discord: https://example.com"],
  },
  {
    id: "socials",
    label: "Social Links",
    category: "Community",
    description: "Primary social and link hub.",
    commandName: "socials",
    permission: "viewer",
    globalCooldownSeconds: 30,
    userCooldownSeconds: 10,
    aliases: ["links"],
    responses: ["Find links and socials here: https://example.com"],
  },
  {
    id: "schedule",
    label: "Schedule",
    category: "Channel Info",
    description: "Streaming schedule reminder.",
    commandName: "schedule",
    permission: "viewer",
    globalCooldownSeconds: 30,
    userCooldownSeconds: 10,
    aliases: ["when"],
    responses: [
      "Stream schedule: check the channel panels for upcoming streams.",
    ],
  },
  {
    id: "commands",
    label: "Command List",
    category: "Channel Info",
    description: "Simple list of common viewer commands.",
    commandName: "commands",
    permission: "viewer",
    globalCooldownSeconds: 20,
    userCooldownSeconds: 20,
    aliases: ["cmds"],
    responses: [
      "Common commands: !discord, !socials, !schedule, !lurk, !rules",
    ],
  },
  {
    id: "lurk",
    label: "Lurk",
    category: "Community",
    description: "Viewer lurk acknowledgement.",
    commandName: "lurk",
    permission: "viewer",
    globalCooldownSeconds: 10,
    userCooldownSeconds: 30,
    aliases: [],
    responses: ["{user} is lurking. Thanks for hanging out."],
  },
  {
    id: "unlurk",
    label: "Unlurk",
    category: "Community",
    description: "Viewer return acknowledgement.",
    commandName: "unlurk",
    permission: "viewer",
    globalCooldownSeconds: 10,
    userCooldownSeconds: 30,
    aliases: ["back"],
    responses: ["Welcome back, {user}."],
  },
  {
    id: "shoutout",
    label: "Shoutout",
    category: "Moderator",
    description: "Moderator shoutout helper.",
    commandName: "so",
    permission: "moderator",
    globalCooldownSeconds: 10,
    userCooldownSeconds: 5,
    aliases: ["shoutout"],
    responses: ["Go check out {target}: https://twitch.tv/{target}"],
  },
  {
    id: "rules",
    label: "Rules",
    category: "Safety",
    description: "Short chat rules reminder.",
    commandName: "rules",
    permission: "viewer",
    globalCooldownSeconds: 30,
    userCooldownSeconds: 10,
    aliases: [],
    responses: ["Keep chat respectful, avoid spoilers, and listen to mods."],
  },
  {
    id: "youtube",
    label: "YouTube",
    category: "Community",
    description: "YouTube or VOD link.",
    commandName: "youtube",
    permission: "viewer",
    globalCooldownSeconds: 30,
    userCooldownSeconds: 10,
    aliases: ["yt"],
    responses: ["YouTube and VODs: https://example.com"],
  },
  {
    id: "tip",
    label: "Tip Link",
    category: "Support",
    description: "Optional support or tip link.",
    commandName: "tip",
    permission: "viewer",
    globalCooldownSeconds: 60,
    userCooldownSeconds: 30,
    aliases: ["donate"],
    responses: [
      "Support is never required, but you can find the tip link here: https://example.com",
    ],
  },
  {
    id: "merch",
    label: "Merch",
    category: "Support",
    description: "Merch store link.",
    commandName: "merch",
    permission: "viewer",
    globalCooldownSeconds: 60,
    userCooldownSeconds: 30,
    aliases: ["store"],
    responses: ["Merch/store link: https://example.com"],
  },
  {
    id: "specs",
    label: "Setup Specs",
    category: "Channel Info",
    description: "Streaming setup or gear note.",
    commandName: "specs",
    permission: "viewer",
    globalCooldownSeconds: 30,
    userCooldownSeconds: 15,
    aliases: ["setup"],
    responses: [
      "Stream setup/specs: update this command with your current gear list.",
    ],
  },
  {
    id: "giveaway",
    label: "Giveaway Status",
    category: "Giveaway",
    description: "Points viewers to giveaway status.",
    commandName: "giveaway",
    permission: "viewer",
    globalCooldownSeconds: 15,
    userCooldownSeconds: 10,
    aliases: ["raffle"],
    responses: ["Giveaway status: use !gstatus when a giveaway is active."],
  },
] as const;

const customCommandPresetPackDefinitions = [
  {
    id: "core-utilities",
    label: "Core Utility Pack",
    description:
      "Discord, socials, schedule, command list, lurk/unlurk, rules, and shoutout.",
    presetIds: [
      "discord",
      "socials",
      "schedule",
      "commands",
      "lurk",
      "unlurk",
      "rules",
      "shoutout",
    ],
  },
  {
    id: "support-links",
    label: "Support Links Pack",
    description: "YouTube, tips, merch, and setup/specs placeholders.",
    presetIds: ["youtube", "tip", "merch", "specs"],
  },
] as const;

const inspectCustomCommandPreset = (
  preset: (typeof customCommandPresetDefinitions)[number],
  commands: ReturnType<CustomCommandsService["listCommands"]>,
  reservedNames: string[],
) => {
  const reserved = new Set(reservedNames);
  const commandNames = new Set(commands.map((command) => command.name));
  const aliases = new Set(commands.flatMap((command) => command.aliases));
  const conflicts = [
    reserved.has(preset.commandName)
      ? `!${preset.commandName} is reserved`
      : undefined,
    commandNames.has(preset.commandName)
      ? `!${preset.commandName} already exists`
      : undefined,
    aliases.has(preset.commandName)
      ? `!${preset.commandName} is already an alias`
      : undefined,
    ...preset.aliases.flatMap((alias) => [
      reserved.has(alias) ? `!${alias} is reserved` : undefined,
      commandNames.has(alias) ? `!${alias} already exists` : undefined,
      aliases.has(alias) ? `!${alias} is already an alias` : undefined,
    ]),
  ].filter(Boolean);

  return {
    ...preset,
    inspection: {
      status: conflicts.length ? "blocked" : "ready",
      detail: conflicts.join("; ") || "Ready to create disabled.",
      nextAction: conflicts.length
        ? "Resolve the command or alias conflict first."
        : "Create, edit links/copy, then enable when tested.",
    },
  };
};

const inspectCustomCommandPresetPack = (
  pack: (typeof customCommandPresetPackDefinitions)[number],
  commands: ReturnType<CustomCommandsService["listCommands"]>,
  reservedNames: string[],
) => {
  const presets = pack.presetIds
    .map((presetId) =>
      customCommandPresetDefinitions.find((preset) => preset.id === presetId),
    )
    .filter(
      (preset): preset is (typeof customCommandPresetDefinitions)[number] =>
        Boolean(preset),
    )
    .map((preset) =>
      inspectCustomCommandPreset(preset, commands, reservedNames),
    );
  const ready = presets.filter(
    (preset) => preset.inspection.status === "ready",
  );
  const blocked = presets.filter(
    (preset) => preset.inspection.status !== "ready",
  );

  return {
    ...pack,
    commandCount: presets.length,
    readyCount: ready.length,
    blockedCount: blocked.length,
    commands: presets.map((preset) => ({
      id: preset.id,
      commandName: preset.commandName,
      label: preset.label,
      status: preset.inspection.status,
    })),
    inspection: {
      status:
        ready.length === 0 ? "blocked" : blocked.length ? "partial" : "ready",
      detail: blocked.length
        ? `${ready.length} ready, ${blocked.length} already present or blocked.`
        : `${ready.length} commands ready to create disabled.`,
      nextAction: ready.length
        ? "Create ready commands disabled, edit placeholder links/copy, then enable after local tests."
        : "Resolve command or alias conflicts before creating this pack.",
    },
  };
};

const streamPresetDefinitions = [
  {
    id: "giveaway-night",
    label: "Giveaway Night",
    description:
      "Keep giveaways and custom commands live while optional timers and moderation stay off.",
    modes: {
      custom_commands: "live",
      timers: "off",
      moderation_filters: "off",
    },
  },
  {
    id: "local-bot-rehearsal",
    label: "Local Bot Rehearsal",
    description:
      "Keep custom commands live and move timers/moderation into local test mode.",
    modes: {
      custom_commands: "live",
      timers: "test",
      moderation_filters: "test",
    },
  },
  {
    id: "timers-live",
    label: "Timers Live",
    description:
      "Use custom commands and timers in live chat while moderation remains local-test only.",
    modes: {
      custom_commands: "live",
      timers: "live",
      moderation_filters: "test",
    },
  },
  {
    id: "bot-replacement",
    label: "Bot Replacement",
    description:
      "Enable custom commands, timers, and scoped moderation for live Twitch chat.",
    modes: {
      custom_commands: "live",
      timers: "live",
      moderation_filters: "live",
    },
  },
] as const satisfies Array<{
  id: string;
  label: string;
  description: string;
  modes: Record<FeatureKey, FeatureGateMode>;
}>;

const inspectStreamPreset = (
  preset: (typeof streamPresetDefinitions)[number],
  gates: FeatureGateState[],
) => {
  const gateModes = new Map(gates.map((gate) => [gate.key, gate.mode]));
  const changes = Object.entries(preset.modes)
    .filter(([key, mode]) => gateModes.get(key as FeatureKey) !== mode)
    .map(([key, mode]) => ({
      key,
      from: gateModes.get(key as FeatureKey) || "off",
      to: mode,
    }));

  return {
    ...preset,
    requiresConfirmation: presetRequiresConfirmation(preset),
    inspection: {
      status: changes.length ? "changes" : "current",
      detail: changes.length
        ? changes
            .map((change) => `${change.key}: ${change.from} -> ${change.to}`)
            .join("; ")
        : "Preset is already active.",
      nextAction: changes.length
        ? "Apply explicitly, then run preflight and local tests before relying on live chat behavior."
        : "No feature gate changes needed.",
    },
  };
};

const presetRequiresConfirmation = (
  preset: (typeof streamPresetDefinitions)[number],
) => {
  const modes: Record<FeatureKey, FeatureGateMode> = preset.modes;
  return modes.timers === "live" || modes.moderation_filters === "live";
};

const getOutboundMessages = () => ({
  ok: true,
  summary: outboundHistory.summary(),
  messages: outboundHistory.list(),
});

const resendOutboundMessage = async (id: string | undefined) => {
  const record = outboundHistory.find(id) ?? outboundHistory.latestFailed();

  if (!record) {
    const outbound = getOutboundMessages();
    return {
      ...outbound,
      ok: false,
      error: "No failed outbound message is available to resend.",
    };
  }

  const result = await enqueueChatMessage(record.message, {
    category: record.category,
    action: record.action,
    importance: record.importance,
    giveawayId: record.giveawayId,
    resentFrom: record.id,
  });

  if (result.ok && typeof result.outboundMessageId === "string") {
    outboundHistory.markResent(record.id, result.outboundMessageId);
  }

  const outbound = getOutboundMessages();

  return {
    ...outbound,
    ...result,
    resentFrom: record.id,
  };
};

const resendGiveawayAnnouncement = async (action: string | undefined) => {
  const phase = getGiveawayAnnouncementPhase(action);

  if (!phase) {
    return {
      ...getGiveawayState(),
      ok: false,
      error: "Unknown giveaway announcement phase.",
    };
  }

  const state = giveawaysService.getLatestGiveawayState();

  if (!state.giveaway) {
    return {
      ...getGiveawayState(),
      ok: false,
      error: "No giveaway is available for announcement resend.",
    };
  }

  const existing = latestOutboundForActions(state.giveaway.id, phase.actions);
  const announcement = existing
    ? {
        message: existing.message,
        metadata: {
          category: "giveaway" as const,
          action: existing.action || phase.actions[0],
          importance: existing.importance,
          giveawayId: state.giveaway.id,
          resentFrom: existing.id,
        },
        resentFrom: existing.id,
      }
    : buildGiveawayAnnouncementForPhase(phase, state);

  if (!announcement) {
    return {
      ...getGiveawayState(),
      ok: false,
      error: `Cannot reconstruct the ${phase.label} announcement from current giveaway state.`,
    };
  }

  const result = await enqueueChatMessage(
    announcement.message,
    announcement.metadata,
  );
  const resentFrom =
    "resentFrom" in announcement ? announcement.resentFrom : undefined;

  if (result.ok && resentFrom && typeof result.outboundMessageId === "string") {
    outboundHistory.markResent(resentFrom, result.outboundMessageId);
  }

  return {
    ...getGiveawayState(),
    ...result,
    action: phase.actions[0],
    resentFrom,
  };
};

const resendCriticalGiveawayMessage = async () => {
  const record = latestFailedCriticalGiveawayMessage();

  if (!record) {
    return {
      ...getGiveawayState(),
      ok: false,
      error:
        "No failed critical giveaway message is available for panic resend.",
    };
  }

  const result = await resendOutboundMessage(record.id);

  return {
    ...getGiveawayState(),
    ...result,
    resentAction: record.action,
    resentFrom: record.id,
  };
};

const latestFailedCriticalGiveawayMessage = () => {
  const state = giveawaysService.getLatestGiveawayState();
  const currentGiveawayId = state.giveaway?.id;
  const failedCritical = outboundHistory
    .list()
    .filter(
      (message) =>
        message.category === "giveaway" &&
        message.importance === "critical" &&
        message.status === "failed",
    );

  if (currentGiveawayId !== undefined) {
    const currentFailure = failedCritical.find(
      (message) => Number(message.giveawayId) === Number(currentGiveawayId),
    );

    if (currentFailure) {
      return currentFailure;
    }
  }

  return failedCritical[0];
};

const sendCurrentGiveawayStatus = async () => {
  const state = giveawaysService.getLatestGiveawayState();
  const message = buildGiveawayStatusMessage(state);

  if (!state.giveaway || !message) {
    return {
      ...getGiveawayState(),
      ok: false,
      error: "No giveaway is available for a status message.",
    };
  }

  const result = await enqueueChatMessage(message, {
    category: "giveaway",
    action: "status",
    importance: "normal",
    giveawayId: state.giveaway.id,
  });

  return {
    ...getGiveawayState(),
    ...result,
    message,
  };
};

const sendConfiguredChatMessage = async (message: string) => {
  const secrets = readLocalSecrets();
  const twitch = secrets.twitch;
  const relay = secrets.relay;

  if (relay.twitchTransportMode === "relay-chatbot") {
    return new RelayChatClient({
      baseUrl: relay.baseUrl,
      installationId: relay.installationId,
      consoleToken: relay.consoleToken,
    }).send(message);
  }

  if (
    !twitch.clientId ||
    !twitch.accessToken ||
    !twitch.broadcasterUserId ||
    !twitch.botUserId
  ) {
    return {
      status: "failed" as const,
      failureCategory: "config" as const,
      reason: "Setup is missing resolved Twitch IDs.",
    };
  }

  const result = await createSetupChatSender(twitch).send(message);
  const structured = typeof result === "string" ? { status: result } : result;

  if (structured.status !== "failed" || structured.failureCategory !== "auth") {
    return result;
  }

  try {
    const refreshed = await refreshStoredTwitchToken({
      secrets,
      expectedClientId: twitch.clientId,
      expectedBotUserId: twitch.botUserId,
      expectedBotLogin: twitch.botLogin,
      logger,
    });

    logger.warn(
      { failureCategory: structured.failureCategory },
      "Outbound chat auth failed; token refreshed and message will be retried once",
    );

    return createSetupChatSender(refreshed.twitch).send(message);
  } catch (error) {
    return {
      status: "failed" as const,
      failureCategory: "auth" as const,
      reason: safeErrorMessage(
        error,
        "Twitch token refresh failed. Reconnect Twitch.",
      ),
    };
  }
};

const createSetupChatSender = (twitch: LocalSecrets["twitch"]) => {
  if (
    !twitch.clientId ||
    !twitch.accessToken ||
    !twitch.broadcasterUserId ||
    !twitch.botUserId
  ) {
    throw new Error("Setup is missing resolved Twitch IDs.");
  }

  return new TwitchChatSender({
    clientId: twitch.clientId,
    accessToken: twitch.accessToken,
    broadcasterId: twitch.broadcasterUserId,
    senderId: twitch.botUserId,
    logger,
  });
};

const getGiveawayTemplates = () => ({
  ok: true,
  templates: giveawayTemplates.list(),
  placeholders: [
    "title",
    "keyword",
    "winnerCount",
    "entryCount",
    "displayName",
    "winners",
    "winnerPlural",
    "drawnCount",
    "requestedCount",
    "partial",
    "rerolled",
    "replacement",
  ],
});

const saveGiveawayTemplates = (body: unknown) => ({
  ...getGiveawayTemplates(),
  templates: giveawayTemplates.save(body),
});

const resetGiveawayTemplates = (actions: unknown) => ({
  ...getGiveawayTemplates(),
  templates: giveawayTemplates.reset(actions),
});

type GiveawayAnnouncementPhase = {
  id: string;
  label: string;
  actions: [string, ...string[]];
  importance: NonNullable<MessageQueueMetadata["importance"]>;
  requiredWhen: (
    state: ReturnType<GiveawaysService["getLatestGiveawayState"]>,
  ) => boolean;
};

const giveawayAnnouncementPhases: GiveawayAnnouncementPhase[] = [
  {
    id: "start",
    label: "Start",
    actions: ["start"],
    importance: "critical",
    requiredWhen: (state) => Boolean(state.giveaway),
  },
  {
    id: "reminder",
    label: "Reminder / Last call",
    actions: ["reminder", "last-call"],
    importance: "important",
    requiredWhen: () => false,
  },
  {
    id: "close",
    label: "Close",
    actions: ["close"],
    importance: "critical",
    requiredWhen: (state) =>
      state.giveaway?.status === "closed" || state.giveaway?.status === "ended",
  },
  {
    id: "draw",
    label: "Draw",
    actions: ["draw"],
    importance: "critical",
    requiredWhen: (state) => state.counts.activeWinners > 0,
  },
  {
    id: "end",
    label: "End",
    actions: ["end"],
    importance: "critical",
    requiredWhen: (state) => state.giveaway?.status === "ended",
  },
];

const getGiveawayAnnouncementPhase = (action: string | undefined) => {
  if (!action) {
    return undefined;
  }

  return giveawayAnnouncementPhases.find(
    (phase) => phase.id === action || phase.actions.includes(action),
  );
};

const getGiveawayState = () => {
  const state = giveawaysService.getOperatorState();
  const latest = giveawaysService.getLatestGiveawayState();
  const assurance = summarizeGiveawayAssurance(latest);
  return {
    ok: true,
    ...state,
    summary: summarizeGiveawayState(state),
    recap: summarizeGiveawayRecap(latest, assurance),
    assurance,
  };
};

const getGiveawayOverlayState = () => {
  const state = getGiveawayState();
  const activeWinners = (state.winners || []).filter(
    (winner) => !winner.rerolled_at,
  );
  const latestWinner = activeWinners[activeWinners.length - 1];
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    summary: state.summary,
    giveaway: state.giveaway
      ? {
          id: state.giveaway.id,
          title: state.giveaway.title,
          keyword: state.giveaway.keyword,
          status: state.giveaway.status,
        }
      : undefined,
    entrantCount: state.summary.entryCount,
    rules: state.summary.rules,
    marketplace: {
      name: state.summary.config.marketplaceName,
      note: "Key purchased after winner confirms platform/region.",
      disclosure: "Not sponsored. No affiliate link.",
    },
    platformNote: state.summary.config.regionAvailabilityDisclaimer,
    timer: state.summary.timer,
    responseTimer: state.summary.responseTimer,
    latestWinner: latestWinner
      ? {
          login: latestWinner.login,
          displayName: latestWinner.display_name,
          status: latestWinner.status,
          drawnAt: latestWinner.drawn_at,
          responseExpiresAt: latestWinner.response_expires_at,
          selectedPlatform: latestWinner.selected_platform,
        }
      : undefined,
  };
};

const summarizeGiveawayState = (
  state: ReturnType<GiveawaysService["getOperatorState"]>,
) => {
  const activeWinners = state.winners.filter((winner) => !winner.rerolled_at);
  const undeliveredWinnersCount = activeWinners.filter(
    (winner) => !winner.delivered_at,
  ).length;
  const winnerCount = state.giveaway?.winner_count ?? 6;
  const liveState = giveawayLiveState(
    state,
    activeWinners,
    undeliveredWinnersCount,
  );

  return {
    status: state.giveaway?.status ?? "none",
    title: state.giveaway?.title ?? "",
    keyword: state.giveaway?.keyword ?? "enter",
    winnerCount,
    config: state.giveaway
      ? giveawayConfigSummary(state.giveaway)
      : giveawayConfigSummary(),
    entryCount: state.counts.entries,
    winnersDrawn: state.counts.activeWinners,
    rerolledCount: state.counts.rerolledWinners,
    pendingConfirmationCount: activeWinners.filter(
      (winner) => winner.status === "pending_confirmation",
    ).length,
    confirmedWinnerCount: activeWinners.filter(
      (winner) => winner.status === "confirmed",
    ).length,
    expiredWinnerCount: activeWinners.filter(
      (winner) => winner.status === "expired",
    ).length,
    enoughEntrantsForFullDraw: state.counts.entries >= winnerCount,
    undeliveredWinnersCount,
    eligibility: {
      eligibleEntries: state.entries.filter(
        (entry) => entry.eligibility_status === "eligible",
      ).length,
      removedEntries: state.entries.filter(
        (entry) => entry.eligibility_status === "removed",
      ).length,
      minimumFollowAgeDays: state.giveaway?.minimum_follow_age_days ?? 7,
    },
    timer: giveawayTimerSummary(state.giveaway),
    responseTimer: giveawayResponseTimerSummary(activeWinners),
    rules: giveawayRuleSummary(state.giveaway),
    draw: state.giveaway
      ? {
          seed: state.giveaway.draw_seed,
          result: safeJsonObject(state.giveaway.draw_result_json),
          lastDrawAt: state.giveaway.last_draw_at,
        }
      : {},
    operatorState: liveState.label,
    operatorStateDetail: liveState.detail,
    operatorStateTone: liveState.tone,
    safeToEnd: liveState.safeToEnd,
    canSendStatus: Boolean(state.giveaway),
    manualCodeDeliveryRequired: Boolean(state.giveaway),
    endWarnings: [
      state.giveaway?.status === "open" ? "Giveaway is still open." : undefined,
      undeliveredWinnersCount > 0
        ? `${undeliveredWinnersCount} winner(s) are not marked delivered.`
        : undefined,
    ].filter(Boolean),
  };
};

const giveawayLiveState = (
  state: ReturnType<GiveawaysService["getOperatorState"]>,
  activeWinners: ReturnType<GiveawaysService["getOperatorState"]>["winners"],
  undeliveredWinnersCount: number,
) => {
  const giveaway = state.giveaway;

  if (!giveaway) {
    return {
      label: "no giveaway",
      detail: "Start a giveaway when stream operations are ready.",
      tone: "muted",
      safeToEnd: false,
    };
  }

  if (giveaway.status === "open") {
    return {
      label: "entries open",
      detail: `Viewers enter with !${giveaway.keyword}. Close entries before drawing.`,
      tone: "ok",
      safeToEnd: false,
    };
  }

  if (giveaway.status === "closed" && activeWinners.length === 0) {
    return {
      label: "ready to draw",
      detail: `${state.counts.entries} entr${state.counts.entries === 1 ? "y" : "ies"} recorded. Draw winners when ready.`,
      tone: "ok",
      safeToEnd: false,
    };
  }

  if (giveaway.status === "ended") {
    return {
      label: "giveaway ended",
      detail:
        undeliveredWinnersCount > 0
          ? `${undeliveredWinnersCount} winner(s) were still pending delivery at end.`
          : "Post-stream recap is ready.",
      tone: undeliveredWinnersCount > 0 ? "warn" : "ok",
      safeToEnd: false,
    };
  }

  if (undeliveredWinnersCount > 0) {
    return {
      label: "delivery pending",
      detail: `${undeliveredWinnersCount} active winner(s) still need manual delivery.`,
      tone: "warn",
      safeToEnd: false,
    };
  }

  return {
    label: "safe to end",
    detail: "Active winners are marked delivered.",
    tone: "ok",
    safeToEnd: true,
  };
};

const giveawayConfigSummary = (giveaway?: Giveaway) => ({
  itemName: giveaway?.item_name ?? "",
  itemEdition: giveaway?.item_edition ?? "Standard Edition",
  gameName: giveaway?.game_name ?? "",
  marketplaceName: giveaway?.marketplace_name ?? "Eneba",
  marketplaceNote:
    giveaway?.marketplace_note ??
    "Key sourced after winner confirms platform/region.",
  platformMode: giveaway?.platform_mode ?? "winner_selects_after_win",
  supportedPlatforms: giveaway
    ? parseSupportedPlatforms(giveaway)
    : ["Steam", "Xbox", "PlayStation", "Epic", "Other / manual"],
  prizeType: giveaway?.prize_type ?? "standard_game_key",
  minimumFollowAgeDays: giveaway?.minimum_follow_age_days ?? 7,
  mustBePresentToWin: giveaway?.must_be_present_to_win !== 0,
  responseWindowMinutes: giveaway?.response_window_minutes ?? 7,
  oneEntryPerPerson: giveaway?.one_entry_per_person !== 0,
  allowExtraEntries: giveaway?.allow_extra_entries === 1,
  previousWinnerRestrictionMode:
    giveaway?.previous_winner_restriction_mode ?? "base_game_blocks_deluxe",
  ageGuidanceText:
    giveaway?.age_guidance_text ??
    "Game is rated Mature. Please only enter if this is appropriate for you.",
  regionAvailabilityDisclaimer:
    giveaway?.region_availability_disclaimer ??
    "Prize availability depends on platform, region, and legitimate purchasable key availability.",
  entryWindowMinutes: giveaway?.entry_window_minutes ?? 10,
});

const giveawayTimerSummary = (giveaway?: Giveaway) => {
  const entriesCloseAt = giveaway?.entries_close_at ?? "";
  const remainingMs = entriesCloseAt
    ? Math.max(0, Date.parse(entriesCloseAt) - Date.now())
    : 0;

  return {
    entryWindowMinutes: giveaway?.entry_window_minutes ?? 10,
    entriesCloseAt,
    timerStartedAt: giveaway?.timer_started_at ?? "",
    running: Boolean(
      giveaway?.status === "open" && entriesCloseAt && remainingMs > 0,
    ),
    remainingMs,
  };
};

const giveawayResponseTimerSummary = (winners: GiveawayWinner[]) => {
  const pending = winners
    .filter((winner) => winner.status === "pending_confirmation")
    .sort((a, b) =>
      String(a.response_expires_at).localeCompare(
        String(b.response_expires_at),
      ),
    )[0];
  const responseExpiresAt = pending?.response_expires_at ?? "";

  return {
    winnerLogin: pending?.login ?? "",
    responseExpiresAt,
    remainingMs: responseExpiresAt
      ? Math.max(0, Date.parse(responseExpiresAt) - Date.now())
      : 0,
  };
};

const giveawayRuleSummary = (giveaway?: Giveaway) => {
  const config = giveawayConfigSummary(giveaway);
  return [
    `Followed for ${config.minimumFollowAgeDays}+ days`,
    "Must be present in chat to win",
    "One entry per person",
    "Platform confirmed after win",
    "Region/platform availability may vary",
    "No cash alternative",
    `Winner has ${config.responseWindowMinutes} minutes to respond`,
    config.ageGuidanceText,
    "Previous winners cannot win duplicate/base-upgrade versions of the same game",
  ];
};

const safeJsonObject = (value: string) => {
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

const summarizeGiveawayAssurance = (
  state: ReturnType<GiveawaysService["getLatestGiveawayState"]>,
) => {
  if (!state.giveaway) {
    return {
      available: false,
      blockContinue: false,
      phases: [],
      summary: {
        sent: 0,
        resent: 0,
        pending: 0,
        failed: 0,
        requiredCritical: 0,
        confirmedCritical: 0,
        pendingCritical: 0,
        missingCritical: 0,
        failedCritical: 0,
        blockingCritical: 0,
      },
      nextAction: "Start a giveaway.",
    };
  }

  const messages = giveawayOutboundMessagesFor(state.giveaway.id);
  const phases = giveawayAnnouncementPhases.map((phase) =>
    summarizeGiveawayPhase(phase, state, messages),
  );
  const failedCritical = phases.filter(
    (phase) => phase.importance === "critical" && phase.status === "failed",
  );
  const missingCritical = phases.filter(
    (phase) => phase.importance === "critical" && phase.status === "missing",
  );
  const pendingCritical = phases.filter(
    (phase) => phase.importance === "critical" && phase.status === "pending",
  );
  const requiredCritical = phases.filter(
    (phase) => phase.importance === "critical" && phase.required,
  );
  const confirmedCritical = requiredCritical.filter(
    (phase) => phase.status === "sent",
  );
  const failed = messages.filter((message) => message.status === "failed");
  const pending = messages.filter((message) =>
    isPendingOutboundStatus(message.status),
  );
  const sent = messages.filter((message) => message.status === "sent");
  const resent = messages.filter((message) => message.status === "resent");
  const blockingCritical = [
    ...failedCritical,
    ...missingCritical,
    ...pendingCritical,
  ];
  const blockContinue = blockingCritical.length > 0;
  const nextAction = failedCritical[0]
    ? `Resend failed ${failedCritical[0].label} announcement before continuing.`
    : missingCritical[0]
      ? `Send missing ${missingCritical[0].label} announcement before continuing.`
      : pendingCritical[0]
        ? `Wait for ${pendingCritical[0].label} announcement to send.`
        : "Giveaway chat assurance is clear.";

  return {
    available: true,
    giveawayId: state.giveaway.id,
    blockContinue,
    phases,
    summary: {
      sent: sent.length,
      resent: resent.length,
      pending: pending.length,
      failed: failed.length,
      requiredCritical: requiredCritical.length,
      confirmedCritical: confirmedCritical.length,
      pendingCritical: pendingCritical.length,
      missingCritical: missingCritical.length,
      failedCritical: failedCritical.length,
      blockingCritical: blockingCritical.length,
    },
    latestBlocking: blockingCritical[0]
      ? {
          label: blockingCritical[0].label,
          status: blockingCritical[0].status,
          queueStatus: blockingCritical[0].queueStatus,
          action: blockingCritical[0].action,
          reason: blockingCritical[0].reason,
        }
      : undefined,
    nextAction,
    latestFailure: failed[0]
      ? {
          action: failed[0].action,
          failureCategory: failed[0].failureCategory,
          reason: failed[0].reason,
          updatedAt: failed[0].updatedAt,
        }
      : undefined,
  };
};

const summarizeGiveawayPhase = (
  phase: GiveawayAnnouncementPhase,
  state: ReturnType<GiveawaysService["getLatestGiveawayState"]>,
  messages: OutboundMessageRecord[],
) => {
  const latest = latestOutboundForActions(
    state.giveaway?.id,
    phase.actions,
    messages,
  );
  const required = phase.requiredWhen(state);
  const status = latest
    ? phaseStatusFromOutbound(latest)
    : required
      ? "missing"
      : "not-reached";
  const blocksContinue =
    phase.importance === "critical" &&
    required &&
    (status === "failed" || status === "missing" || status === "pending");

  return {
    id: phase.id,
    label: phase.label,
    action: latest?.action || phase.actions[0],
    importance: latest?.importance || phase.importance,
    required,
    status,
    queueStatus: latest?.status ?? status,
    outboundMessageId: latest?.id ?? "",
    attempts: latest?.attempts ?? 0,
    message: latest?.message ?? "",
    reason: latest?.reason ?? "",
    failureCategory: latest?.failureCategory ?? "none",
    retryAfterMs: latest?.retryAfterMs ?? 0,
    nextAttemptAt: latest?.nextAttemptAt ?? "",
    queueDepth: latest?.queueDepth ?? 0,
    updatedAt: latest?.updatedAt ?? "",
    ageMs: latest?.updatedAt ? Date.now() - Date.parse(latest.updatedAt) : 0,
    age: latest?.updatedAt
      ? formatDuration(Date.now() - Date.parse(latest.updatedAt))
      : "",
    blocksContinue,
    canSend: status === "failed" || status === "missing",
    safeToResend:
      (status === "failed" || status === "missing") && canSendConfiguredChat(),
    deliveryDetail: giveawayPhaseDeliveryDetail(phase, status, latest),
    recovery: giveawayPhaseRecoveryText(phase, status),
  };
};

const phaseStatusFromOutbound = (message: OutboundMessageRecord) => {
  if (message.status === "failed") return "failed";
  if (isPendingOutboundStatus(message.status)) return "pending";
  if (message.status === "sent" || message.status === "resent") return "sent";
  return message.status;
};

const giveawayPhaseDeliveryDetail = (
  phase: GiveawayAnnouncementPhase,
  status: string,
  latest: OutboundMessageRecord | undefined,
) => {
  if (!latest) {
    return status === "missing"
      ? `${phase.label} announcement has no outbound record.`
      : `${phase.label} announcement is not required yet.`;
  }

  if (latest.status === "sent") {
    return `Send confirmed at ${latest.updatedAt}.`;
  }

  if (latest.status === "resent") {
    return `Resent as a replacement at ${latest.updatedAt}.`;
  }

  if (latest.status === "queued") {
    return "Queued; wait for send confirmation before continuing.";
  }

  if (latest.status === "sending") {
    return "Sending now; wait for confirmation before continuing.";
  }

  if (latest.status === "retrying") {
    return latest.nextAttemptAt
      ? `Retry scheduled at ${latest.nextAttemptAt}.`
      : "Retrying after a send failure.";
  }

  if (latest.status === "failed") {
    return latest.reason || "Send failed.";
  }

  return `${phase.label} announcement status: ${latest.status}.`;
};

const giveawayPhaseRecoveryText = (
  phase: GiveawayAnnouncementPhase,
  status: string,
) => {
  if (status === "failed") {
    return `Resend the ${phase.label} announcement if chat missed it.`;
  }

  if (status === "missing") {
    return `Send the missing ${phase.label} announcement before continuing.`;
  }

  if (status === "pending") {
    return `Wait for the ${phase.label} announcement to leave the outbound queue.`;
  }

  if (status === "sent") {
    return `${phase.label} announcement is covered.`;
  }

  return "No recovery action needed yet.";
};

const summarizeGiveawayRecap = (
  state: ReturnType<GiveawaysService["getLatestGiveawayState"]>,
  assurance = summarizeGiveawayAssurance(state),
) => {
  if (!state.giveaway) {
    return {
      available: false,
    };
  }

  const activeWinners = state.winners.filter((winner) => !winner.rerolled_at);
  const deliveredWinners = activeWinners.filter(
    (winner) => winner.delivered_at,
  );
  const pendingDelivery = activeWinners.filter(
    (winner) => !winner.delivered_at,
  );
  const messages = outboundHistory
    .list()
    .filter(
      (message) =>
        message.category === "giveaway" &&
        Number(message.giveawayId) === Number(state.giveaway?.id),
    );
  const criticalMessages = messages.filter(
    (message) => message.importance === "critical",
  );
  const failedMessages = messages.filter(
    (message) => message.status === "failed",
  );

  return {
    available: true,
    id: state.giveaway.id,
    title: state.giveaway.title,
    status: state.giveaway.status,
    entryCount: state.counts.entries,
    activeWinnerCount: activeWinners.length,
    deliveredWinnerCount: deliveredWinners.length,
    pendingDeliveryCount: pendingDelivery.length,
    rerolledCount: state.counts.rerolledWinners,
    criticalMessageCount: criticalMessages.length,
    failedMessageCount: failedMessages.length,
    criticalFailedCount: criticalMessages.filter(
      (message) => message.status === "failed",
    ).length,
    sentMessageCount: assurance.summary.sent,
    resentMessageCount: assurance.summary.resent,
    pendingMessageCount: assurance.summary.pending,
    requiredCriticalCount: assurance.summary.requiredCritical,
    confirmedCriticalCount: assurance.summary.confirmedCritical,
    pendingCriticalCount: assurance.summary.pendingCritical,
    missingCriticalCount: assurance.summary.missingCritical,
    blockingCriticalCount: assurance.summary.blockingCritical,
    winners: activeWinners.map((winner) => ({
      login: winner.login,
      displayName: winner.display_name,
      delivered: Boolean(winner.delivered_at),
    })),
  };
};

const giveawayOutboundMessagesFor = (giveawayId: number | undefined) =>
  outboundHistory
    .list()
    .filter(
      (message) =>
        message.category === "giveaway" &&
        giveawayId !== undefined &&
        Number(message.giveawayId) === Number(giveawayId),
    );

const latestOutboundForActions = (
  giveawayId: number | undefined,
  actions: readonly string[],
  messages = giveawayOutboundMessagesFor(giveawayId),
) =>
  messages.find(
    (message) =>
      actions.includes(message.action) &&
      giveawayId !== undefined &&
      Number(message.giveawayId) === Number(giveawayId),
  );

const buildGiveawayAnnouncementForPhase = (
  phase: GiveawayAnnouncementPhase,
  state: ReturnType<GiveawaysService["getLatestGiveawayState"]>,
) => {
  const giveaway = state.giveaway;

  if (!giveaway) {
    return undefined;
  }

  const action = phase.actions[0];
  const activeWinners = state.winners.filter((winner) => !winner.rerolled_at);
  const message =
    action === "start"
      ? giveawayTemplates.start(giveaway)
      : action === "reminder"
        ? giveawayTemplates.reminder(giveaway, state.counts.entries)
        : action === "close" &&
            (giveaway.status === "closed" || giveaway.status === "ended")
          ? giveawayTemplates.close(giveaway, state.counts.entries)
          : action === "draw" && activeWinners.length > 0
            ? giveawayTemplates.draw({
                winners: activeWinners,
                requestedCount: Math.max(
                  activeWinners.length,
                  giveaway.winner_count,
                ),
              })
            : action === "end" && giveaway.status === "ended"
              ? giveawayTemplates.end(giveaway, state.winners)
              : undefined;

  if (!message) {
    return undefined;
  }

  return {
    message,
    metadata: {
      category: "giveaway" as const,
      action,
      importance: phase.importance,
      giveawayId: giveaway.id,
    },
  };
};

const buildGiveawayStatusMessage = (
  state: ReturnType<GiveawaysService["getLatestGiveawayState"]>,
) => {
  const giveaway = state.giveaway;

  if (!giveaway) {
    return undefined;
  }

  const activeWinners = state.winners.filter((winner) => !winner.rerolled_at);
  const pendingDelivery = activeWinners.filter(
    (winner) => !winner.delivered_at,
  );

  if (giveaway.status === "open") {
    return `Giveaway status: entries open for ${giveaway.title}. Type !${giveaway.keyword} to enter. Entries: ${state.counts.entries}. Winners: ${giveaway.winner_count}.`;
  }

  if (giveaway.status === "closed" && activeWinners.length === 0) {
    return `Giveaway status: entries closed for ${giveaway.title}. ${state.counts.entries} entr${state.counts.entries === 1 ? "y" : "ies"}. Ready to draw.`;
  }

  if (activeWinners.length === 0) {
    return `Giveaway status: ${giveaway.title} is ${giveaway.status}. No winners have been drawn.`;
  }

  const winnerText = formatWinnerNames(activeWinners, 5);
  const deliveryText =
    pendingDelivery.length > 0
      ? `Delivery pending for ${pendingDelivery.length}.`
      : "All active winners are marked delivered.";
  const prefix =
    giveaway.status === "ended" ? "Final giveaway status" : "Giveaway status";

  return `${prefix}: ${giveaway.title}. Winner${activeWinners.length === 1 ? "" : "s"}: ${winnerText}. ${deliveryText}`;
};

const runGiveawayAction = async <TResult extends Record<string, unknown>>(
  action: () => TResult | Promise<TResult>,
  options: {
    echoToChat?: boolean;
    echoCommand?: string;
    announcements?: (
      result: TResult,
    ) =>
      | GiveawayAnnouncement
      | GiveawayAnnouncement[]
      | string
      | string[]
      | undefined;
    studioMarker?: (result: TResult) => StudioMarkerInput | undefined;
  } = {},
) => {
  try {
    const result = await action();
    const echoQueued = maybeEchoCommand(
      options.echoToChat,
      options.echoCommand,
    );
    const announcementsQueued = maybeQueueGiveawayAnnouncements(
      options.announcements?.(result),
    );
    maybeCreateStudioEventMarker(options.studioMarker?.(result));

    return {
      ok: true,
      ...result,
      echoQueued,
      announcementsQueued,
      state: getGiveawayState(),
    };
  } catch (error) {
    return {
      ok: false,
      error: safeErrorMessage(error, "Giveaway action failed"),
      state: getGiveawayState(),
    };
  }
};

type GiveawayAnnouncement = {
  message: string;
  metadata: MessageQueueMetadata;
};

const giveawayAnnouncement = (
  message: string,
  action: string,
  giveawayId: number,
  importance: MessageQueueMetadata["importance"] = "normal",
): GiveawayAnnouncement => ({
  message,
  metadata: {
    category: "giveaway",
    action,
    importance,
    giveawayId,
  },
});

type GiveawayStudioAction =
  | "start"
  | "close"
  | "last-call"
  | "draw"
  | "reroll"
  | "end";

type GiveawayStudioMarkerOptions = {
  statusTimestamp?: string | null;
  sourceEventSuffix?: string;
  metadata?: Record<string, unknown>;
};

const giveawayStudioActionLabels: Record<GiveawayStudioAction, string> = {
  start: "started",
  close: "closed",
  "last-call": "last call",
  draw: "draw",
  reroll: "reroll",
  end: "ended",
};

const giveawayStudioMarker = (
  action: GiveawayStudioAction,
  giveaway: Giveaway,
  options: GiveawayStudioMarkerOptions = {},
): StudioMarkerInput => {
  const timestamp = options.statusTimestamp ?? new Date().toISOString();
  const sourceEventSuffix =
    options.sourceEventSuffix ?? safeStudioSourceEventPart(timestamp);

  return {
    label: sanitizeText(
      `Console giveaway ${giveawayStudioActionLabels[action]}: ${giveaway.title}`,
      {
        field: "Studio marker label",
        maxLength: 140,
        required: true,
      },
    ),
    source_app: "vaexcore-console",
    source_event_id: `vaexcore-console:giveaway:${giveaway.id}:${action}:${sourceEventSuffix}`,
    metadata: studioConsoleMarkerMetadata(`console.giveaway.${action}`, {
      giveaway: giveawayMetadata(giveaway),
      ...options.metadata,
    }),
  };
};

const maybeCreateStudioEventMarker = (
  marker: StudioMarkerInput | undefined,
) => {
  if (!marker || !studioIntegration.enabled) {
    return;
  }

  void studioClient.createMarker(marker).catch((error) => {
    logger.warn(
      {
        error,
        label: marker.label,
        sourceEventId: marker.source_event_id,
      },
      "Studio event marker creation failed",
    );
  });
};

const giveawayMetadata = (giveaway: Giveaway) => ({
  id: giveaway.id,
  title: giveaway.title,
  keyword: giveaway.keyword,
  status: giveaway.status,
  winnerCount: giveaway.winner_count,
  itemName: giveaway.item_name,
  itemEdition: giveaway.item_edition,
  gameName: giveaway.game_name,
  prizeType: giveaway.prize_type,
  createdAt: giveaway.created_at,
  openedAt: giveaway.opened_at,
  closedAt: giveaway.closed_at,
  endedAt: giveaway.ended_at,
});

const giveawayWinnerMetadata = (winner: GiveawayWinner) => ({
  id: winner.id,
  giveawayId: winner.giveaway_id,
  login: winner.login,
  displayName: winner.display_name,
  drawnAt: winner.drawn_at,
  status: winner.status,
  responseExpiresAt: winner.response_expires_at,
  confirmedAt: winner.confirmed_at,
  expiredAt: winner.expired_at,
  claimedAt: winner.claimed_at,
  deliveredAt: winner.delivered_at,
  rerolledAt: winner.rerolled_at,
});

const firstWinnerTimestamp = (winners: GiveawayWinner[]) =>
  winners[0]?.drawn_at ?? new Date().toISOString();

const drawSourceEventSuffix = (winners: GiveawayWinner[]) =>
  winners.length > 0
    ? `winners-${winners.map((winner) => winner.id).join("-")}`
    : `winners-none-${Date.now()}`;

const safeStudioSourceEventPart = (value: string) =>
  value
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const maybeQueueGiveawayAnnouncements = (
  messages:
    | GiveawayAnnouncement
    | GiveawayAnnouncement[]
    | string
    | string[]
    | undefined,
) => {
  const list = (Array.isArray(messages) ? messages : [messages]).filter(
    isGiveawayAnnouncementInput,
  );

  if (list.length === 0 || !canSendConfiguredChat()) {
    return false;
  }

  let queued = false;

  for (const item of list) {
    try {
      const message = typeof item === "string" ? item : item.message;
      const metadata =
        typeof item === "string"
          ? classifyOutboundMessage(item)
          : item.metadata;
      const text = sanitizeChatMessage(message);
      chatQueue.enqueue(text, metadata);
      queued = true;
    } catch (error) {
      logger.warn({ error }, "Giveaway chat announcement rejected");
    }
  }

  if (queued) {
    logger.info({ count: list.length }, "Giveaway chat announcement queued");
  }

  return queued;
};

const isGiveawayAnnouncementInput = (
  item: GiveawayAnnouncement | string | undefined,
): item is GiveawayAnnouncement | string => Boolean(item);

const canSendConfiguredChat = () => {
  const twitch = readLocalSecrets().twitch;

  return Boolean(
    twitch.clientId &&
    twitch.accessToken &&
    twitch.broadcasterUserId &&
    twitch.botUserId,
  );
};

async function resolveGiveawayFollowAge(
  event: ChatMessage,
  giveaway: Giveaway,
): ReturnType<GiveawayFollowAgeResolver> {
  if (event.source === "local") {
    if (event.simulatedFollowVerified === false) {
      return {
        status: "unverified",
        checkedAt: new Date().toISOString(),
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
        checkedAt: new Date().toISOString(),
        followAgeDays,
        reason: "Simulated follow age is below the giveaway minimum.",
      };
    }

    return {
      status: "eligible",
      followedAt,
      checkedAt: new Date().toISOString(),
      followAgeDays,
    };
  }

  const twitch = readLocalSecrets().twitch;

  if (!twitch.clientId || !twitch.accessToken || !twitch.broadcasterUserId) {
    return {
      status: "unverified",
      checkedAt: new Date().toISOString(),
      reason: "Follow age lookup is not configured.",
    };
  }

  try {
    const follower = await getChannelFollower(
      { clientId: twitch.clientId, accessToken: twitch.accessToken },
      { broadcasterId: twitch.broadcasterUserId, userId: event.userId },
    );

    if (!follower?.followed_at) {
      return {
        status: "unverified",
        checkedAt: new Date().toISOString(),
        reason: "Follow age could not be verified.",
      };
    }

    const followAgeDays = Math.floor(
      (Date.now() - Date.parse(follower.followed_at)) / (24 * 60 * 60 * 1000),
    );

    if (followAgeDays < giveaway.minimum_follow_age_days) {
      return {
        status: "too_new",
        followedAt: follower.followed_at,
        checkedAt: new Date().toISOString(),
        followAgeDays,
        reason: "Follow age is below the giveaway minimum.",
      };
    }

    return {
      status: "eligible",
      followedAt: follower.followed_at,
      checkedAt: new Date().toISOString(),
      followAgeDays,
    };
  } catch (error) {
    logger.warn(
      { error: redactSecrets(error), userLogin: event.userLogin },
      "Giveaway follow age lookup failed",
    );
    return {
      status: "unverified",
      checkedAt: new Date().toISOString(),
      reason: "Follow age lookup failed.",
    };
  }
}

const maybeEchoCommand = (
  echoToChat: boolean | undefined,
  command: string | undefined,
) => {
  let text: string;

  try {
    text = command ? sanitizeCommandText(command) : "";
  } catch (error) {
    logger.warn({ error }, "Operator command echo rejected");
    return false;
  }

  if (!echoToChat || !text) {
    return false;
  }

  try {
    chatQueue.enqueue(text);
    logger.info({ command: text }, "Operator command echo queued");
    return true;
  } catch (error) {
    logger.warn(
      { error, command: text },
      "Operator command echo failed to queue",
    );
    return false;
  }
};

const localUiActor: ChatMessage = {
  id: "local-ui",
  text: "",
  userId: "local-ui",
  userLogin: "local-ui",
  userDisplayName: "Local UI",
  broadcasterUserId: "local-ui",
  badges: ["broadcaster"],
  isBroadcaster: true,
  isMod: true,
  isVip: false,
  isSubscriber: false,
  source: "local",
  receivedAt: new Date(),
};

const simulatedChatActor: ChatMessage = {
  ...localUiActor,
  id: "simulated-chat",
  userId: "simulated-chat",
  userLogin: "simulated-chat",
  userDisplayName: "Simulated Chat",
};

type LocalChatRole = "viewer" | "subscriber" | "vip" | "mod" | "broadcaster";

const createLocalChatMessage = (input: {
  login: string;
  displayName?: string;
  role: LocalChatRole;
  text: string;
  followAgeDays?: number;
  followVerified?: boolean;
}): ChatMessage => {
  const login = requireUsername(input.login);
  const isBroadcaster = input.role === "broadcaster";
  const isMod = input.role === "mod" || isBroadcaster;
  const isVip = input.role === "vip";
  const isSubscriber = input.role === "subscriber";

  return {
    id: `local-${login}-${Date.now()}`,
    text: sanitizeCommandText(input.text),
    userId: `local-${login}`,
    userLogin: login,
    userDisplayName: sanitizeDisplayName(input.displayName, login),
    broadcasterUserId: "local-broadcaster",
    badges: isBroadcaster
      ? ["broadcaster"]
      : isMod
        ? ["moderator"]
        : isVip
          ? ["vip"]
          : isSubscriber
            ? ["subscriber"]
            : [],
    isBroadcaster,
    isMod,
    isVip,
    isSubscriber,
    source: "local",
    receivedAt: new Date(),
    simulatedFollowAgeDays: input.followAgeDays,
    simulatedFollowVerified: input.followVerified,
  };
};

const simulateCommand = async (body: {
  actor?: string;
  role?: "viewer" | "mod" | "broadcaster";
  command?: string;
  echoToChat?: boolean;
}) => {
  let command: string;

  try {
    command = sanitizeCommandText(body.command);
  } catch (error) {
    return {
      ok: false,
      error: safeErrorMessage(error, "Command text is required."),
      state: getGiveawayState(),
    };
  }

  const replies: string[] = [];
  const router = new CommandRouter({
    prefix: "!",
    logger,
    enqueueMessage: (message) => replies.push(message),
  });
  registerGiveawayCommands({
    router,
    service: giveawaysService,
    runtimeStatus: setupRuntimeStatus,
    messages: giveawayTemplates,
  });
  registerCommandsModule({
    router,
    db,
    featureGates,
  });
  registerStudioCommands({
    router,
    logger,
  });

  try {
    const actor = createLocalChatMessage({
      login: body.actor || "viewer",
      role: body.role ?? "viewer",
      text: command,
    });
    let moderation: ReturnType<ModerationService["evaluate"]> | undefined;

    try {
      moderation = moderationService.evaluate(actor, { consumePermits: false });
      if (moderation.hit) {
        replies.push(moderation.hit.warningMessage);
      }
    } catch (error) {
      logger.warn(
        { error: redactSecrets(error), command },
        "Moderation simulation failed open",
      );
    }

    const routerResult = await router.handle(actor);
    const echoQueued =
      routerResult === "handled"
        ? maybeEchoCommand(body.echoToChat, command)
        : false;

    return {
      ok: true,
      replies,
      moderation,
      routerResult,
      echoQueued,
      state: getGiveawayState(),
    };
  } catch (error) {
    return {
      ok: false,
      error: safeErrorMessage(error, "Simulated command failed"),
      replies,
      state: getGiveawayState(),
    };
  }
};

const runLocalLifecycleTest = (options: {
  echoToChat: boolean;
  confirmed: boolean;
}) =>
  runGiveawayAction(async () => {
    if (!options.confirmed) {
      throw new Error("Confirm before running the local lifecycle test.");
    }

    if (giveawaysService.status()) {
      throw new Error(
        "End the active giveaway before running the local lifecycle test.",
      );
    }

    const giveaway = giveawaysService.start({
      actor: localUiActor,
      title: "Community Giveaway",
      keyword: "enter",
      winnerCount: 6,
    });

    for (const login of ["alice", "bob", "carol", "dave", "erin", "frank"]) {
      await giveawaysService.addSimulatedEntrant(
        simulatedChatActor,
        createLocalChatMessage({
          login,
          role: "viewer",
          text: "!enter",
        }),
      );
    }

    giveawaysService.close(localUiActor);
    const draw = giveawaysService.draw(localUiActor, 6);
    const firstWinner = draw.winners[0];

    if (firstWinner) {
      giveawaysService.claim(localUiActor, firstWinner.login);
      giveawaysService.deliver(localUiActor, firstWinner.login);
    }

    maybeEchoCommand(
      options.echoToChat,
      '!gstart codes=6 keyword=enter title="Community Giveaway"',
    );
    maybeEchoCommand(options.echoToChat, "!gclose");
    maybeEchoCommand(options.echoToChat, "!gdraw 6");

    if (firstWinner) {
      maybeEchoCommand(options.echoToChat, `!gclaim ${firstWinner.login}`);
      maybeEchoCommand(options.echoToChat, `!gdeliver ${firstWinner.login}`);
    }

    return { giveaway, draw };
  });

const requireUsername = (username: string | undefined) =>
  normalizeTwitchLogin(username, "Username");

class TwitchOAuthExchangeError extends Error {
  constructor(
    readonly status: number,
    readonly twitchMessage: string,
    readonly body: string,
  ) {
    super(`Twitch OAuth exchange failed: ${status} ${twitchMessage}`);
    this.name = "TwitchOAuthExchangeError";
  }
}

const classifyOAuthExchangeError = (error: unknown) => {
  if (error instanceof TwitchOAuthExchangeError) {
    if (
      error.status === 403 &&
      /invalid client secret/i.test(error.twitchMessage)
    ) {
      return "invalid_client_secret";
    }

    if (/invalid client/i.test(error.twitchMessage)) {
      return "invalid_client_credentials";
    }

    if (/redirect/i.test(error.twitchMessage)) {
      return "redirect_uri_mismatch";
    }
  }

  return "oauth_exchange_failed";
};

const parseTwitchOAuthErrorMessage = (body: string) => {
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown };
    const message =
      typeof parsed.message === "string" ? parsed.message : parsed.error;
    return typeof message === "string" && message.trim()
      ? message.trim()
      : body;
  } catch {
    return body;
  }
};

const exchangeCode = async (input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<TwitchOAuthTokenResponse & { refresh_token: string }> => {
  const params = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
  });
  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new TwitchOAuthExchangeError(
      response.status,
      parseTwitchOAuthErrorMessage(body),
      body,
    );
  }

  const tokens = (await response.json()) as Partial<TwitchOAuthTokenResponse>;

  if (!tokens.access_token || !tokens.refresh_token || !tokens.expires_in) {
    throw new Error(
      "Twitch OAuth exchange did not return usable access and refresh tokens.",
    );
  }

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in,
    scope: tokens.scope ?? [],
    token_type: tokens.token_type ?? "bearer",
  };
};

const readJson = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;

    if (totalBytes > limits.requestBodyBytes) {
      throw new Error("Request body is too large.");
    }

    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
};

const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, {
    ...securityHeaders,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
};

const sendHtml = (response: ServerResponse, html: string) => {
  response.writeHead(200, {
    ...securityHeaders,
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(html);
};

const sendPlatformHtml = (response: ServerResponse, html: string) => {
  response.writeHead(200, {
    ...securityHeaders,
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-src https://player.twitch.tv https://www.twitch.tv; connect-src 'self'; img-src 'self' data: https:",
  });
  response.end(html);
};

const sendStaticUiAsset = (response: ServerResponse, pathname: string) => {
  const fileName = pathname.replace(/^\/ui\//, "");

  if (!/^[a-z0-9.-]+$/i.test(fileName)) {
    sendText(response, 404, "Not found");
    return;
  }

  const filePath = resolveSetupUiAssetPath(fileName);

  if (!filePath) {
    sendText(response, 404, "Not found");
    return;
  }

  const contentType = getStaticUiAssetContentType(filePath);

  response.writeHead(200, {
    ...securityHeaders,
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  response.end(readFileSync(filePath));
};

const getStaticUiAssetContentType = (filePath: string) => {
  switch (extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
};

const getSetupUiDir = () => {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const bundledPath = join(currentDir, "setup-ui");
  const sourcePath = join(currentDir, "ui");

  return existsSync(bundledPath) ? bundledPath : sourcePath;
};

type SuiteLaunchResult = {
  appName: string;
  ok: boolean;
  detail: string;
};

const launchVaexcoreSuite = async () => {
  const results = await Promise.all(
    vaexcoreSuiteApps.map((appName) =>
      appName === "vaexcore console"
        ? Promise.resolve({
            appName,
            ok: true,
            detail: "vaexcore console is already running.",
          })
        : launchDesktopApp(appName),
    ),
  );

  appendSuiteTimelineEvent({
    sourceApp: "vaexcore-console",
    sourceAppName: "vaexcore console",
    kind: "suite.launch",
    title: "Console launched suite",
    detail: results.every((result) => result.ok)
      ? "Launch requested for Studio, Pulse, and Console."
      : "One or more suite apps could not be launched.",
    metadata: { results },
  });

  return {
    ok: results.every((result) => result.ok),
    results,
  };
};

const launchDesktopApp = (appName: string): Promise<SuiteLaunchResult> => {
  if (process.platform === "darwin") {
    return launchMacApp(appName);
  }

  if (process.platform === "win32") {
    return launchWindowsApp(appName);
  }

  return Promise.resolve({
    appName,
    ok: false,
    detail: "Suite launching is supported on macOS and Windows desktop builds.",
  });
};

const launchMacApp = (appName: string): Promise<SuiteLaunchResult> =>
  new Promise((resolveLaunch) => {
    const child = spawn("open", ["-a", appName], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolveLaunch({
        appName,
        ok: false,
        detail: safeErrorMessage(error, "Launch failed."),
      });
    });

    child.on("close", (code) => {
      resolveLaunch({
        appName,
        ok: code === 0,
        detail:
          code === 0
            ? "Launch requested."
            : stderr.trim() || `open exited with code ${code}.`,
      });
    });
  });

const launchWindowsApp = (appName: string): Promise<SuiteLaunchResult> =>
  new Promise((resolveLaunch) => {
    const executable = windowsAppExecutablePath(appName);
    if (!executable) {
      resolveLaunch({
        appName,
        ok: false,
        detail: `Could not find ${appName}. Install it with the Windows installer or place it in a standard vaexcore install folder.`,
      });
      return;
    }

    const child = spawn(executable, [], {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolveLaunch({
        appName,
        ok: false,
        detail: safeErrorMessage(error, "Launch failed."),
      });
    });

    child.on("close", (code) => {
      resolveLaunch({
        appName,
        ok: code === 0,
        detail:
          code === 0
            ? `Launch requested from ${executable}.`
            : stderr.trim() || `start exited with code ${code}.`,
      });
    });
  });

const startSuiteDiscoveryHeartbeat = (port: number) => {
  const startedAt = new Date().toISOString();
  const write = () => {
    try {
      writeSuiteDiscoveryDocument(port, startedAt);
    } catch (error) {
      logger.warn(
        { error: redactSecrets(error) },
        "Unable to write vaexcore console suite discovery",
      );
    }
  };

  write();
  return setInterval(write, suiteDiscoveryHeartbeatMs);
};

const writeSuiteDiscoveryDocument = (port: number, startedAt: string) => {
  const apiUrl = `http://127.0.0.1:${port}`;
  const directory = suiteDiscoveryDir();
  const session = readSuiteSessionDocument();
  const document: SuiteDiscoveryDocument = {
    schemaVersion: SUITE_DISCOVERY_SCHEMA_VERSION,
    appId: CONSOLE_APP.id,
    appName: CONSOLE_APP.name,
    bundleIdentifier: CONSOLE_APP.bundleId,
    version: "0.1.2",
    pid: process.pid,
    startedAt,
    updatedAt: new Date().toISOString(),
    apiUrl,
    wsUrl: null,
    healthUrl: `${apiUrl}/api/status`,
    capabilities: [
      "console.setup",
      "twitch.operations",
      "studio.chat-markers",
      "studio.giveaway-event-markers",
      "suite.commands",
      "suite.launcher",
      "suite.timeline",
      "twitch.stream_key",
      "platform.local_page",
    ],
    launchName: CONSOLE_APP.launchName,
    suiteSessionId: session?.sessionId ?? null,
    activity: "live-ops",
    activityDetail: session
      ? `Monitoring chat operations for ${session.title}`
      : "Ready for chat and stream operations",
    localRuntime: buildConsoleLocalRuntime(apiUrl),
  };

  validateSuiteDiscoveryDocument(document);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, CONSOLE_APP.discoveryFile),
    `${JSON.stringify(document, null, 2)}\n`,
  );
};

const buildConsoleLocalRuntime = (apiUrl?: string): SuiteLocalRuntime => {
  const config = getSafeConfig();
  const databasePath = resolveDatabasePath(databaseUrl);
  const appStorageDir = dirname(getLocalSecretsPath());

  return {
    contractVersion: 1,
    mode: "local-first",
    state: "ready",
    appStorageDir,
    suiteDir: suiteDiscoveryDir(),
    secureStorage: "local.secrets.json",
    secretStorageState: consoleSecretStorageState(),
    durableStorage: [
      "SQLite command configuration, audit logs, giveaways, timers, and moderation settings",
      "local.secrets.json",
      "setup UI diagnostics and support bundle data",
    ],
    networkPolicy: "localhost-only",
    dependencies: [
      {
        name: "setup-server",
        kind: "local-http-service",
        state: apiUrl ? "reachable" : "running",
        detail: apiUrl
          ? `Operator API is bound to ${apiUrl}.`
          : "Operator API is running locally.",
      },
      {
        name: "sqlite",
        kind: "local-database",
        state: existsSync(databasePath) ? "ready" : "initializing",
        detail: databasePath,
      },
      {
        name: "twitch",
        kind: "network-platform",
        state:
          config.mode === "local" ? "offline-rehearsal" : "operator-controlled",
        detail:
          config.mode === "local"
            ? "Console is in local mode; Twitch is not required for rehearsal."
            : "Twitch is required only for live chat operations, not local setup or rehearsal.",
      },
    ],
  };
};

const suiteDiscoveryDir = () => join(vaexcoreSharedDataDir(), "suite");

const vaexcoreSharedDataDir = () => {
  if (process.platform === "win32") {
    return join(
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
      "vaexcore",
    );
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "vaexcore");
  }

  return join(
    process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
    "vaexcore",
  );
};

const consoleSecretStorageState = () => {
  if (process.platform === "win32") {
    return "app-owned-file-needs-credential-manager-migration";
  }

  if (process.platform === "darwin") {
    return "app-owned-file-needs-keychain-migration";
  }

  return "app-owned-file-needs-secure-store-migration";
};

const readSuiteSessionDocument = (): {
  sessionId: string;
  title: string;
} | null => {
  try {
    const parsed = JSON.parse(
      readFileSync(join(suiteDiscoveryDir(), "session.json"), "utf8"),
    );
    if (
      typeof parsed?.sessionId === "string" &&
      typeof parsed?.title === "string"
    ) {
      return { sessionId: parsed.sessionId, title: parsed.title };
    }
  } catch {
    return null;
  }
  return null;
};

const suiteAppStatus = (
  definition: (typeof vaexcoreSuiteAppDefinitions)[number],
): SuiteAppStatus => {
  const discoveryFile = join(suiteDiscoveryDir(), `${definition.appId}.json`);
  const discovery = readSuiteDiscoveryDocument(discoveryFile);
  const installed = desktopAppIsInstalled(definition.launchName);
  const pid = typeof discovery?.pid === "number" ? discovery.pid : null;
  const running = typeof pid === "number" ? processIsRunning(pid) : false;
  const stale = suiteDiscoveryIsStale(discoveryFile);
  const reachable = running && !stale && Boolean(discovery?.healthUrl);

  return {
    appId: definition.appId,
    appName: discovery?.appName || definition.appName,
    launchName: definition.launchName,
    bundleIdentifier: definition.bundleIdentifier,
    installed,
    running,
    reachable,
    stale,
    discoveryFile,
    pid,
    apiUrl: discovery?.apiUrl ?? null,
    healthUrl: discovery?.healthUrl ?? null,
    updatedAt: discovery?.updatedAt ?? null,
    capabilities: Array.isArray(discovery?.capabilities)
      ? discovery.capabilities
      : [],
    suiteSessionId: discovery?.suiteSessionId ?? null,
    activity: discovery?.activity ?? null,
    activityDetail: discovery?.activityDetail ?? null,
    localRuntime: discovery?.localRuntime ?? null,
    detail: suiteStatusDetail(
      installed,
      Boolean(discovery),
      running,
      stale,
      reachable,
    ),
  };
};

const readSuiteDiscoveryDocument = (
  path: string,
): SuiteDiscoveryDocument | null => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SuiteDiscoveryDocument;
  } catch {
    return null;
  }
};

const suiteDiscoveryIsStale = (path: string) => {
  try {
    return Date.now() - statSync(path).mtimeMs > 45_000;
  } catch {
    return true;
  }
};

const processIsRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const suiteStatusDetail = (
  installed: boolean,
  discovered: boolean,
  running: boolean,
  stale: boolean,
  reachable: boolean,
) => {
  if (!installed) {
    return platformInstallHint();
  }
  if (!discovered) {
    return "No suite heartbeat has been published yet.";
  }
  if (!running) {
    return "Heartbeat exists, but the app process is not running.";
  }
  if (stale) {
    return "The suite heartbeat is stale.";
  }
  if (!reachable) {
    return "The app is running, but its local health endpoint is not reachable yet.";
  }
  return "Ready.";
};

const desktopAppIsInstalled = (appName: string) => {
  if (process.platform === "darwin") {
    return existsSync(join("/Applications", `${appName}.app`));
  }

  if (process.platform === "win32") {
    return Boolean(windowsAppExecutablePath(appName));
  }

  return false;
};

const platformInstallHint = () => {
  if (process.platform === "win32") {
    return "Install this app with the Windows installer or keep the portable executable in a standard vaexcore install folder.";
  }

  if (process.platform === "darwin") {
    return "Install this app in /Applications.";
  }

  return "Install this app in the platform app folder.";
};

const windowsAppExecutablePath = (appName: string) => {
  if (process.platform !== "win32") {
    return undefined;
  }

  const executableNames = windowsAppExecutableNames(appName);
  const currentExecutable = process.argv[0];
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const localAppDataRoots = [
    process.env.LOCALAPPDATA,
    join(homedir(), "AppData", "Local"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const candidates = [
    ...localAppDataRoots.flatMap((root) =>
      executableNames.flatMap((exeName) => [
        join(root, appName, exeName),
        join(root, "Programs", appName, exeName),
      ]),
    ),
    programFiles
      ? executableNames.map((exeName) => join(programFiles, appName, exeName))
      : [],
    programFilesX86
      ? executableNames.map((exeName) =>
          join(programFilesX86, appName, exeName),
        )
      : [],
    currentExecutable &&
    executableNames.some(
      (exeName) =>
        basename(currentExecutable).toLowerCase() === exeName.toLowerCase(),
    )
      ? currentExecutable
      : undefined,
  ]
    .flat()
    .filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => existsSync(candidate));
};

const windowsAppExecutableNames = (appName: string) => {
  switch (appName) {
    case "vaexcore studio":
      return ["vaexcore-studio.exe"];
    case "vaexcore pulse":
      return ["vaexcore-pulse.exe"];
    case "vaexcore console":
      return ["vaexcore-console.exe"];
    default:
      return [`${appName}.exe`];
  }
};

const startSuiteCommandPoller = () => {
  const read = () => {
    try {
      consumeSuiteCommands();
    } catch (error) {
      logger.warn(
        { error: redactSecrets(error) },
        "Unable to consume vaexcore console suite commands",
      );
    }
  };

  read();
  return setInterval(read, 2500);
};

const consumeSuiteCommands = () => {
  const directory = join(suiteDiscoveryDir(), "commands", "vaexcore-console");
  if (!existsSync(directory)) {
    return;
  }

  for (const fileName of readdirSync(directory).filter((file) =>
    file.endsWith(".json"),
  )) {
    const path = join(directory, fileName);
    let command: SuiteCommandDocument;
    try {
      command = JSON.parse(readFileSync(path, "utf8")) as SuiteCommandDocument;
    } catch (error) {
      logger.warn(
        { error: redactSecrets(error), fileName },
        "Skipping unreadable vaexcore console suite command",
      );
      continue;
    }
    try {
      validateSuiteCommandDocument(command);
      unlinkSync(path);
    } catch (error) {
      logger.warn(
        { error: redactSecrets(error), fileName },
        "Skipping invalid vaexcore console suite command",
      );
      unlinkSync(path);
      continue;
    }

    appendSuiteTimelineEvent({
      sourceApp: "vaexcore-console",
      sourceAppName: "vaexcore console",
      kind: "suite.command",
      title: "Console consumed suite command",
      detail: command.command
        ? `Handled ${command.command} from ${command.sourceAppName ?? "another suite app"}.`
        : `Handled a suite command from ${command.sourceAppName ?? "another suite app"}.`,
      metadata: {
        commandId: command.commandId ?? null,
        command: command.command ?? null,
        sourceAppName: command.sourceAppName ?? null,
      },
    });

    if (command.command === "focus-ops") {
      logger.info(
        {
          commandId: command.commandId,
          sourceAppName: command.sourceAppName,
        },
        "Received suite focus request for vaexcore console",
      );
    }
  }
};

const getSharedAssetDir = () => {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return join(currentDir, "..", "..", "assets");
};

const resolveSetupUiAssetPath = (fileName: string) => {
  const setupPath = join(getSetupUiDir(), fileName);

  if (existsSync(setupPath)) {
    return setupPath;
  }

  const sharedAssetPath = join(getSharedAssetDir(), fileName);
  return existsSync(sharedAssetPath) ? sharedAssetPath : undefined;
};

const sendText = (response: ServerResponse, status: number, text: string) => {
  response.writeHead(status, {
    ...securityHeaders,
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(text);
};

const redirect = (response: ServerResponse, location: string) => {
  response.writeHead(302, { ...securityHeaders, Location: location });
  response.end();
};

const isLocalRequest = (request: IncomingMessage) => {
  const remote = request.socket.remoteAddress;
  return (
    remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1"
  );
};

const isAllowedHost = (hostHeader: string | undefined) => {
  if (!hostHeader) {
    return true;
  }

  const hostName = hostHeader.split(":")[0]?.replace(/^\[|\]$/g, "");
  return (
    hostName === "localhost" || hostName === "127.0.0.1" || hostName === "::1"
  );
};

const normalizeLogin = (value: string | undefined) => {
  const login = extractLoginInput(value);
  return login ? normalizeTwitchLogin(login) : undefined;
};

const extractLoginInput = (value: string | undefined) => {
  const trimmed = value?.trim().replace(/^@/, "");

  if (!trimmed) {
    return undefined;
  }

  const maybeUrl = trimmed.match(/^https?:\/\//i)
    ? trimmed
    : trimmed.match(/^(www\.)?twitch\.tv\//i)
      ? `https://${trimmed}`
      : undefined;

  if (!maybeUrl) {
    return trimmed;
  }

  try {
    const parsed = new URL(maybeUrl);
    const host = parsed.hostname.toLowerCase();
    if (host === "twitch.tv" || host === "www.twitch.tv") {
      return parsed.pathname.split("/").filter(Boolean)[0];
    }
  } catch {
    return trimmed;
  }

  return trimmed;
};

const sanitizeOptionalText = (
  value: string | undefined,
  field: string,
  maxLength: number,
) =>
  value?.trim()
    ? sanitizeText(value, { field, maxLength, required: true })
    : undefined;

const sanitizeRedirectUri = (value: string | undefined) => {
  const redirectUri = sanitizeText(value || defaultRedirectUri, {
    field: "Redirect URI",
    maxLength: 200,
    required: true,
  });
  const parsed = new URL(redirectUri);

  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "localhost" ||
    parsed.port !== "3434" ||
    parsed.pathname !== "/auth/twitch/callback"
  ) {
    throw new Error(
      "Redirect URI must be http://localhost:3434/auth/twitch/callback.",
    );
  }

  return parsed.toString();
};

const sanitizeRelayBaseUrl = (value: string | undefined) => {
  const baseUrl = sanitizeOptionalText(value, "Relay URL", 300);

  if (!baseUrl) {
    return undefined;
  }

  const parsed = new URL(baseUrl);

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Relay URL must start with http:// or https://.");
  }

  return parsed.toString().replace(/\/+$/, "");
};

const consumeOauthState = (state: string) => {
  const expiresAt = oauthStates.get(state);
  oauthStates.delete(state);

  for (const [storedState, storedExpiresAt] of oauthStates.entries()) {
    if (storedExpiresAt < Date.now()) {
      oauthStates.delete(storedState);
    }
  }

  return Boolean(expiresAt && expiresAt >= Date.now());
};

const valueOrExisting = (
  value: string | undefined,
  existing: string | undefined,
) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : existing;
};

const valueOrExistingLogin = (
  input: Record<string, string>,
  field: "broadcasterLogin" | "botLogin",
  existing: string | undefined,
) =>
  hasSubmittedField(input, field) ? normalizeLogin(input[field]) : existing;

const hasSubmittedField = (input: Record<string, string>, field: string) =>
  Object.prototype.hasOwnProperty.call(input, field);

const clearTwitchAuthorization = (
  twitch: LocalSecrets["twitch"],
  options: { clearBroadcasterIdentity?: boolean } = {},
): LocalSecrets["twitch"] => ({
  ...twitch,
  accessToken: undefined,
  refreshToken: undefined,
  scopes: [],
  tokenExpiresAt: undefined,
  tokenValidatedAt: undefined,
  botUserId: undefined,
  broadcasterUserId: options.clearBroadcasterIdentity
    ? undefined
    : twitch.broadcasterUserId,
});

const maskToken = (token: string) =>
  token.length <= 8 ? "********" : `${token.slice(0, 4)}...${token.slice(-4)}`;

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
};

const setupShellHtml = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>vaexcore console</title>
    <link rel="icon" href="/ui/logo.jpg" />
    <link rel="stylesheet" href="/ui/styles.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/ui/app.js"></script>
  </body>
</html>`;

const giveawayOverlayHtml = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>vaexcore giveaway overlay</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #050711;
        --panel: rgba(13, 16, 32, 0.92);
        --panel-soft: rgba(18, 22, 42, 0.88);
        --line: rgba(138, 174, 255, 0.18);
        --cyan: #39d9ff;
        --magenta: #ff3bf4;
        --violet: #8f5cff;
        --text: #f4f8ff;
        --muted: #aeb8d4;
        --amber: #ffd27a;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        width: 100vw;
        height: 100vh;
        overflow: hidden;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          linear-gradient(135deg, rgba(57, 217, 255, 0.08), transparent 25%),
          linear-gradient(225deg, rgba(255, 59, 244, 0.07), transparent 25%),
          linear-gradient(180deg, rgba(143, 92, 255, 0.08), transparent 40%),
          var(--bg);
        color: var(--text);
      }
      .overlay {
        width: 1920px;
        height: 1080px;
        transform-origin: top left;
        padding: 56px;
        display: grid;
        grid-template-columns: 1.45fr 0.9fr;
        grid-template-rows: auto 1fr auto;
        gap: 24px;
      }
      .hero, .panel {
        border: 1px solid var(--line);
        background: var(--panel);
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.34);
        border-radius: 8px;
      }
      .hero {
        grid-column: 1 / -1;
        padding: 34px 38px;
        position: relative;
      }
      .hero::before {
        position: absolute;
        inset: 0 0 auto;
        height: 3px;
        content: "";
        background: linear-gradient(90deg, var(--cyan), var(--magenta));
      }
      h1 {
        margin: 0 0 12px;
        font-size: 58px;
        line-height: 1;
        letter-spacing: 0;
      }
      .prize {
        margin: 0;
        color: var(--muted);
        font-size: 28px;
      }
      .panel {
        padding: 28px;
        min-width: 0;
      }
      .status-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 18px;
        margin-bottom: 24px;
      }
      .metric {
        background: var(--panel-soft);
        border: 1px solid var(--line);
        border-radius: 6px;
        padding: 20px;
      }
      .label {
        color: var(--muted);
        font-size: 18px;
        margin-bottom: 8px;
      }
      .value {
        font-size: 34px;
        font-weight: 750;
      }
      .winner {
        min-height: 365px;
        display: grid;
        place-items: center;
        text-align: center;
        background:
          radial-gradient(circle at 50% 42%, rgba(57, 217, 255, 0.16), transparent 34%),
          var(--panel-soft);
        border: 1px solid rgba(57, 217, 255, 0.22);
        border-radius: 8px;
      }
      .winner-name {
        font-size: 72px;
        font-weight: 800;
        text-shadow: 0 0 24px rgba(57, 217, 255, 0.26);
      }
      .winner-state {
        color: var(--amber);
        font-size: 24px;
        margin-top: 14px;
      }
      .spinner {
        width: 138px;
        height: 138px;
        border: 3px solid rgba(57, 217, 255, 0.22);
        border-top-color: var(--cyan);
        border-right-color: var(--magenta);
        border-radius: 50%;
        animation: spin 1.8s linear infinite;
        margin: 0 auto 24px;
      }
      .drawing .spinner { display: block; }
      .spinner { display: none; }
      @keyframes spin { to { transform: rotate(360deg); } }
      h2 {
        margin: 0 0 18px;
        font-size: 28px;
      }
      ul {
        margin: 0;
        padding-left: 23px;
        display: grid;
        gap: 11px;
        color: var(--muted);
        font-size: 20px;
        line-height: 1.28;
      }
      .source {
        display: grid;
        gap: 14px;
        color: var(--muted);
        font-size: 22px;
      }
      .source strong { color: var(--text); }
      .footer {
        grid-column: 1 / -1;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 24px;
      }
      .note {
        color: var(--muted);
        font-size: 21px;
        line-height: 1.35;
      }
    </style>
  </head>
  <body>
    <main class="overlay" id="overlay">
      <section class="hero">
        <h1 id="title">Giveaway</h1>
        <p class="prize" id="prize">Waiting for giveaway config</p>
      </section>
      <section class="panel">
        <div class="status-grid">
          <div class="metric"><div class="label">Status</div><div class="value" id="status">Closed</div></div>
          <div class="metric"><div class="label">Countdown</div><div class="value" id="countdown">--:--</div></div>
          <div class="metric"><div class="label">Entrants</div><div class="value" id="entrants">0</div></div>
        </div>
        <div class="winner" id="winnerPanel">
          <div>
            <div class="spinner"></div>
            <div class="winner-name" id="winnerName">No winner yet</div>
            <div class="winner-state" id="winnerState">Entries not drawn</div>
          </div>
        </div>
      </section>
      <section class="panel">
        <h2>Rules</h2>
        <ul id="rules"></ul>
      </section>
      <section class="footer">
        <div class="panel source">
          <div><strong id="marketplace">Marketplace: Eneba</strong></div>
          <div id="marketplaceNote">Key purchased after winner confirms platform/region.</div>
          <div>Not sponsored. No affiliate link.</div>
        </div>
        <div class="panel">
          <h2>Platform Availability</h2>
          <div class="note" id="platformNote">Prize availability depends on platform, region, and legitimate purchasable key availability.</div>
          <div class="note" id="responseTimer" style="margin-top:18px;">Response timer starts after draw.</div>
        </div>
      </section>
    </main>
    <script>
      const overlay = document.getElementById("overlay");
      let lastWinnerKey = "";
      function scaleOverlay() {
        const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
        overlay.style.transform = "scale(" + scale + ")";
      }
      window.addEventListener("resize", scaleOverlay);
      scaleOverlay();
      function mmss(ms) {
        if (!ms) return "--:--";
        const seconds = Math.max(0, Math.ceil(ms / 1000));
        return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
      }
      function statusLabel(summary) {
        if (!summary || summary.status === "none") return "Closed";
        if (summary.operatorState === "ready to draw") return "Drawing Ready";
        if (summary.pendingConfirmationCount > 0) return "Winner Pending";
        if (summary.confirmedWinnerCount > 0) return "Confirmed";
        if (summary.expiredWinnerCount > 0) return "Reroll Ready";
        return summary.status === "open" ? "Open" : summary.status === "closed" ? "Closed" : "Rerolled";
      }
      async function refresh() {
        const response = await fetch("/api/giveaway/overlay", { cache: "no-store" });
        const data = await response.json();
        const summary = data.summary || {};
        const config = summary.config || {};
        const winner = data.latestWinner;
        document.getElementById("title").textContent = summary.title || "Giveaway";
        document.getElementById("prize").textContent = [config.gameName, config.itemEdition].filter(Boolean).join(" - ") || config.itemName || "Prize";
        document.getElementById("status").textContent = statusLabel(summary);
        document.getElementById("countdown").textContent = mmss(summary.timer?.remainingMs || 0);
        document.getElementById("entrants").textContent = String(data.entrantCount || 0);
        document.getElementById("marketplace").textContent = "Marketplace: " + (data.marketplace?.name || "Eneba");
        document.getElementById("marketplaceNote").textContent = data.marketplace?.note || "Key purchased after winner confirms platform/region.";
        document.getElementById("platformNote").textContent = data.platformNote || "";
        document.getElementById("responseTimer").textContent = summary.responseTimer?.winnerLogin
          ? "Response timer: " + mmss(summary.responseTimer.remainingMs || 0)
          : "Response timer starts after draw.";
        const rules = document.getElementById("rules");
        rules.replaceChildren(...(data.rules || []).slice(0, 8).map((rule) => {
          const li = document.createElement("li");
          li.textContent = rule;
          return li;
        }));
        const key = winner ? winner.login + ":" + winner.drawnAt + ":" + winner.status : "";
        if (key && key !== lastWinnerKey) {
          document.getElementById("winnerPanel").classList.add("drawing");
          setTimeout(() => document.getElementById("winnerPanel").classList.remove("drawing"), 1400);
          lastWinnerKey = key;
        }
        document.getElementById("winnerName").textContent = winner?.displayName || "No winner yet";
        document.getElementById("winnerState").textContent = winner ? winner.status.replace(/_/g, " ") : "Entries not drawn";
      }
      refresh();
      setInterval(refresh, 1000);
    </script>
  </body>
</html>`;

const isDirectRun = () => {
  const entry = process.argv[1];
  return Boolean(entry && import.meta.url === pathToFileURL(entry).href);
};

if (isDirectRun()) {
  const handle = await startSetupServer();

  const shutdown = async () => {
    await handle.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}
