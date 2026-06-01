function transportModeLabel(mode = "local-user-token") {
  return mode === "relay-chatbot"
    ? "Relay Chat Bot identity"
    : "Local OAuth user token";
}

function setupModeCapabilities(mode = "local-only") {
  const local = [
    {
      label: "Twitch chat send",
      detail: "Uses the local OAuth user token while Console is running.",
      tone: "ok",
    },
    {
      label: "Twitch Chat Bot identity",
      detail:
        "Not available in Local mode; chat appears as the authorized user.",
      tone: "warn",
    },
    {
      label: "Discord announcements",
      detail:
        "Console can send direct announcements with the local Discord bot token.",
      tone: "ok",
    },
    {
      label: "Discord slash commands and suggestions",
      detail: "Not available without Relay; use local admin controls instead.",
      tone: "warn",
    },
    {
      label: "Discord server layout",
      detail: "Local mode can preview and apply the baseline server layout.",
      tone: "ok",
    },
    {
      label: "Giveaways",
      detail:
        "Local giveaway controls and OBS overlay work while Console is running.",
      tone: "ok",
    },
  ];
  const relay = [
    {
      label: "Twitch chat send",
      detail:
        "Hosted Relay sends via the paired installation and keeps Console as the operator surface.",
      tone: "ok",
    },
    {
      label: "Twitch Chat Bot identity",
      detail:
        "Available through Hosted mode after hosted validation records are complete.",
      tone: "ok",
    },
    {
      label: "Discord announcements",
      detail:
        "Relay queues slash-command announcement actions for Console review.",
      tone: "ok",
    },
    {
      label: "Discord slash commands and suggestions",
      detail: "Available through the public Relay interactions endpoint.",
      tone: "ok",
    },
    {
      label: "Discord server layout",
      detail:
        "Still applied locally from Console; Relay does not restructure servers.",
      tone: "info",
    },
    {
      label: "Giveaways",
      detail:
        "Console remains the live giveaway operator surface and OBS overlay host.",
      tone: "ok",
    },
  ];

  if (mode === "advanced") {
    return [
      {
        label: "Mode contract",
        detail: "Assisted displays local and Relay readiness separately.",
        tone: "info",
      },
      ...local.slice(0, 3),
      ...relay.slice(1, 4),
    ];
  }

  return mode === "relay-assisted" ? relay : local;
}

function dashboardStep({
  number,
  label,
  state: stepState,
  tone,
  detail,
  action,
}) {
  return h("div", { className: `dashboard-step ${tone || "muted"}` }, [
    h("span", { className: "step-number dashboard-step-number", text: number }),
    h("div", { className: "dashboard-step-copy" }, [
      h("strong", { text: label }),
      h("span", { text: detail }),
    ]),
    h("span", { className: `chip ${tone || "muted"}`, text: stepState }),
    action ? h("div", { className: "dashboard-step-action" }, [action]) : null,
  ]);
}

function renderDashboardReadinessCard(runtime, readiness) {
  const launch = currentLaunchPreparation();
  const process = runtime?.botProcess || {};
  const recovery = runtime?.outboundRecovery || {};
  const blockers = readiness.blockers || [];

  return card("Live Readiness", [
    statusGrid([
      [
        "Setup",
        isTwitchSetupReady() ? "ready" : "needed",
        isTwitchSetupReady(),
      ],
      [
        "Launch",
        launch?.status || "pending",
        ["ready", "attention"].includes(launch?.status),
      ],
      [
        "Token",
        runtime?.tokenValid ? "valid" : "not valid",
        Boolean(runtime?.tokenValid),
      ],
      [
        "Scopes",
        runtime?.requiredScopesPresent ? "present" : "missing",
        Boolean(runtime?.requiredScopesPresent),
      ],
      ["Bot", process.status || "stopped", Boolean(process.running)],
      [
        "EventSub",
        runtime?.eventSubConnected ? "connected" : "pending",
        Boolean(runtime?.eventSubConnected),
      ],
      [
        "Queue",
        runtime?.queueReady ? "ready" : "not ready",
        Boolean(runtime?.queueReady),
      ],
      ["Recovery", recovery.needed ? "needed" : "clear", !recovery.needed],
    ]),
    blockers.length
      ? list(blockers.slice(0, 3), "bad")
      : callout("No local console blockers detected.", "ok"),
    blockers.length > 3
      ? callout(
          `${blockers.length - 3} more blocker(s) are shown in Live Mode and Diagnostics.`,
          "warn",
        )
      : null,
  ]);
}

function renderDashboardGiveawayCard(statusSummary = {}) {
  const summary = state.giveaway?.summary || statusSummary || {};
  const assurance = state.giveaway?.assurance || {};
  const display = liveDisplayState(summary, state.giveaway?.recap || {});
  const failedCritical = criticalGiveawayFailures().length > 0;

  return card("Giveaway Snapshot", [
    h("div", { className: `state-banner compact ${display.tone}` }, [
      h("strong", { text: display.label }),
      h("span", { text: display.detail }),
    ]),
    statusGrid([
      ["Entries", summary.entryCount || 0, true],
      [
        "Winners",
        `${summary.winnersDrawn || 0}/${summary.winnerCount || 0}`,
        true,
      ],
      [
        "Delivery",
        Number(summary.undeliveredWinnersCount || 0) === 0
          ? "clear"
          : `${summary.undeliveredWinnersCount} pending`,
        Number(summary.undeliveredWinnersCount || 0) === 0,
      ],
      [
        "Critical Failed",
        assurance.summary?.failedCritical || 0,
        Number(assurance.summary?.failedCritical || 0) === 0,
      ],
      [
        "Queue",
        state.status?.runtime?.queue?.queued || 0,
        Number(state.status?.runtime?.queue?.queued || 0) === 0,
      ],
      [
        "Safe To End",
        summary.safeToEnd ? "yes" : "no",
        Boolean(summary.safeToEnd),
      ],
    ]),
    assurance.blockContinue
      ? callout(`Pause giveaway actions. ${assurance.nextAction}`, "bad")
      : null,
    h("div", { className: "actions" }, [
      actionButton("Open Giveaways", {
        id: "dashboardGiveawaysOpen",
        variant: "secondary",
        onClick: openGiveaways,
      }),
      actionButton("Send status", {
        id: "dashboardSendGiveawayStatus",
        variant: "secondary",
        busyKey: "sendGiveawayStatus",
        onClick: sendGiveawayStatus,
      }),
      failedCritical
        ? actionButton("Panic resend", {
            id: "dashboardPanicResendCritical",
            variant: "danger",
            busyKey: "resendCriticalGiveaway",
            onClick: resendCriticalGiveaway,
          })
        : null,
      actionButton("Copy recap", {
        id: "dashboardCopyRecap",
        variant: "secondary",
        busyKey: "copyRecap",
        onClick: copyRecap,
      }),
    ]),
  ]);
}

function renderLaunchPreparationCard() {
  const launch = currentLaunchPreparation();
  const tone = launchTone(launch);
  const checks = launch?.checks || [];
  const tokenRefresh = checks.some(
    (check) => check.ok && check.name === "Token refreshed",
  );

  return card("Automatic Launch Preparation", [
    callout(
      launch?.summary ||
        "Launch preparation will run when vaexcore console starts.",
      tone,
    ),
    statusGrid([
      ["Status", launch?.status || "pending", tone === "ok"],
      [
        "Setup",
        launch?.setupReady ? "ready" : "not ready",
        Boolean(launch?.setupReady),
      ],
      [
        "Preflight",
        launch?.preflightReady
          ? "ready"
          : launch?.preflight
            ? "attention"
            : "pending",
        Boolean(launch?.preflightReady),
      ],
      ["Token Refresh", tokenRefresh ? "refreshed" : "as needed", true],
    ]),
    launch?.nextAction ? callout(launch.nextAction, tone) : null,
    h("div", { className: "actions" }, [
      actionButton("Rerun launch checks", {
        id: "rerunLaunchPreparation",
        variant: "secondary",
        busyKey: "launchPreparation",
        onClick: runLaunchPreparation,
      }),
    ]),
  ]);
}
function renderLiveMode() {
  const readiness = getReadiness();
  return [
    sectionHeader(
      "Stream Control",
      "Compact stream-state controls for live operation.",
      actionButton("Refresh", {
        id: "liveRefresh",
        onClick: refreshAll,
        busyKey: "refresh",
      }),
    ),
    renderLiveStateCard({ prefix: "live" }),
    readiness.blockers.length
      ? card("Blockers", [list(readiness.blockers, "bad")])
      : card("Ready Summary", [callout("Twitch connection ready", "ok")]),
    renderStreamPresetCard({ prefix: "live" }),
    renderLiveRunbookCard({ prefix: "live" }),
    renderQueueHealthCard(),
    renderRecoveryChecklistCard(),
    renderPanicResendCard(),
    renderPostStreamRecapCard({ compact: true }),
    renderFailureLogCard(),
  ];
}

function renderLiveStateCard(options = {}) {
  const summary = state.giveaway?.summary || state.status?.giveaway || {};
  const assurance = state.giveaway?.assurance || {};
  const display = liveDisplayState(summary, state.giveaway?.recap || {});
  const tone = display.tone;
  const label = display.label;
  const detail = display.detail;
  const prefix = options.prefix || "liveState";

  return card("Live Giveaway State", [
    h("div", { className: `state-banner ${tone}` }, [
      h("strong", { text: label }),
      h("span", { text: detail }),
    ]),
    statusGrid([
      ["Entries", summary.entryCount || 0, true],
      [
        "Winners",
        `${summary.winnersDrawn || 0}/${summary.winnerCount || 0}`,
        true,
      ],
      [
        "Delivery",
        Number(summary.undeliveredWinnersCount || 0) === 0
          ? "clear"
          : `${summary.undeliveredWinnersCount} pending`,
        Number(summary.undeliveredWinnersCount || 0) === 0,
      ],
      [
        "Safe To End",
        summary.safeToEnd ? "yes" : "no",
        Boolean(summary.safeToEnd),
      ],
      [
        "Critical Gaps",
        assurance.summary?.missingCritical || 0,
        Number(assurance.summary?.missingCritical || 0) === 0,
      ],
      [
        "Critical Failed",
        assurance.summary?.failedCritical || 0,
        Number(assurance.summary?.failedCritical || 0) === 0,
      ],
      [
        "Chat Queue",
        state.status?.runtime?.queue?.queued || 0,
        Number(state.status?.runtime?.queue?.queued || 0) === 0,
      ],
      [
        "Bot",
        state.status?.runtime?.botProcess?.status || "stopped",
        Boolean(state.status?.runtime?.botProcess?.running),
      ],
    ]),
    assurance.blockContinue
      ? callout(
          `Do not continue giveaway operations yet. ${assurance.nextAction}`,
          "bad",
        )
      : null,
    h("div", { className: "actions live-actions" }, [
      actionButton("Send status to chat", {
        id: `${prefix}SendGiveawayStatus`,
        variant: "secondary",
        busyKey: "sendGiveawayStatus",
        onClick: sendGiveawayStatus,
      }),
      actionButton("Panic resend latest critical", {
        id: `${prefix}PanicResendCritical`,
        variant: "danger",
        busyKey: "resendCriticalGiveaway",
        onClick: resendCriticalGiveaway,
      }),
      actionButton("Run preflight", {
        id: `${prefix}RunPreflight`,
        variant: "secondary",
        busyKey: "runPreflight",
        onClick: runPreflight,
      }),
      actionButton("Copy recap", {
        id: `${prefix}CopyRecap`,
        variant: "secondary",
        busyKey: "copyRecap",
        onClick: copyRecap,
      }),
    ]),
  ]);
}

function renderStreamPresetCard(options = {}) {
  const presets = state.streamPresets || [];
  const prefix = options.prefix || "stream";

  return card("Stream Night Presets", [
    presets.length
      ? dataTable(
          [
            "Preset",
            "Custom Commands",
            "Timers",
            "Moderation",
            "Status",
            "Actions",
          ],
          presets.map((preset) => [
            preset.label,
            preset.modes?.custom_commands || "off",
            preset.modes?.timers || "off",
            preset.modes?.moderation_filters || "off",
            preset.inspection?.detail || "",
            actionButton(
              preset.inspection?.status === "current"
                ? "Applied"
                : "Apply preset",
              {
                id: `${prefix}-stream-preset-${preset.id}`,
                variant: "secondary",
                busyKey: "streamPreset",
                disabled: preset.inspection?.status === "current",
                onClick: () => applyStreamPreset(preset.id),
              },
            ),
          ]),
        )
      : callout("No stream presets are available.", "muted"),
  ]);
}

function renderLiveRunbookCard(options = {}) {
  const runbook = liveRunbookSteps();
  const primary = runbook[0];
  const blockers = getReadiness().blockers;
  const prefix = options.prefix || "runbook";

  return card("Live Runbook", [
    statusGrid([
      [
        "Current Priority",
        primary?.label || "Monitor",
        !primary || primary.tone !== "bad",
      ],
      ["Blockers", blockers.length, blockers.length === 0],
      [
        "Queue",
        state.status?.runtime?.queueHealth?.status || "unknown",
        state.status?.runtime?.queueHealth?.status !== "blocked",
      ],
      [
        "Recovery",
        state.status?.runtime?.outboundRecovery?.needed ? "needed" : "clear",
        !state.status?.runtime?.outboundRecovery?.needed,
      ],
    ]),
    primary
      ? callout(primary.detail, primary.tone)
      : callout(
          "No live runbook action needed. Keep monitoring chat and queue health.",
          "ok",
        ),
    dataTable(
      ["Priority", "State", "Action"],
      runbook.map((step, index) => [
        `${index + 1}. ${step.label}`,
        h("span", { className: step.tone || "muted", text: step.detail }),
        step.actionLabel
          ? actionButton(step.actionLabel, {
              id: `${prefix}-runbook-${step.id}`,
              variant: step.variant || "secondary",
              disabled: step.disabled,
              onClick: step.onClick,
            })
          : "",
      ]),
    ),
    h("div", { className: "actions" }, [
      actionButton("Run preflight", {
        id: `${prefix}RunbookPreflight`,
        variant: "secondary",
        busyKey: "runPreflight",
        onClick: runPreflight,
      }),
      actionButton("Copy incident note", {
        id: `${prefix}CopyIncidentNote`,
        variant: "secondary",
        busyKey: "copyIncidentNote",
        onClick: copyIncidentNote,
      }),
    ]),
  ]);
}
