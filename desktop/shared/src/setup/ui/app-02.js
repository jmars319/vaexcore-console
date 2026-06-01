function readyForStreamTone() {
  const rehearsal = state.localRehearsal || {};
  if (rehearsal.status === "ready") return "ok";
  if (rehearsal.generatedAt) return "warn";
  return getReadiness().ready ? "ok" : "warn";
}

function readyForStreamLabel() {
  const rehearsal = state.localRehearsal || {};
  if (rehearsal.status === "ready") return "Code-only rehearsal ready";
  if (rehearsal.generatedAt) return "Review rehearsal items";
  return "Run local rehearsal";
}

function setupCheckStatusLabel(check = {}) {
  if (!check.status) return "not checked";
  return check.checkedAt
    ? `${check.status} at ${check.checkedAt}`
    : check.status;
}

function renderDashboardStartCard(runtime, readiness) {
  const launch = currentLaunchPreparation();
  const process = runtime?.botProcess || {};
  const setupReady = isTwitchSetupReady();
  const launchReady = Boolean(launch?.setupReady);
  const botRunning = Boolean(process.running);
  const botStartReady = canStartBot(runtime);
  const chatConfirmed = Boolean(runtime?.liveChatConfirmed);
  const giveawayStatus =
    state.giveaway?.summary?.status || state.status?.giveaway?.status || "none";
  const primary = liveRunbookSteps()[0];

  return card("Start Here", [
    callout(
      readiness.nextAction || primary?.detail || "Review startup steps.",
      readiness.ready ? "ok" : "warn",
    ),
    h("div", { className: "dashboard-steps" }, [
      dashboardStep({
        number: "1",
        label: "Settings",
        state: setupReady ? "complete" : "needed",
        tone: setupReady ? "ok" : "warn",
        detail: setupReady
          ? "Twitch OAuth, required scopes, and account IDs are ready."
          : "Finish Twitch credentials, Bot Login, and OAuth in the settings window.",
        action: actionButton(setupReady ? "Settings" : "Open setup", {
          id: "dashboardOpenSettings",
          variant: "secondary",
          onClick: () => openSettingsWindow(setupReady ? "" : "#setupGuide"),
        }),
      }),
      dashboardStep({
        number: "2",
        label: "Launch checks",
        state: launch?.status || "pending",
        tone: launchTone(launch),
        detail:
          launch?.summary || "Automatic launch checks run when the app starts.",
        action: actionButton("Rerun", {
          id: "dashboardRerunLaunchPreparation",
          variant: "secondary",
          busyKey: "launchPreparation",
          onClick: runLaunchPreparation,
        }),
      }),
      dashboardStep({
        number: "3",
        label: "Bot listener",
        state: botRunning ? "running" : "stopped",
        tone: botRunning ? "ok" : botStartReady ? "warn" : "bad",
        detail: botRunning
          ? "The live bot process is running."
          : botStartReady
            ? "Start the bot process before relying on live chat actions."
            : "Automatic validation must pass before the bot can start.",
        action: botRunning
          ? actionButton("Stop", {
              id: "botStop",
              variant: "secondary",
              onClick: stopBot,
            })
          : actionButton("Start", {
              id: "botStart",
              variant: "secondary",
              disabled: !botStartReady,
              onClick: startBot,
            }),
      }),
      dashboardStep({
        number: "4",
        label: "Chat check",
        state: chatConfirmed ? "confirmed" : "pending",
        tone: chatConfirmed ? "ok" : "warn",
        detail: chatConfirmed
          ? "Live chat response is confirmed."
          : "After the bot starts, type !ping in Twitch chat to confirm the listener.",
        action: actionButton("Live Mode", {
          id: "dashboardOpenLiveMode",
          variant: "secondary",
          onClick: openLiveMode,
        }),
      }),
      dashboardStep({
        number: "5",
        label: "Giveaway tools",
        state: giveawayStatus,
        tone: giveawayStatus === "none" ? "muted" : "ok",
        detail:
          giveawayStatus === "none"
            ? "Open giveaway controls when you are ready to run one."
            : "A giveaway is active or recently available for follow-up.",
        action: actionButton("Open", {
          id: "dashboardOpenGiveaways",
          variant: "secondary",
          onClick: openGiveaways,
        }),
      }),
    ]),
  ]);
}

function renderBotCompletionCard(context = "default") {
  const title =
    context === "discord" ? "Bot Completion" : "Bot Completion Status";

  return card(title, renderBotCompletionContent());
}

function renderAdvancedReadinessDetails(open = false) {
  return h(
    "details",
    disclosureAttributes("settings:advanced-readiness", open, {
      className: "panel advanced-panel",
    }),
    [
      h("summary", {}, [h("strong", { text: "Advanced readiness details" })]),
      ...renderBotCompletionContent(),
    ],
  );
}

function renderBotCompletionContent() {
  const completion = state.botCompletion || {};
  const checks = completion.checks || [];
  const validation = completion.validation?.checklist || [];
  const pending = checks.filter((check) => !check.complete);
  const nextActions = completion.nextActions || [];
  const sections = completion.sections?.length
    ? completion.sections
    : clientBotCompletionSections(checks);
  const statusLabel =
    completion.statusLabel || botCompletionStatusLabel(completion.status);
  const statusDetail =
    completion.statusDetail ||
    nextActions[0] ||
    "Run bot completion refresh to load readiness.";
  const relaySummary = completion.relayReadinessReport?.report?.summary;

  return [
    statusGrid([
      [
        "Overall",
        completion.completionPercent !== undefined
          ? `${completion.completionPercent}%`
          : "not checked",
        completion.completionPercent === 100,
      ],
      [
        "Mode",
        setupModeLabel(completion.setupMode || state.config?.setupMode),
        Boolean(completion.setupMode || state.config?.setupMode),
      ],
      [
        "Transport",
        transportModeLabel(
          completion.transportMode || state.config?.relay?.twitchTransportMode,
        ),
        completion.transportMode === "relay-chatbot",
      ],
      ["State", statusLabel || "not checked", completion.status === "ready"],
      [
        "Last checked",
        completion.generatedAt || "not checked",
        Boolean(completion.generatedAt),
      ],
      [
        "Relay",
        relaySummary?.state ||
          (completion.relayReadinessReport?.connected
            ? "connected"
            : "not ready"),
        Boolean(completion.relayReadinessReport?.connected),
      ],
      ["Pending", pending.length, pending.length === 0 && checks.length > 0],
    ]),
    completion.status
      ? callout(statusDetail, botCompletionTone(statusLabel))
      : callout("Run bot completion refresh to load readiness.", "muted"),
    h(
      "div",
      { className: "bot-completion-sections" },
      sections.map(renderBotCompletionSection),
    ),
    nextActions.length
      ? h("div", { className: "bot-next-actions" }, [
          h("strong", { text: "Next actions" }),
          list(nextActions, "warn"),
        ])
      : callout("No pending bot setup actions reported.", "ok"),
    validation.length
      ? h("div", { className: "bot-validation-records" }, [
          h("strong", { text: "Manual validation records" }),
          h(
            "div",
            { className: "template-list compact-list" },
            validation.map((item) =>
              h("div", { className: "template-row" }, [
                h("span", {}, [
                  h("strong", { text: item.label }),
                  h("small", {
                    text: item.recordedAt
                      ? `recorded ${item.recordedAt}`
                      : "not recorded",
                  }),
                ]),
                h("div", { className: "actions inline-actions" }, [
                  actionButton(item.recordedAt ? "Clear" : "Record", {
                    id: `bot-validation-${item.key}`,
                    variant: "secondary",
                    busyKey: `botValidation:${item.key}`,
                    onClick: () =>
                      recordBotValidation(item.key, !item.recordedAt),
                  }),
                ]),
              ]),
            ),
          ),
        ])
      : null,
    h("div", { className: "actions" }, [
      actionButton("Refresh bot completion", {
        id: "botCompletionRefresh",
        variant: "secondary",
        busyKey: "botCompletion",
        onClick: refreshBotCompletion,
      }),
      actionButton("Run dry-run rehearsal", {
        id: "botRehearsalRun",
        variant: "secondary",
        busyKey: "botRehearsal",
        onClick: runBotRehearsal,
      }),
      actionButton("Copy bot support bundle", {
        id: "botSupportBundleCopy",
        variant: "secondary",
        busyKey: "botSupportBundleCopy",
        onClick: copyBotSupportBundle,
      }),
      actionButton("Export bot support bundle", {
        id: "botSupportBundleExport",
        variant: "secondary",
        busyKey: "botSupportBundleExport",
        onClick: exportBotSupportBundle,
      }),
    ]),
    state.botRehearsal?.steps?.length
      ? list(
          state.botRehearsal.steps.map(
            (step) =>
              `${step.ok ? "Ready" : "Needs setup"} ${step.label}: ${step.detail}`,
          ),
          state.botRehearsal.steps.every((step) => step.ok) ? "ok" : "warn",
        )
      : null,
    state.botSupportBundle
      ? callout(
          `Support bundle ready: ${state.botSupportBundle.nextActions?.length || 0} next actions, ${state.botSupportBundle.queuedDiscordActions?.length || 0} queued Discord actions.`,
          "info",
        )
      : null,
  ];
}

function renderBotCompletionSection(section) {
  const stateLabel = section.state || "not checked";
  const tone = botCompletionTone(stateLabel);
  const stateClass = String(stateLabel).replace(/\s+/g, "-");
  const checks = section.checks || [];

  return h(
    "div",
    { className: `bot-completion-section ${tone} ${stateClass}` },
    [
      h("div", { className: "bot-completion-section-head" }, [
        h("span", {}, [
          h("strong", { text: section.title || section.key || "Section" }),
          h("small", {
            text: `${section.completed || 0}/${section.total || 0} complete`,
          }),
        ]),
        h("span", { className: `chip ${tone}`, text: stateLabel }),
      ]),
      h("small", { text: section.detail || section.nextAction || "" }),
      checks.length
        ? h(
            "div",
            { className: "bot-check-list" },
            checks.map((check) =>
              h("div", { className: "bot-check-row" }, [
                h("span", {
                  className: check.complete ? "ok" : "warn",
                  text: check.complete ? "ready" : "todo",
                }),
                h("span", {}, [
                  h("strong", { text: check.label }),
                  h("small", {
                    text: check.complete
                      ? "Recorded or detected."
                      : check.nextAction,
                  }),
                ]),
              ]),
            ),
          )
        : null,
    ],
  );
}

function clientBotCompletionSections(checks) {
  if (!checks.length) return [];
  return [
    ["Local pairing", "blocked", ["relay-paired", "twitch-transport-relay"]],
    [
      "Twitch credentials",
      "needs credentials",
      [
        "twitch-callback-recorded",
        "twitch-bot-oauth",
        "twitch-broadcaster-oauth",
        "twitch-separate-account",
        "twitch-eventsub",
      ],
    ],
    [
      "Discord Relay",
      "needs setup",
      [
        "discord-local-setup",
        "discord-worker-config",
        "discord-guild-connected",
        "discord-interaction-endpoint",
        "discord-slash-commands",
      ],
    ],
    [
      "Live validation",
      "live validation required",
      [
        "twitch-test-send",
        "twitch-chatbot-user-list",
        "discord-suggest-tested",
        "discord-announcement-tested",
      ],
    ],
  ].map(([title, incompleteState, keys]) => {
    const sectionChecks = keys
      .map((key) => checks.find((check) => check.key === key))
      .filter(Boolean);
    const pending = sectionChecks.filter((check) => !check.complete);
    return {
      title,
      state: pending.length ? incompleteState : "ready",
      detail: pending[0]?.nextAction || "Section ready.",
      completed: sectionChecks.length - pending.length,
      total: sectionChecks.length,
      checks: sectionChecks,
    };
  });
}

function botCompletionStatusLabel(status) {
  return (
    {
      ready: "ready",
      blocked: "blocked",
      "needs-credentials": "needs credentials",
      "needs-setup": "needs setup",
      "live-validation-required": "live validation required",
      "pending-live-validation": "live validation required",
      "needs-review": "needs review",
    }[status] || status
  );
}

function botCompletionTone(stateLabel = "") {
  if (stateLabel === "ready") return "ok";
  if (stateLabel === "blocked") return "bad";
  if (stateLabel === "live validation required") return "info";
  if (stateLabel === "needs review") return "warn";
  return "warn";
}

const setupModeIds = ["relay-assisted", "advanced", "local-only"];
const setupModeOptions = [
  ["relay-assisted", "Hosted"],
  ["advanced", "Assisted"],
  ["local-only", "Local"],
];

function currentSetupMode(config = state.config || {}) {
  return (
    config.setupMode ||
    (config.relay?.twitchTransportMode === "local-user-token"
      ? "local-only"
      : "relay-assisted")
  );
}

function selectedSetupMode(config = state.config || {}) {
  const mode = settingsValue("setupMode", currentSetupMode(config));
  return setupModeIds.includes(mode) ? mode : "relay-assisted";
}

function setupModeLabel(mode = "local-only") {
  return (
    {
      "relay-assisted": "Hosted",
      advanced: "Assisted",
      "local-only": "Local",
    }[mode] || "Hosted"
  );
}

function setupModeSummary(mode = "local-only") {
  return (
    {
      "relay-assisted":
        "Hosted uses Relay-managed Twitch and Discord service credentials.",
      advanced: "Assisted shows hosted and local troubleshooting controls.",
      "local-only": "Local uses self-hosted credentials on this machine.",
    }[mode] || ""
  );
}

function setupModeTooltip(mode = "local-only") {
  return setupModeSummary(mode);
}

function renderSetupModeSelector(options = {}) {
  const mode = selectedSetupMode();
  const className = ["setup-mode-selector", options.className || ""]
    .filter(Boolean)
    .join(" ");

  return h(
    "div",
    {
      className,
      role: "group",
      "aria-label": "Setup mode",
      title:
        "Switch setup mode. Hosted uses Relay, Assisted shows troubleshooting, Local uses self-hosted credentials.",
    },
    setupModeOptions.map(([value, label]) =>
      actionButton(label, {
        id: `${options.compact ? "header-" : ""}setupMode-${value}`,
        className: `segmented-button${mode === value ? " active" : ""}`,
        title: setupModeTooltip(value),
        ariaLabel: `${label} setup mode`,
        ariaPressed: mode === value ? "true" : "false",
        busyKey: "setupModeSave",
        onClick: () => persistSetupMode(value),
      }),
    ),
  );
}
