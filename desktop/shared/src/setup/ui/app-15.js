function commandPermissionChip(permission) {
  const tone =
    permission === "viewer"
      ? "ok"
      : permission === "moderator"
        ? "warn"
        : "bad";
  return h("span", { className: `chip ${tone}`, text: permission || "viewer" });
}

function renderCommandPreview() {
  if (!state.commandPreview) {
    return callout("No command preview has run yet.", "muted");
  }

  return state.commandPreview.ok
    ? callout(
        state.commandPreview.response || "Preview produced no response.",
        "ok",
      )
    : callout(state.commandPreview.error || "Preview failed.", "bad");
}

function shortId(id = "") {
  return id ? id.slice(-8) : "";
}

function importanceChip(importance = "normal") {
  const tone =
    importance === "critical"
      ? "bad"
      : importance === "important"
        ? "warn"
        : "ok";
  return h("span", { className: `chip ${tone}`, text: importance });
}

function failureCategoryChip(category = "none") {
  const tone = ["auth", "config", "twitch_rejected"].includes(category)
    ? "bad"
    : ["rate_limit", "network", "timeout", "unknown"].includes(category)
      ? "warn"
      : "muted";
  return h("span", { className: `chip ${tone}`, text: category || "none" });
}

function queueTone(status) {
  if (status === "blocked") return "bad";
  if (status === "watch") return "warn";
  return "ok";
}

function giveawayOutboundMessages() {
  const giveawayId = state.giveaway?.giveaway?.id;
  const messages = (state.outboundMessages || [])
    .filter((item) => item.category === "giveaway")
    .sort((a, b) =>
      String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
    );

  if (!giveawayId) {
    return messages;
  }

  return messages.filter(
    (item) => Number(item.giveawayId) === Number(giveawayId),
  );
}

function criticalGiveawayFailures() {
  const giveawayId = state.giveaway?.giveaway?.id;
  const failures = (state.outboundMessages || [])
    .filter(
      (item) =>
        item.category === "giveaway" &&
        item.importance === "critical" &&
        item.status === "failed",
    )
    .sort((a, b) =>
      String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
    );
  const current =
    giveawayId === undefined
      ? []
      : failures.filter(
          (item) => Number(item.giveawayId) === Number(giveawayId),
        );

  return current.length ? current : failures;
}

function outboundFailureLogs(logs = []) {
  return logs.filter((line) =>
    /Outbound chat send failed|outboundStatus.*failed|retry limit|message dropped/i.test(
      line,
    ),
  );
}

function postStreamRecapText() {
  const recap = state.giveaway?.recap || {};
  const summary = state.giveaway?.summary || {};
  const assurance = state.giveaway?.assurance || {};

  if (!recap.available) {
    return "No giveaway recap available yet.";
  }

  const winners = (recap.winners || []).length
    ? (recap.winners || []).map(
        (winner) =>
          `- ${winner.displayName} (@${winner.login}) - ${winner.delivered ? "delivered" : "pending delivery"}`,
      )
    : ["- No active winners recorded."];

  return [
    `Giveaway: #${recap.id} ${recap.title}`,
    `State: ${summary.operatorState || recap.status}`,
    `Entries: ${recap.entryCount || 0}`,
    `Winners: ${recap.activeWinnerCount || 0}`,
    `Pending delivery: ${recap.pendingDeliveryCount || 0}`,
    `Critical chat sent: ${recap.sentMessageCount || 0}`,
    `Critical chat resent: ${recap.resentMessageCount || 0}`,
    `Critical chat pending: ${recap.pendingMessageCount || 0}`,
    `Critical chat failed: ${recap.criticalFailedCount || 0}`,
    `Missing critical phases: ${recap.missingCriticalCount || 0}`,
    `Next action: ${assurance.nextAction || "none"}`,
    "Winner list:",
    ...winners,
  ].join("\n");
}

function postStreamReviewData() {
  const recap = state.giveaway?.recap || {};
  const summary = state.giveaway?.summary || state.status?.giveaway || {};
  const runtime = state.status?.runtime || {};
  const botProcess = runtime.botProcess || {};
  const outboundMessages = state.outboundMessages || [];
  const outboundFailures = outboundMessages.filter(
    (message) => message.status === "failed",
  );
  const giveawayMessages = outboundMessages.filter(
    (message) => message.category === "giveaway",
  );
  const botErrors = (botProcess.recentLogs || []).filter((line) =>
    /failed|error/i.test(line),
  );
  const audit = (state.auditLogs || []).slice(0, 20).map((log) => ({
    createdAt: log.created_at,
    actor: log.actor_twitch_user_id,
    action: log.action,
    target: log.target || "",
    metadata: summarizeMetadata(log.metadata_json),
  }));
  const pendingDelivery = Number(
    recap.pendingDeliveryCount ?? summary.undeliveredWinnersCount ?? 0,
  );
  const criticalFailed = Number(
    recap.criticalFailedCount ?? state.outboundSummary?.criticalFailed ?? 0,
  );
  const pendingCritical = Number(
    recap.pendingCriticalCount ??
      state.giveaway?.assurance?.summary?.pendingCritical ??
      0,
  );
  const blockingCritical = Number(
    recap.blockingCriticalCount ??
      state.giveaway?.assurance?.summary?.blockingCritical ??
      0,
  );
  const failed = Number(
    state.outboundSummary?.failed ?? outboundFailures.length,
  );
  const tone =
    criticalFailed > 0 || blockingCritical > 0 || botErrors.length > 0
      ? "bad"
      : pendingDelivery > 0 || pendingCritical > 0 || failed > 0
        ? "warn"
        : "ok";
  const nextAction =
    blockingCritical > 0
      ? "Review critical giveaway chat delivery before the next live run."
      : criticalFailed > 0
        ? "Review and recover failed critical giveaway chat before the next live run."
        : pendingDelivery > 0
          ? "Confirm manual prize delivery notes before closing the night."
          : failed > 0
            ? "Review outbound failures and decide whether any follow-up is needed."
            : "Post-stream review is clear.";

  return {
    generatedAt: new Date().toISOString(),
    tone,
    nextAction,
    runtime: {
      mode: runtime.mode || "",
      botStatus: botProcess.status || "",
      eventSubConnected: Boolean(runtime.eventSubConnected),
      chatSubscriptionActive: Boolean(runtime.chatSubscriptionActive),
      liveChatConfirmed: Boolean(runtime.liveChatConfirmed),
      errorCount: botErrors.length,
      recentErrors: botErrors.slice(-8),
    },
    giveaway: {
      available: Boolean(recap.available),
      id: recap.id || state.giveaway?.giveaway?.id || "",
      title: recap.title || summary.title || "",
      status: recap.status || summary.status || "none",
      entries: Number(recap.entryCount ?? summary.entryCount ?? 0),
      activeWinnerCount: Number(
        recap.activeWinnerCount ?? summary.winnersDrawn ?? 0,
      ),
      pendingDelivery,
      deliveredWinnerCount: Number(recap.deliveredWinnerCount ?? 0),
      winners: (recap.winners || []).map((winner) => ({
        displayName: winner.displayName,
        login: winner.login,
        delivered: Boolean(winner.delivered),
      })),
    },
    outbound: {
      total: Number(state.outboundSummary?.total ?? outboundMessages.length),
      sent: Number(state.outboundSummary?.sent ?? 0),
      resent: Number(state.outboundSummary?.resent ?? 0),
      pending: Number(state.outboundSummary?.pending ?? 0),
      failed,
      criticalFailed,
      pendingCritical,
      blockingCritical,
      retries: outboundMessages.filter(
        (message) => Number(message.attempts || 0) > 1,
      ).length,
      giveawayTracked: giveawayMessages.length,
      failures: outboundFailures.map((message) => ({
        id: message.id,
        source: message.source,
        action: message.action || "",
        failureCategory: message.failureCategory || "none",
        status: message.status,
        attempts: message.attempts || 0,
        updatedAt: message.updatedAt || "",
        reason: message.reason || "",
        message: message.message || "",
      })),
    },
    audit,
    incident: incidentNoteText(),
  };
}

function postStreamReviewText() {
  const review = postStreamReviewData();
  const winners = review.giveaway.winners.length
    ? review.giveaway.winners.map(
        (winner) =>
          `- ${winner.displayName} (@${winner.login}) - ${winner.delivered ? "delivered" : "pending delivery"}`,
      )
    : ["- No winner rows available."];
  const failures = review.outbound.failures.length
    ? review.outbound.failures
        .slice(0, 8)
        .map(
          (failure) =>
            `- ${failure.updatedAt} ${failure.action || "message"} ${failure.failureCategory}: ${failure.reason || formatMessagePreview(failure.message)}`,
        )
    : ["- No outbound failures tracked."];

  return [
    `Post-stream review - ${review.generatedAt}`,
    `Next action: ${review.nextAction}`,
    `Bot: ${review.runtime.botStatus}`,
    `EventSub: ${review.runtime.eventSubConnected ? "connected" : "not connected"}`,
    `Live chat: ${review.runtime.liveChatConfirmed ? "confirmed" : "pending"}`,
    `Giveaway: ${review.giveaway.status} ${review.giveaway.title}`.trim(),
    `Entries: ${review.giveaway.entries}`,
    `Winners: ${review.giveaway.activeWinnerCount}`,
    `Pending delivery: ${review.giveaway.pendingDelivery}`,
    `Outbound failed: ${review.outbound.failed}`,
    `Critical failed: ${review.outbound.criticalFailed}`,
    `Critical pending: ${review.outbound.pendingCritical}`,
    `Blocking critical: ${review.outbound.blockingCritical}`,
    `Retries: ${review.outbound.retries}`,
    "Winners:",
    ...winners,
    "Outbound failures:",
    ...failures,
  ].join("\n");
}

function formatMessagePreview(message = "") {
  return message.length > 120 ? `${message.slice(0, 117)}...` : message;
}

function desktopDistributionLabel(platform) {
  if (platform === "win32") {
    return "manual Windows build";
  }

  if (platform === "darwin") {
    return "manual unsigned zip";
  }

  return "manual desktop build";
}

function desktopUpdateMethod(platform) {
  if (platform === "win32") {
    return "quit app, replace installed Windows app";
  }

  if (platform === "darwin") {
    return "quit app, replace vaexcore console.app";
  }

  return "quit app, replace desktop app";
}

function desktopUpdateNote(platform) {
  if (platform === "win32") {
    return "Manual updates should replace only the installed vaexcore console app files. Keep the AppData folder unless you intentionally want to reset Twitch setup and local data.";
  }

  if (platform === "darwin") {
    return "Manual updates should replace only vaexcore console.app. Keep the Application Support folder unless you intentionally want to reset Twitch setup and local data.";
  }

  return "Manual updates should replace only the app files. Keep the app data folder unless you intentionally want to reset Twitch setup and local data.";
}
async function fetchFreshState() {
  const [
    config,
    status,
    launchPreparation,
    giveaway,
    commands,
    timers,
    moderation,
    templates,
    operatorMessages,
    reminder,
    audit,
    outbound,
    diagnostics,
    featureGateResult,
    streamPresetResult,
    suiteStatus,
    twitchOps,
    discordStatus,
    discordRelayStatus,
    botCompletion,
  ] = await Promise.all([
    api.config(),
    api.status(),
    api.launchPreparation(),
    api.giveaway(),
    api.commands(),
    api.timers(),
    api.moderation(),
    api.templates(),
    api.operatorMessages(),
    api.reminder(),
    api.auditLogs(),
    api.outboundMessages(),
    api.diagnostics(),
    api.featureGates(),
    api.streamPresets(),
    api.suiteStatus(),
    api.twitchCreatorOps(),
    api.discordStatus(),
    api.discordRelayStatus(),
    api.botCompletion(),
  ]);
  return {
    config,
    status,
    launchPreparation,
    giveaway,
    commands,
    timers,
    moderation,
    templates,
    operatorMessages,
    reminder,
    audit,
    outbound,
    diagnostics,
    featureGateResult,
    streamPresetResult,
    suiteStatus,
    twitchOps,
    discordStatus,
    discordRelayStatus,
    botCompletion,
  };
}

function applyFreshState(snapshot) {
  const {
    config,
    status,
    launchPreparation,
    giveaway,
    commands,
    timers,
    moderation,
    templates,
    operatorMessages,
    reminder,
    audit,
    outbound,
    diagnostics,
    featureGateResult,
    streamPresetResult,
    suiteStatus,
    twitchOps,
    discordStatus,
    discordRelayStatus,
    botCompletion,
  } = snapshot;

  state.config = config;
  state.status = status;
  syncLaunchPreparation(launchPreparation);
  state.giveaway = giveaway;
  setCommandState(commands);
  setTimerState(timers);
  setModerationState(moderation);
  state.templates = templates.templates || [];
  state.operatorMessages = operatorMessages.templates || [];
  state.reminder = reminder.reminder || {};
  state.auditLogs = audit.logs || [];
  state.outboundMessages = outbound.messages || [];
  state.outboundSummary = outbound.summary || {};
  state.diagnostics = diagnostics;
  state.featureGates = featureGateResult.featureGates || [];
  state.streamPresets = streamPresetResult.presets || [];
  state.suiteStatus = suiteStatus;
  state.twitchOps = twitchOps;
  state.discord = discordStatus;
  state.discordRelayStatus = discordRelayStatus;
  state.botCompletion = botCompletion;
  syncLaunchPreparation(status);
  syncLaunchPreparation(diagnostics);
  state.validSetup = isValidationPassed();
}

async function loadFreshState() {
  const snapshot = await fetchFreshState();
  applyFreshState(snapshot);
  return { ok: true };
}

async function refreshAll(options = {}) {
  if (options.background) {
    if (backgroundRefreshPromise) {
      return backgroundRefreshPromise;
    }

    const refreshGeneration = foregroundRefreshGeneration;
    backgroundRefreshPromise = fetchFreshState()
      .then((snapshot) => {
        if (
          refreshGeneration === foregroundRefreshGeneration &&
          state.busy.size === 0
        ) {
          applyFreshState(snapshot);
        }
        return { ok: true };
      })
      .catch((error) => {
        lastBackgroundError = error.message || "Refresh failed.";
        console.debug(
          "Background refresh skipped visible update:",
          lastBackgroundError,
        );
        return null;
      })
      .finally(() => {
        backgroundRefreshPromise = null;
      });

    return backgroundRefreshPromise;
  }

  await runAction("refresh", loadFreshState, { quiet: true });
}
