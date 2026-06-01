function field(id) {
  return document.getElementById(id);
}

function currentContentNode() {
  return app.querySelector(".content");
}

function saveScrollPosition(tabId = state.activeTab) {
  const content = currentContentNode();
  if (!content) {
    return;
  }
  scrollPositions[tabId] = content.scrollTop;

  for (const node of content.querySelectorAll("[data-scroll-key]")) {
    keyedScrollPositions[`${tabId}:${node.dataset.scrollKey}`] = node.scrollTop;
  }
}

function restoreScrollPosition(tabId = state.activeTab) {
  const top = scrollPositions[tabId];

  requestAnimationFrame(() => {
    const content = currentContentNode();
    if (content) {
      if (top !== undefined) {
        content.scrollTop = top;
      }

      for (const node of content.querySelectorAll("[data-scroll-key]")) {
        const keyedTop =
          keyedScrollPositions[`${tabId}:${node.dataset.scrollKey}`];
        if (keyedTop !== undefined) {
          node.scrollTop = keyedTop;
        }
      }
    }
  });
}

function disclosureOpen(key, defaultOpen = false) {
  return Object.prototype.hasOwnProperty.call(disclosureStates, key)
    ? disclosureStates[key]
    : defaultOpen;
}

function disclosureAttributes(key, defaultOpen = false, attributes = {}) {
  return {
    ...attributes,
    "data-disclosure-key": key,
    open: disclosureOpen(key, defaultOpen),
    onToggle: (event) => {
      if (event.target === event.currentTarget) {
        disclosureStates[key] = event.currentTarget.open;
      }
    },
  };
}

function render(options = {}) {
  if (deferredRenderTimer) {
    clearTimeout(deferredRenderTimer);
    deferredRenderTimer = null;
  }

  if (options.preserveScroll !== false && !options.skipSaveScroll) {
    saveScrollPosition();
  }

  if (isSettingsWindow) {
    app.replaceChildren(
      h("div", { className: "app-shell settings-shell" }, [
        renderHeader({
          title: "Console Settings",
          subtitle: "Configuration Settings",
          showStatus: false,
        }),
        h("main", { className: "content settings-content" }, [
          h(
            "section",
            { id: "settings", className: "tab-panel active" },
            renderSettings(),
          ),
        ]),
      ]),
    );
    syncFormValues();
    updateDisabledState();
    if (options.preserveScroll !== false) {
      restoreScrollPosition();
    }
    return;
  }

  app.replaceChildren(
    h("div", { className: "app-shell" }, [
      renderHeader(),
      h("div", { className: "layout" }, [
        renderSidebar(),
        h(
          "main",
          { className: "content" },
          tabs.map(([id]) => renderTab(id)),
        ),
      ]),
    ]),
  );
  syncFormValues();
  updateDisabledState();
  if (options.preserveScroll !== false) {
    restoreScrollPosition();
  }
}

function renderHeader(options = {}) {
  const title = options.title || "vaexcore console";
  const subtitle =
    options.subtitle || "Live Ops console for Twitch and suite coordination";
  const showStatus = options.showStatus !== false;
  const showSettingsAction = options.showSettingsAction ?? !isSettingsWindow;
  const showModeSelector = options.showModeSelector !== false;
  const showLaunchAction = options.showLaunchAction ?? !isSettingsWindow;
  const runtime = state.status?.runtime;
  const giveaway = state.status?.giveaway;
  const launch = currentLaunchPreparation();
  const connectionValue =
    launch?.status === "running"
      ? "checking"
      : runtime?.tokenValid
        ? "configured"
        : "not ready";
  return h("header", { className: "topbar" }, [
    h("div", { className: "brand-lockup" }, [
      h("img", {
        className: "brand-logo",
        src: "/ui/logo.jpg",
        alt: "vaexcore console",
      }),
      h("div", {}, [
        h("h1", { text: title }),
        h("p", { className: "subtitle", text: subtitle }),
      ]),
    ]),
    showStatus || showSettingsAction || showModeSelector || showLaunchAction
      ? h("div", { className: "header-actions" }, [
          showModeSelector ? renderHeaderModeSelector() : null,
          showStatus
            ? h("div", { className: "header-status" }, [
                statusPill("Mode", runtime?.mode || "loading"),
                statusPill(
                  "Connection",
                  connectionValue,
                  launch?.status === "running" || runtime?.tokenValid,
                ),
                statusPill(
                  "Chat",
                  runtime?.liveChatConfirmed ? "confirmed" : "pending",
                  runtime?.liveChatConfirmed,
                ),
                statusPill(
                  "Giveaway",
                  giveaway?.status || "loading",
                  giveaway?.status !== "open",
                ),
              ])
            : null,
          showLaunchAction
            ? actionButton("Launch Suite", {
                id: "launchSuite",
                variant: "secondary",
                busyKey: "launchSuite",
                onClick: launchSuite,
              })
            : null,
          showSettingsAction ? settingsActionButton() : null,
        ])
      : null,
  ]);
}

function renderHeaderModeSelector() {
  return renderSetupModeSelector({
    className: "header-mode-selector",
    compact: true,
  });
}

function settingsActionButton() {
  return h("button", {
    className: "icon-button settings-button",
    type: "button",
    title: "Open Configuration Settings",
    "aria-label": "Open Configuration Settings",
    onClick: () => openSettingsWindow(),
    text: "⚙",
  });
}

function renderSidebar() {
  return h(
    "nav",
    { className: "sidebar", "aria-label": "Console sections" },
    tabs.map(([id, label]) =>
      actionButton(label, {
        className: `nav-button${state.activeTab === id ? " active" : ""}`,
        onClick: () => {
          saveScrollPosition();
          state.activeTab = id;
          render({ skipSaveScroll: true });
        },
      }),
    ),
  );
}

function renderTab(id) {
  const body = {
    dashboard: renderDashboard,
    "live-mode": renderLiveMode,
    commands: renderCommands,
    timers: renderTimers,
    moderation: renderModeration,
    giveaways: renderGiveaways,
    "chat-tools": renderChatTools,
    "twitch-ops": renderTwitchOps,
    discord: renderDiscord,
    suite: renderSuite,
    testing: renderTesting,
    settings: renderSettings,
    diagnostics: renderDiagnostics,
    "audit-log": renderAuditLog,
  }[id]();

  return h(
    "section",
    { id, className: `tab-panel${state.activeTab === id ? " active" : ""}` },
    body,
  );
}

function sectionHeader(title, description, right) {
  return h("div", { className: "section-head" }, [
    h("div", {}, [h("h2", { text: title }), h("p", { text: description })]),
    right,
  ]);
}

function card(title, children) {
  return h("div", { className: "panel" }, [
    title ? h("h3", { text: title }) : null,
    ...children,
  ]);
}

function advancedPanel(title, children) {
  return h("details", { className: "panel advanced-panel" }, [
    h("summary", {}, [h("strong", { text: title })]),
    ...children,
  ]);
}

function formRow(label, control) {
  return h("label", {}, [label, control]);
}

function fieldRef(text, targetId, missing = false) {
  return h("button", {
    className: `field-ref${missing ? " needs-attention" : ""}`,
    type: "button",
    onClick: () => focusField(targetId),
    text,
  });
}

function actionButton(label, options = {}) {
  const classes = [options.className || "", options.variant || ""]
    .filter(Boolean)
    .join(" ");
  return h("button", {
    className: classes,
    id: options.id,
    type: "button",
    title: options.title,
    "aria-label": options.ariaLabel,
    "aria-pressed": options.ariaPressed,
    disabled: options.disabled,
    onClick: options.onClick,
    text: state.busy.has(options.busyKey || options.id) ? "Working..." : label,
  });
}

function statusPill(label, value, ok = true) {
  return h("div", { className: "pill compact" }, [
    h("strong", { text: label }),
    h("span", { className: ok ? "ok" : "warn", text: value }),
  ]);
}

function statusGrid(rows) {
  return h(
    "div",
    { className: "status-grid" },
    rows.map(([label, value, ok = true]) =>
      h("div", { className: "pill" }, [
        h("strong", { text: label }),
        h("span", { className: ok ? "ok" : "warn", text: String(value) }),
      ]),
    ),
  );
}

function callout(text, tone = "muted") {
  return h("div", { className: `callout ${tone}`, text });
}

function message() {
  return h("div", {
    className: `message ${state.message.tone}`,
    text: state.message.text,
  });
}
function renderDashboard() {
  const status = state.status;
  const runtime = status?.runtime || {};
  const readiness = getReadiness();

  return [
    sectionHeader(
      "Live Ops",
      "Startup path and live stream snapshot.",
      actionButton("Refresh", {
        id: "refresh",
        onClick: refreshAll,
        busyKey: "refresh",
      }),
    ),
    renderDashboardStartCard(runtime, readiness),
    renderReadyForStreamCard(runtime, readiness),
    renderDashboardModeCard(),
    renderBotCompletionCard("dashboard"),
    h("div", { className: "dashboard-grid" }, [
      renderDashboardReadinessCard(runtime, readiness),
      renderDashboardGiveawayCard(status?.giveaway),
    ]),
    message(),
  ];
}

function renderDashboardModeCard() {
  const config = state.config || {};
  const completion = state.botCompletion || {};
  const mode = completion.setupMode || currentSetupMode(config);
  const checks = completion.setupChecks || config.setupChecks || {};

  return card("Setup Status", [
    statusGrid([
      ["Mode", setupModeLabel(mode), true],
      [
        "Transport",
        transportModeLabel(
          completion.transportMode || config.relay?.twitchTransportMode,
        ),
        true,
      ],
      [
        "Local check",
        setupCheckStatusLabel(checks.local),
        checks.local?.status === "ready",
      ],
      [
        "Relay check",
        setupCheckStatusLabel(checks.relay),
        checks.relay?.status === "ready",
      ],
      [
        "Completion refresh",
        completion.generatedAt || "not checked",
        Boolean(completion.generatedAt),
      ],
    ]),
    checks.local?.message ? callout(`Local: ${checks.local.message}`) : null,
    checks.relay?.message ? callout(`Relay: ${checks.relay.message}`) : null,
    h("div", { className: "actions" }, [
      actionButton("Run setup health checks", {
        id: "dashboardSetupHealthChecks",
        variant: "secondary",
        busyKey: "setupHealthChecks",
        onClick: runSetupHealthChecks,
      }),
      actionButton("Open Settings", {
        id: "dashboardModeSettings",
        variant: "secondary",
        onClick: () => openSettingsWindow("#operatingMode"),
      }),
    ]),
  ]);
}

function renderReadyForStreamCard(runtime = {}, readiness = {}) {
  const completion = state.botCompletion || {};
  const rehearsal = state.localRehearsal || {};
  const giveaway = state.giveaway?.summary || state.status?.giveaway || {};
  const diagnostics = state.diagnostics || rehearsal.diagnostics || {};
  const support = rehearsal.supportBundle || {};
  const mode = completion.setupMode || currentSetupMode(state.config || {});
  const checks = completion.setupChecks || state.config?.setupChecks || {};
  const relayConnected = Boolean(
    rehearsal.relayStatus?.connected || state.relayStatus?.connected,
  );
  const discordSetup =
    completion.discordSetup || rehearsal.supportBundle?.discordSetup || {};
  const localReady = isTwitchSetupReady();
  const diagnosticsReady =
    diagnostics.ok === true || diagnostics.readiness?.status === "ready";
  const botRunning = Boolean(runtime?.botProcess?.running);
  const supportSafe = support.redacted !== false;
  const rehearsalReady =
    rehearsal.status === "ready" ||
    (Array.isArray(rehearsal.steps) &&
      rehearsal.steps.length > 0 &&
      rehearsal.steps.every((step) => step.ok));
  const primaryDetail =
    rehearsal.generatedAt && rehearsal.nextActions?.length
      ? rehearsal.nextActions[0]
      : rehearsal.generatedAt
        ? "Full local rehearsal completed. Review any attention items before stream."
        : readiness.nextAction ||
          "Run the local rehearsal to refresh setup, Relay, Discord, giveaway, diagnostics, and support-export checks.";

  return card("Operations Center", [
    h("div", { className: `state-banner compact ${readyForStreamTone()}` }, [
      h("strong", { text: `Ready for Stream: ${readyForStreamLabel()}` }),
      h("span", { text: primaryDetail }),
    ]),
    statusGrid([
      ["Mode", setupModeLabel(mode), true],
      ["Local", localReady ? "ready" : "needs setup", localReady],
      ["Bot Process", botRunning ? "running" : "stopped", botRunning],
      [
        "Hosted Relay",
        relayConnected || mode === "local-only"
          ? relayConnected
            ? "connected"
            : "optional"
          : "not connected",
        relayConnected || mode === "local-only",
      ],
      [
        "Giveaway",
        giveaway.operatorState || giveaway.status || "no giveaway",
        true,
      ],
      [
        "Discord Layout",
        discordSetup.setupAppliedAt
          ? `applied ${discordSetup.setupAppliedAt}`
          : discordSetup.templateName || "preview ready",
        Boolean(discordSetup.templateName || discordSetup.setupAppliedAt),
      ],
      [
        "Diagnostics",
        diagnostics.readiness?.status || (diagnostics.ok ? "ready" : "not run"),
        diagnosticsReady,
      ],
      ["Support Export", supportSafe ? "redacted" : "attention", supportSafe],
      ["Rehearsal", rehearsal.generatedAt || "not run", rehearsalReady],
      [
        "Local last checked",
        checks.local?.checkedAt || "not checked",
        Boolean(checks.local?.checkedAt),
      ],
      [
        "Relay last checked",
        checks.relay?.checkedAt || "not checked",
        Boolean(checks.relay?.checkedAt) || mode === "local-only",
      ],
    ]),
    callout(
      "Optional provider setup checks store only status, timestamp, and redacted messages.",
      "muted",
    ),
    rehearsal.steps?.length
      ? list(
          rehearsal.steps.map(
            (step) =>
              `${step.ok ? "PASS" : "CHECK"} ${step.label}: ${step.detail}`,
          ),
          rehearsalReady ? "ok" : "warn",
        )
      : null,
    h("div", { className: "actions" }, [
      actionButton("Run Operations Check", {
        id: "dashboardFullLocalRehearsal",
        variant: "primary",
        busyKey: "localRehearsal",
        onClick: runFullLocalRehearsal,
      }),
      actionButton("Check provider setup", {
        id: "dashboardProviderSetupCheck",
        variant: "secondary",
        busyKey: "setupHealthChecks",
        onClick: runSetupHealthChecks,
      }),
      actionButton("Copy support bundle", {
        id: "dashboardCopySupportBundle",
        variant: "secondary",
        busyKey: "copySupportBundle",
        onClick: copySupportBundle,
      }),
      actionButton("Open Diagnostics", {
        id: "dashboardOpenDiagnostics",
        variant: "secondary",
        onClick: openDiagnostics,
      }),
    ]),
  ]);
}
