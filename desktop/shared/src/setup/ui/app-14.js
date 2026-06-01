function liveRunbookSteps() {
  const runtime = state.status?.runtime || {};
  const summary = state.giveaway?.summary || state.status?.giveaway || {};
  const recovery = runtime.outboundRecovery || {};
  const health = runtime.queueHealth || {};
  const process = runtime.botProcess || {};
  const launch = currentLaunchPreparation();
  const steps = [];

  if (!isTwitchSetupReady()) {
    steps.push({
      id: "setup-guide",
      label: "Complete setup",
      detail:
        "Setup is incomplete. Open Configuration Settings -> Setup Guide.",
      tone: "bad",
      actionLabel: "Open Setup Guide",
      onClick: openSetupGuide,
    });
    return steps;
  }

  if (!runtime.tokenValid || !runtime.requiredScopesPresent) {
    steps.push({
      id: "validate",
      label:
        launch?.status === "running"
          ? "Wait for validation"
          : "Reconnect Twitch",
      detail:
        launch?.status === "running"
          ? "Automatic launch validation is checking the saved Twitch token."
          : "Automatic validation could not confirm the saved Twitch token and scopes.",
      tone: launch?.status === "running" ? "warn" : "bad",
      actionLabel: "Rerun launch checks",
      onClick: runLaunchPreparation,
    });
    return steps;
  }

  if (!process.running) {
    steps.push({
      id: "start-bot",
      label: "Start bot",
      detail: "The live bot listener is stopped.",
      tone: "warn",
      actionLabel: "Start Bot",
      onClick: startBot,
      disabled: !canStartBot(runtime),
    });
  } else if (!runtime.eventSubConnected || !runtime.chatSubscriptionActive) {
    steps.push({
      id: "wait-eventsub",
      label: "Wait for chat listener",
      detail:
        "Bot is starting. Wait for EventSub and chat subscription to become active.",
      tone: "warn",
    });
  } else if (!runtime.liveChatConfirmed) {
    steps.push({
      id: "confirm-chat",
      label: "Confirm chat",
      detail: "Type !ping in Twitch chat and wait for LIVE CHAT CONFIRMED.",
      tone: "warn",
    });
  }

  if (recovery.needed && recovery.severity === "critical") {
    steps.push({
      id: "critical-recovery",
      label: "Recover critical chat",
      detail:
        recovery.nextAction || "Resolve the failed critical outbound message.",
      tone: "bad",
      actionLabel: "Panic resend",
      variant: "danger",
      disabled: !state.validSetup,
      onClick: resendCriticalGiveaway,
    });
  } else if (recovery.needed) {
    steps.push({
      id: "outbound-recovery",
      label: "Review outbound failure",
      detail: recovery.nextAction || "Review the failed outbound message.",
      tone: "warn",
    });
  }

  if (health.status === "blocked" || health.status === "watch") {
    steps.push({
      id: "queue-health",
      label: "Watch queue",
      detail:
        health.nextAction || "Watch Queue Health until pending messages clear.",
      tone: health.status === "blocked" ? "bad" : "warn",
    });
  }

  if (summary.status === "open") {
    steps.push({
      id: "close-giveaway",
      label: "Close before draw",
      detail:
        "Giveaway entries are open. Close entries before drawing winners.",
      tone: "ok",
      actionLabel: "Close entries",
      onClick: () => runGiveawayAction("close"),
    });
  } else if (
    summary.status === "closed" &&
    Number(summary.winnersDrawn || 0) === 0
  ) {
    steps.push({
      id: "draw-winners",
      label: "Draw winners",
      detail: "Entries are closed and no winners are drawn yet.",
      tone: "ok",
      actionLabel: "Draw winners",
      onClick: () =>
        runGiveawayAction(
          "draw",
          { count: Number(field("drawCount")?.value || suggestedDrawCount()) },
          "Draw winners now?",
        ),
    });
  } else if (Number(summary.undeliveredWinnersCount || 0) > 0) {
    steps.push({
      id: "deliver-prizes",
      label: "Finish delivery",
      detail: `${summary.undeliveredWinnersCount} winner(s) still need manual delivery.`,
      tone: "warn",
      actionLabel: "Open Giveaways",
      onClick: openGiveaways,
    });
  } else if (summary.safeToEnd) {
    steps.push({
      id: "end-giveaway",
      label: "End giveaway",
      detail: "Active winners are marked delivered. The giveaway can be ended.",
      tone: "ok",
      actionLabel: "End giveaway",
      variant: "danger",
      onClick: endGiveaway,
    });
  } else if (summary.status === "none") {
    steps.push({
      id: "ready",
      label: "Ready",
      detail: "Giveaway controls are ready when stream operations need them.",
      tone: "ok",
      actionLabel: "Open Giveaways",
      onClick: openGiveaways,
    });
  }

  return steps.length
    ? steps
    : [
        {
          id: "monitor",
          label: "Monitor",
          detail:
            "No immediate live action needed. Keep watching chat and queue health.",
          tone: "ok",
        },
      ];
}

function liveDisplayState(summary = {}, recap = {}) {
  if (
    (summary.status || "none") === "none" &&
    recap.available &&
    recap.status === "ended"
  ) {
    const pending = Number(recap.pendingDeliveryCount || 0);
    return {
      label: "giveaway ended",
      detail:
        pending > 0
          ? `${pending} winner(s) remained pending at end.`
          : "Post-stream recap is ready.",
      tone: pending > 0 ? "warn" : "ok",
    };
  }

  return {
    label: summary.operatorState || "loading",
    detail: summary.operatorStateDetail || "Waiting for giveaway state.",
    tone: summary.operatorStateTone || "muted",
  };
}

function nextGiveawayAction(summary = {}) {
  if (summary.status === "open") return "Close entries before drawing winners";
  if (summary.status === "closed" && Number(summary.winnersDrawn || 0) === 0)
    return "Draw winners";
  if (Number(summary.undeliveredWinnersCount || 0) > 0)
    return "Complete manual prize delivery";
  return "End the giveaway when operator work is complete";
}

function getSetupProgress() {
  const config = state.config || {};
  const validationPassed = isValidationPassed();
  const progress = {
    appCreated: Boolean(config.hasClientId || config.hasClientSecret),
    credentialsEntered: Boolean(
      config.hasClientId && config.hasClientSecret && config.redirectUri,
    ),
    usernamesEntered: Boolean(config.broadcasterLogin && config.botLogin),
    twitchConnected: Boolean(config.hasAccessToken),
    validationPassed,
    testMessageSent: Boolean(state.testMessageSent),
  };

  return {
    ...progress,
    steps: [
      { id: "app", label: "App created", complete: progress.appCreated },
      {
        id: "credentials",
        label: "Credentials entered",
        complete: progress.credentialsEntered,
      },
      {
        id: "users",
        label: "Usernames entered",
        complete: progress.usernamesEntered,
      },
      {
        id: "connect",
        label: "Twitch connected",
        complete: progress.twitchConnected,
      },
      {
        id: "validate",
        label: "Auto validation passed",
        complete: progress.validationPassed,
      },
      {
        id: "test",
        label: "Test message sent",
        complete: progress.testMessageSent,
      },
    ],
  };
}

function isTwitchSetupReady() {
  return isValidationPassed();
}

function canStartBot(runtime = state.status?.runtime || {}) {
  return Boolean(
    isTwitchSetupReady() &&
    runtime.tokenValid &&
    runtime.requiredScopesPresent &&
    runtime.queueReady,
  );
}

function isValidationPassed() {
  const config = state.config || {};
  const discordConfig = state.discord?.config || config.discord || {};
  const runtime = state.status?.runtime || {};
  return Boolean(
    config.hasAccessToken &&
    config.hasBotUserId &&
    config.hasBroadcasterUserId &&
    runtime.tokenValid &&
    runtime.requiredScopesPresent &&
    hasRequiredScopes(),
  );
}

function hasRequiredScopes() {
  const config = state.config || {};
  const required = config.requiredScopes || [
    "user:read:chat",
    "user:write:chat",
    "channel:read:stream_key",
  ];
  return required.every((scope) => hasScope(scope));
}

function hasScope(scope) {
  return Boolean((state.config?.scopes || []).includes(scope));
}

function giveawayChecklist() {
  const summary = state.giveaway?.summary || {};
  const status = summary.status || "none";
  const winners = state.giveaway?.winners || [];
  const activeWinners = winners.filter((winner) => !winner.rerolled_at);
  const checklist = [
    status === "none"
      ? "Start is available because no giveaway exists."
      : "Start is disabled because a giveaway already exists.",
    status === "open"
      ? "Close is available while entries are open."
      : "Close is disabled unless entries are open.",
    status === "closed"
      ? "Draw is available because entries are closed."
      : "Draw is disabled until the giveaway is closed.",
    status !== "none"
      ? "End is available after confirmation."
      : "End is disabled because no giveaway exists.",
    status === "open"
      ? "Last call is available while entries are open."
      : "Last call is disabled unless entries are open.",
    activeWinners.length
      ? "Claim, deliver, and reroll controls have eligible winners."
      : "Claim, deliver, and reroll are disabled until winners exist.",
  ];

  if (state.giveaway?.assurance?.blockContinue) {
    checklist.unshift(
      `Resolve chat assurance before continuing: ${state.giveaway.assurance.nextAction}`,
    );
  }

  if (Number(state.giveaway?.assurance?.summary?.pendingCritical || 0) > 0) {
    checklist.unshift(
      "Wait for pending critical giveaway chat sends to confirm before moving to the next phase.",
    );
  }

  return checklist;
}

function missingConfigFields(config = {}) {
  const missing = [];
  if (!config.hasClientId) missing.push("Client ID");
  if (!config.hasClientSecret) missing.push("Client Secret");
  if (!config.redirectUri) missing.push("Redirect URI");
  if (!config.broadcasterLogin) missing.push("Broadcaster Login");
  if (!config.botLogin) missing.push("Bot Login");
  return missing;
}

function missingCredentialLabels(config = {}) {
  const missing = [];
  if (!config.hasClientId) missing.push("Client ID");
  if (!config.hasClientSecret) missing.push("Client Secret");
  if (!config.redirectUri) missing.push("Redirect URI");
  return missing;
}

function botLoginReconnectCallout(config = {}) {
  if (!config.hasAccessToken || !config.botLogin || config.hasBotUserId) {
    return null;
  }

  return callout(
    `Bot Login is ${config.botLogin}, but the connected OAuth token has not validated for that account. Disconnect Twitch if needed, log into Twitch as ${config.botLogin}, click Connect Twitch as Bot Login, then let launch checks validate automatically.`,
    "warn",
  );
}

function filterWinners(winners) {
  if (state.winnerFilter === "pending")
    return winners.filter(
      (winner) => !winner.rerolled_at && !winner.delivered_at,
    );
  if (state.winnerFilter === "delivered")
    return winners.filter((winner) => winner.delivered_at);
  if (state.winnerFilter === "rerolled")
    return winners.filter((winner) => winner.rerolled_at);
  return winners;
}

function activeWinnerList() {
  return (state.giveaway?.winners || []).filter(
    (winner) => !winner.rerolled_at,
  );
}

function winnerStatus(winner) {
  const chips = ["drawn"];
  if (winner.claimed_at) chips.push("claimed");
  if (winner.delivered_at) chips.push("delivered");
  if (winner.rerolled_at) chips.push("rerolled");
  return h(
    "span",
    {},
    chips.map((chip) =>
      h("span", {
        className: `chip ${chip === "rerolled" ? "warn" : "ok"}`,
        text: chip,
      }),
    ),
  );
}

function featureGate(key) {
  return (
    (state.featureGates || []).find((gate) => gate.key === key) ||
    (key === "custom_commands" ? state.commandFeatureGate : null) ||
    (key === "timers" ? state.timerFeatureGate : null) ||
    (key === "moderation_filters" ? state.moderationFeatureGate : null) || {
      key,
      label: key,
      mode: "off",
      liveAllowed: false,
      testAllowed: false,
    }
  );
}

function featureGateSummary(gate = {}) {
  if (gate.mode === "live") {
    return `${gate.label || "Feature"} is enabled for Twitch chat and local simulation.`;
  }

  if (gate.mode === "test") {
    return `${gate.label || "Feature"} is available for local simulation only. Twitch chat will not trigger it.`;
  }

  return `${gate.label || "Feature"} is off. Use Test for local validation or Live when ready for Twitch chat.`;
}

function selectedCustomCommand() {
  return (state.commands || []).find(
    (command) => Number(command.id) === Number(state.selectedCommandId),
  );
}

function selectedTimer() {
  return (state.timers || []).find(
    (timer) => Number(timer.id) === Number(state.selectedTimerId),
  );
}

function filteredCustomCommands() {
  const query = state.commandFilter.trim().replace(/^!/, "").toLowerCase();
  const commands = state.commands || [];

  if (!query) {
    return commands;
  }

  return commands.filter(
    (command) =>
      command.name.includes(query) ||
      (command.aliases || []).some((alias) => alias.includes(query)) ||
      command.permission.includes(query),
  );
}

function statusChip(status) {
  const tone = ["sent", "resent"].includes(status)
    ? "ok"
    : status === "failed"
      ? "bad"
      : status === "enabled"
        ? "ok"
        : status === "disabled"
          ? "muted"
          : ["not-reached", "none"].includes(status)
            ? "muted"
            : "warn";
  return h("span", { className: `chip ${tone}`, text: status || "unknown" });
}
