import {
  MessageQueue,
  type MessageQueueEventStatus,
  type MessageQueueMetadata,
} from "../core/messageQueue";
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
  defaultRedirectUri,
  getLocalSecretsPath,
  readLocalSecrets,
  writeLocalSecrets,
  type LocalSecrets,
} from "../config/localSecrets";
import {
  giveawayOverlayHtml,
  redirect,
  sendHtml,
  sendPlatformHtml,
  sendStaticUiAsset,
  sendText,
  setupShellHtml,
  getSetupUiDir,
  resolveSetupUiAssetPath,
  securityHeaders,
} from "./staticUi";
import { TimersService, timerMetadata } from "../modules/timers/timers.module";
import { basename, dirname, join, resolve } from "node:path";
import { createDbClient, resolveDatabasePath } from "../db/client";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getRecentAuditLogs, writeAuditLog } from "../core/auditLog";
import {
  getBotCompletionRoute,
  getDiscordSetupSummary,
  getRelayReadinessReport,
  getSetupCapabilitySummary,
} from "./serverBotCompletion";
import { getBotProcessSnapshot } from "./serverBotProcess";
import {
  getSafeConfig,
  getSafeSetupChecks,
  getSetupMode,
  safeSetupCheck,
} from "./serverConfig";
import { canSendConfiguredChat } from "./serverGiveawayActions";
import {
  getGiveawayState,
  summarizeGiveawayState,
} from "./serverGiveawayState";
import {
  getLaunchPreparationSnapshot,
  launchPreparation,
} from "./serverLaunchPreparation";
import { latestFailedCriticalGiveawayMessage } from "./serverOutbound";
import {
  botProcess,
  chatQueue,
  customCommandsService,
  databaseUrl,
  db,
  featureGates,
  giveawaysService,
  moderationService,
  outboundHistory,
  queueStaleWarningMs,
  timersService,
} from "./serverState";
import { timerNeedsActivity } from "./serverTimers";

export type DiagnosticCheck = {
  name: string;
  ok: boolean;
  severity: "blocker" | "warning" | "info";
  detail: string;
};

export const getDiagnosticsReport = () => {
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

export const summarizeTimers = (
  timers: ReturnType<TimersService["listTimers"]>,
) => ({
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

export const getDiagnosticChecks = (input: {
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

export const getFirstRunStatus = (input: {
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

export const missingSafeConfigFields = (
  config: ReturnType<typeof getSafeConfig>,
) => {
  const missing: string[] = [];
  if (!config.hasClientId) missing.push("Client ID");
  if (!config.hasClientSecret) missing.push("Client Secret");
  if (!config.redirectUri) missing.push("Redirect URI");
  if (!config.broadcasterLogin) missing.push("Broadcaster Login");
  if (!config.botLogin) missing.push("Bot Login");
  if (!config.hasAccessToken) missing.push("Twitch OAuth");
  return missing;
};

export const firstRunRecoverySteps = (input: {
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

export const getDatabaseDiagnostics = () => {
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

export const getSetupUiDiagnostics = () => {
  const dir = getSetupUiDir();
  return {
    dir,
    appJs: existsSync(join(dir, "app.js")),
    stylesCss: existsSync(join(dir, "styles.css")),
    logoJpg: Boolean(resolveSetupUiAssetPath("logo.jpg")),
  };
};

export const getPackageInfo = () => {
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

export const getRuntimeKind = () => {
  if (process.versions.electron) {
    return "electron";
  }

  return dirname(fileURLToPath(import.meta.url)).includes("dist-bundle")
    ? "bundled-node"
    : "source-tsx";
};

export const safeDatabaseUrl = (value: string) => {
  if (value === ":memory:") {
    return value;
  }

  if (value.startsWith("file:")) {
    return "file:<local sqlite path>";
  }

  return "<local sqlite path>";
};

export const safeAuditMetadata = (raw: string) => {
  try {
    return redactSecrets(JSON.parse(raw));
  } catch {
    return safeSupportText(raw);
  }
};

export const safeSupportText = (value: unknown) =>
  redactSecretText(String(value ?? ""));

export const summarizeQueueHealth = (
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

export const summarizeOutboundRecovery = () => {
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

export const outboundRecoveryNextAction = (
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

export const outboundRecoverySteps = (
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

export const formatDuration = (ageMs: number) => {
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

export const isSafeConfigComplete = () => {
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
