// Relay setup boundary
function renderRelaySetupGuide(options = {}) {
  const config = state.config || {};
  const relay = config.relay || {};
  const setup = relay.setupUrls || {};
  const remote = state.relayStatus || {};
  const readiness = remote.readiness || relay.readiness || {};
  const botGrant = relayReadinessCheck(readiness, "bot-grant");
  const broadcasterGrant = relayReadinessCheck(readiness, "broadcaster-grant");
  const separateBot = relayReadinessCheck(readiness, "separate-bot-account");
  const progress = getRelaySetupProgress(relay);
  const activeStep =
    progress.steps.find((step) => !step.complete)?.id || "relay-final";
  const relayConfigured = Boolean(relay.readiness?.ready);
  const botOauthReady = Boolean(setup.twitchBotOAuthUrl);
  const broadcasterOauthReady = Boolean(setup.twitchBroadcasterOAuthUrl);
  const showAdvancedUrls = options.showAdvancedUrls === true;

  return card("Setup Guide", [
    h("div", { id: "setupGuide", className: "setup-guide" }, [
      h(
        "div",
        { className: "setup-progress" },
        progress.steps.map((step) =>
          h(
            "div",
            { className: `setup-check ${step.complete ? "complete" : ""}` },
            [
              h("span", {
                className: "checkmark",
                text: step.complete ? "[x]" : "[ ]",
              }),
              h("span", { text: step.label }),
            ],
          ),
        ),
      ),
      callout(
        "Relay chatbot mode is selected. This hosted setup path is the one that can make vaexcorebot appear as a Twitch Chat Bot; local Connect Twitch remains available only as a fallback user-token mode.",
        "info",
      ),
      setupStep({
        id: "relay-pair",
        number: 1,
        title: "Start Hosted Twitch Setup",
        active: activeStep === "relay-pair",
        complete: progress.relayMode && progress.relayPaired,
        children: [
          h("p", {
            text: "Create a hosted Relay installation. Console stores only the returned installation token locally and never shows Twitch app secrets.",
          }),
          h("div", { className: "actions" }, [
            actionButton("Start hosted setup", {
              id: "guideRelayHostedConnect",
              busyKey: "relayHostedConnect",
              onClick: () => connectHostedRelay(false),
            }),
            actionButton("Check Relay", {
              id: "guideRelayStatus",
              variant: "secondary",
              busyKey: "relayStatus",
              disabled: !relayConfigured,
              onClick: checkRelayStatus,
            }),
          ]),
        ],
      }),
      setupStep({
        id: "relay-bot-oauth",
        number: 2,
        title: "Authorize vaexcorebot",
        active: activeStep === "relay-bot-oauth",
        complete: progress.botAuthorized,
        disabled: !relayConfigured,
        children: [
          h("p", {
            text: "Console opens a dedicated bot auth window for vaexcorebot. Relay requests only the chat scopes it needs.",
          }),
          showAdvancedUrls
            ? setupUrlRow(
                "Bot OAuth URL",
                setup.twitchBotOAuthUrl,
                "Use the vaexcorebot account.",
                [
                  {
                    label: "Copy",
                    onClick: () => copySetupText(setup.twitchBotOAuthUrl),
                  },
                  {
                    label: "Open bot OAuth",
                    onClick: () =>
                      openExternalSetupUrl(setup.twitchBotOAuthUrl),
                  },
                ],
              )
            : h("div", { className: "actions" }, [
                actionButton("Log in as vaexcorebot", {
                  id: "guideRelayAuthorizeBot",
                  variant: "secondary",
                  disabled: !botOauthReady,
                  onClick: () => openExternalSetupUrl(setup.twitchBotOAuthUrl),
                }),
              ]),
          botGrant
            ? callout(botGrant.detail, botGrant.ok ? "ok" : "warn")
            : callout(
                "Check Relay after authorizing to refresh this status.",
                "muted",
              ),
        ],
      }),
      setupStep({
        id: "relay-broadcaster-oauth",
        number: 3,
        title: "Authorize Broadcaster Channel",
        active: activeStep === "relay-broadcaster-oauth",
        complete: progress.broadcasterAuthorized && progress.separateAccounts,
        disabled: !progress.botAuthorized && !broadcasterOauthReady,
        children: [
          h("p", {
            text: "Console opens a separate broadcaster auth window. Use the channel owner account here; Relay requests channel:bot so vaexcorebot can operate as your channel bot.",
          }),
          showAdvancedUrls
            ? setupUrlRow(
                "Broadcaster OAuth URL",
                setup.twitchBroadcasterOAuthUrl,
                "Use the channel owner account.",
                [
                  {
                    label: "Copy",
                    onClick: () =>
                      copySetupText(setup.twitchBroadcasterOAuthUrl),
                  },
                  {
                    label: "Open broadcaster OAuth",
                    onClick: () =>
                      openExternalSetupUrl(setup.twitchBroadcasterOAuthUrl),
                  },
                ],
              )
            : h("div", { className: "actions" }, [
                actionButton("Log in as broadcaster", {
                  id: "guideRelayAuthorizeBroadcaster",
                  variant: "secondary",
                  disabled: !broadcasterOauthReady,
                  onClick: () =>
                    openExternalSetupUrl(setup.twitchBroadcasterOAuthUrl),
                }),
              ]),
          broadcasterGrant
            ? callout(
                broadcasterGrant.detail,
                broadcasterGrant.ok ? "ok" : "warn",
              )
            : callout(
                "Check Relay after authorizing to refresh this status.",
                "muted",
              ),
          separateBot
            ? callout(separateBot.detail, separateBot.ok ? "ok" : "warn")
            : null,
        ],
      }),
      setupStep({
        id: "relay-eventsub",
        number: 4,
        title: "Register Twitch EventSub",
        active: activeStep === "relay-eventsub",
        complete: progress.eventSubRegistered,
        disabled: !progress.botAuthorized || !progress.broadcasterAuthorized,
        children: [
          h("p", {
            text: "After both OAuth grants are stored, Relay should register this automatically. Use this button if Console still shows EventSub as pending.",
          }),
          h("div", { className: "actions" }, [
            actionButton("Check Relay", {
              id: "guideRelayStatusAfterOAuth",
              variant: "secondary",
              busyKey: "relayStatus",
              disabled: !relayConfigured,
              onClick: checkRelayStatus,
            }),
            actionButton("Register required EventSub", {
              id: "guideRelayRegisterEventSub",
              busyKey: "relayRegisterEventSub",
              disabled:
                !relayConfigured ||
                !progress.botAuthorized ||
                !progress.broadcasterAuthorized,
              onClick: registerRelayEventSub,
            }),
          ]),
          readiness.checks?.length
            ? list(
                readiness.checks.map(
                  (check) =>
                    `${check.ok ? "Ready" : "Needs setup"} ${check.key}: ${check.detail}`,
                ),
                readiness.ready ? "ok" : "warn",
              )
            : null,
        ],
      }),
      setupStep({
        id: "relay-test",
        number: 5,
        title: "Send Test And Confirm Chat Bot Identity",
        active: activeStep === "relay-test",
        complete: progress.relayTestSent && progress.chatbotIdentityValidated,
        disabled: !progress.eventSubRegistered,
        children: [
          h("p", {
            text: "Send a Relay chat test, then mark identity verified only after Twitch shows vaexcorebot as a Chat Bot in the channel user list.",
          }),
          h("div", { className: "actions" }, [
            actionButton("Send Relay test message", {
              id: "guideRelayTestSend",
              variant: "secondary",
              busyKey: "relayTestSend",
              disabled: !relayConfigured,
              onClick: sendRelayTestMessage,
            }),
            actionButton("Mark Chat Bot identity live-tested", {
              id: "guideRelayValidateChatbotIdentity",
              variant: "secondary",
              busyKey: "relayValidateChatbotIdentity",
              disabled: !relayConfigured,
              onClick: markRelayChatbotIdentityValidated,
            }),
          ]),
          state.relayTestSendResult?.ok
            ? callout("Relay test message sent in this Console session.", "ok")
            : callout(
                "No Relay test message is recorded for this Console session.",
                "muted",
              ),
          relay.chatbotIdentityValidatedAt
            ? callout(
                `Chat Bot identity live test recorded at ${relay.chatbotIdentityValidatedAt}.`,
                "ok",
              )
            : null,
        ],
      }),
    ]),
  ]);
}

// Setup step boundary
function setupStep({
  id,
  number,
  title,
  active,
  complete,
  disabled,
  children,
}) {
  return h(
    "div",
    {
      className: `setup-step ${active ? "active" : ""} ${complete ? "complete" : ""} ${disabled ? "disabled" : ""}`,
      "data-step": id,
    },
    [
      h("div", { className: "step-title" }, [
        h("span", { className: "step-number", text: String(number) }),
        h("strong", { text: title }),
        h("span", {
          className: complete ? "ok" : "warn",
          text: complete
            ? "complete"
            : disabled
              ? "locked"
              : active
                ? "next"
                : "pending",
        }),
      ]),
      h("div", { className: "step-body" }, children),
    ],
  );
}

// Validation summary boundary
function renderValidationSummary() {
  const config = state.config || {};
  const validationChecks = visibleValidationChecks();

  if (validationChecks.length) {
    return h(
      "ul",
      {},
      validationChecks.map((check) =>
        h("li", {
          className: check.ok ? "ok" : "bad",
          text: `${check.ok ? "Ready" : "Needs attention"} ${check.name}: ${check.detail}`,
        }),
      ),
    );
  }

  return statusGrid([
    [
      "Token valid",
      state.status?.runtime?.tokenValid ? "yes" : "not validated",
      state.status?.runtime?.tokenValid,
    ],
    [
      "Refresh available",
      config.hasRefreshToken ? "yes" : "missing",
      config.hasRefreshToken,
    ],
    [
      "Scopes correct",
      hasRequiredScopes() ? "yes" : "not validated",
      hasRequiredScopes(),
    ],
    [
      "Bot identity resolved",
      config.hasBotUserId ? "yes" : "not validated",
      config.hasBotUserId,
    ],
    [
      "Broadcaster identity resolved",
      config.hasBroadcasterUserId ? "yes" : "not validated",
      config.hasBroadcasterUserId,
    ],
  ]);
}
// Diagnostics panel boundary
function renderDiagnostics() {
  const report = state.diagnostics;
  const readiness = report?.readiness || {};
  const app = report?.app || {};
  const paths = report?.paths || {};
  const database = report?.database || {};
  const setupUi = report?.setupUi || {};
  const firstRun = report?.firstRun || {};
  const runtime = report?.runtime || {};
  const bot = runtime.botProcess || {};

  return [
    sectionHeader(
      "Diagnostics",
      "Safe local report for setup, packaging, runtime, and support handoff.",
      h("div", { className: "actions" }, [
        actionButton("Run readiness check", {
          id: "runDiagnostics",
          onClick: runDiagnostics,
          busyKey: "diagnostics",
        }),
        actionButton("Copy diagnostic report", {
          id: "copyDiagnostics",
          variant: "secondary",
          onClick: copyDiagnostics,
          busyKey: "copyDiagnostics",
        }),
        actionButton("Copy support bundle", {
          id: "copySupportBundle",
          variant: "secondary",
          onClick: copySupportBundle,
          busyKey: "copySupportBundle",
        }),
      ]),
    ),
    readiness.status
      ? callout(
          readiness.status === "ready"
            ? "Diagnostics clear."
            : readiness.status === "attention"
              ? `Attention: ${readiness.nextAction}`
              : `Not ready: ${readiness.nextAction}`,
          readiness.status === "ready"
            ? "ok"
            : readiness.status === "attention"
              ? "warn"
              : "bad",
        )
      : callout("Run diagnostics to generate a local support report.", "muted"),
    card("Readiness", [
      statusGrid([
        ["Status", readiness.status || "not run", readiness.status === "ready"],
        [
          "Blockers",
          readiness.blockers?.length || 0,
          !readiness.blockers?.length,
        ],
        [
          "Warnings",
          readiness.warnings?.length || 0,
          !readiness.warnings?.length,
        ],
        [
          "Next action",
          readiness.nextAction || "Run diagnostics",
          readiness.status === "ready",
        ],
      ]),
      readiness.blockers?.length ? list(readiness.blockers, "bad") : null,
      readiness.warnings?.length ? list(readiness.warnings, "warn") : null,
    ]),
    card("First Run And Recovery", [
      statusGrid([
        [
          "Clean install",
          firstRun.cleanInstall ? "yes" : "no",
          !firstRun.cleanInstall,
        ],
        [
          "Config file",
          firstRun.configFilePresent ? "present" : "not yet",
          Boolean(firstRun.configFilePresent),
        ],
        [
          "Setup complete",
          firstRun.setupComplete ? "yes" : "no",
          Boolean(firstRun.setupComplete),
        ],
        [
          "Missing fields",
          firstRun.missingConfig?.length || 0,
          !firstRun.missingConfig?.length,
        ],
        [
          "Next action",
          firstRun.nextAction || "Run diagnostics",
          Boolean(firstRun.nextAction) && firstRun.setupComplete,
        ],
      ]),
      firstRun.blockers?.length ? list(firstRun.blockers, "bad") : null,
      firstRun.warnings?.length ? list(firstRun.warnings, "warn") : null,
      firstRun.recoverySteps?.length
        ? list(
            firstRun.recoverySteps,
            firstRun.blockers?.length ? "bad" : "muted",
          )
        : null,
    ]),
    card("About This Build", [
      statusGrid([
        ["Version", app.version || "unknown", Boolean(app.version)],
        [
          "Distribution",
          app.runtime === "electron"
            ? desktopDistributionLabel(app.platform)
            : "local development",
          Boolean(app.runtime),
        ],
        [
          "Update method",
          app.runtime === "electron"
            ? desktopUpdateMethod(app.platform)
            : "rebuild and restart local server",
          Boolean(app.runtime),
        ],
        ["Runtime", app.runtime || "unknown", Boolean(app.runtime)],
        ["Electron", app.electron || "not electron", Boolean(app.electron)],
        [
          "Platform",
          `${app.platform || "unknown"} ${app.arch || ""}`.trim(),
          Boolean(app.platform),
        ],
        [
          "Generated",
          report?.generatedAt || "not run",
          Boolean(report?.generatedAt),
        ],
      ]),
      app.runtime === "electron"
        ? callout(desktopUpdateNote(app.platform), "muted")
        : null,
    ]),
    card("Environment", [
      statusGrid([
        ["Node", app.node || "unknown", Boolean(app.node)],
        ["Config", paths.configDir || "unknown", Boolean(paths.configDir)],
        [
          "Database",
          paths.databasePath || "unknown",
          Boolean(paths.databasePath),
        ],
      ]),
    ]),
    card("Local Paths", [
      statusGrid([
        ["Config", paths.configDir || "unknown", Boolean(paths.configDir)],
        ["Secrets", paths.secretsPath || "unknown", Boolean(paths.secretsPath)],
        [
          "Database",
          paths.databasePath || "unknown",
          Boolean(paths.databasePath),
        ],
        ["UI assets", paths.setupUiDir || "unknown", Boolean(paths.setupUiDir)],
      ]),
    ]),
    card("Storage And Assets", [
      statusGrid([
        ["Database", database.ok ? "ok" : "failed", database.ok],
        [
          "SQLite",
          database.driver || "unknown",
          database.driver === "better-sqlite3",
        ],
        ["app.js", setupUi.appJs ? "present" : "missing", setupUi.appJs],
        [
          "styles.css",
          setupUi.stylesCss ? "present" : "missing",
          setupUi.stylesCss,
        ],
        ["logo.jpg", setupUi.logoJpg ? "present" : "missing", setupUi.logoJpg],
      ]),
      database.error
        ? callout(database.error, database.ok ? "muted" : "bad")
        : null,
    ]),
    card("Runtime Snapshot", [
      statusGrid([
        ["Bot process", bot.status || "stopped", Boolean(bot.running)],
        ["PID", bot.pid || "none", Boolean(bot.pid)],
        [
          "EventSub",
          runtime.eventSubConnected ? "connected" : "not connected",
          runtime.eventSubConnected,
        ],
        [
          "Chat subscription",
          runtime.chatSubscriptionActive ? "active" : "inactive",
          runtime.chatSubscriptionActive,
        ],
        [
          "Live chat",
          runtime.liveChatConfirmed ? "confirmed" : "pending",
          runtime.liveChatConfirmed,
        ],
        [
          "Queue",
          runtime.queueHealth?.status || "unknown",
          runtime.queueHealth?.status === "clear",
        ],
      ]),
    ]),
    card("Checks", [
      dataTable(
        ["Check", "Severity", "Result", "Detail"],
        (report?.checks || []).map((check) => [
          check.name,
          check.severity,
          check.ok ? "pass" : "fail",
          check.detail,
        ]),
      ),
    ]),
    message(),
  ];
}
