import { readLocalSecrets } from "../config/localSecrets";

import {
  getBotCompletionRoute,
  getDiscordSetupSummary,
  getRelayReadinessReport,
  getSetupCapabilitySummary,
} from "./serverBotCompletion";
import { getBotProcessSnapshot } from "./serverBotProcess";
import {
  getSafeSetupChecks,
  getSetupMode,
  safeSetupCheck,
} from "./serverConfig";
import {
  getDiagnosticsReport,
  safeAuditMetadata,
  safeSupportText,
} from "./serverDiagnostics";
import { getGiveawayState } from "./serverGiveawayState";
import {
  customCommandsService,
  featureGates,
  giveawaysService,
  moderationService,
  outboundHistory,
  timersService,
} from "./serverState";

export const getSupportBundle = async () => {
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

export const summarizeRelayReadinessForSupport = (
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
