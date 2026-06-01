function renderOperatingModeCard(config = state.config || {}) {
  const mode = selectedSetupMode(config);
  const checks = config.setupChecks || {};
  const draftTransport = settingsValue(
    "twitchTransportMode",
    config.relay?.twitchTransportMode || "relay-chatbot",
  );

  return card("Setup Mode", [
    h("input", {
      id: "setupMode",
      type: "hidden",
      value: mode,
      onChange: updateSettingsDraft,
    }),
    statusGrid(
      [
        ["Selected mode", setupModeLabel(mode), setupModeIds.includes(mode)],
        ["Transport", transportModeLabel(draftTransport), true],
        mode !== "relay-assisted"
          ? [
              "Local check",
              checks.local?.checkedAt || "not checked",
              checks.local?.status === "ready",
            ]
          : null,
        mode !== "local-only"
          ? [
              "Relay check",
              checks.relay?.checkedAt || "not checked",
              checks.relay?.status === "ready",
            ]
          : null,
      ].filter(Boolean),
    ),
    mode !== "relay-assisted" && checks.local?.message
      ? callout(`Local check: ${checks.local.message}`)
      : null,
    mode !== "local-only" && checks.relay?.message
      ? callout(`Relay check: ${checks.relay.message}`)
      : null,
    h("div", { className: "actions" }, [
      actionButton("Save settings", { id: "saveMode", onClick: saveSettings }),
      actionButton("Run setup health checks", {
        id: "checkSelectedSetupMode",
        variant: "secondary",
        busyKey: "setupHealthChecks",
        onClick: runSetupHealthChecks,
      }),
      mode !== "relay-assisted"
        ? actionButton("Check Local", {
            id: "checkLocalSetupMode",
            variant: "secondary",
            onClick: () => checkSetupMode("local-only"),
          })
        : null,
      mode !== "local-only"
        ? actionButton("Check Hosted", {
            id: "checkRelaySetupMode",
            variant: "secondary",
            onClick: () => checkSetupMode("relay-assisted"),
          })
        : null,
    ]),
  ]);
}

function renderSettings() {
  const config = state.config || {};
  const relay = config.relay || {};
  const setupMode = selectedSetupMode(config);
  const required = missingConfigFields(config);
  const validationChecks = visibleValidationChecks();

  return [
    sectionHeader(
      "Console Settings",
      "Connection, setup, and runtime configuration.",
      setupMode === "relay-assisted"
        ? actionButton("Check Relay", {
            id: "settingsRelayStatus",
            variant: "secondary",
            busyKey: "relayStatus",
            disabled: !relay.readiness?.ready,
            onClick: checkRelayStatus,
          })
        : connectButton(config),
    ),
    renderWindowsSetupPromptNotice(),
    renderSettingsLaunchNotice(),
    renderOperatingModeCard(config),
    ...renderSettingsModeBody(
      setupMode,
      config,
      relay,
      required,
      validationChecks,
    ),
    message(),
  ];
}

function renderSettingsModeBody(
  setupMode,
  config,
  relay,
  required,
  validationChecks,
) {
  if (setupMode === "local-only") {
    return [
      renderLocalSetupCompletion(config, required),
      renderSetupGuide("local-only"),
      renderTwitchConfigurationPanel(config, validationChecks),
      renderAdvancedReadinessDetails(false),
      renderRuntimeCommandsCard(),
    ];
  }

  if (setupMode === "advanced") {
    return [
      renderSetupGuide("advanced", { showAdvancedUrls: true }),
      renderBotCompletionCard("settings"),
      renderRelaySetupCompletion(relay),
      renderHostedRelaySetup(relay, { showAdvancedUrls: true }),
      renderTwitchTransportPanel(relay, false, { showTransportSelect: true }),
      renderTwitchConfigurationPanel(config, validationChecks, {
        title: "Local OAuth Fallback",
      }),
      renderLocalSetupCompletion(config, required),
      renderRuntimeCommandsCard(),
    ];
  }

  return [
    renderRelaySetupCompletion(relay),
    renderSetupGuide("relay-assisted"),
    renderHostedRelaySetup(relay, { showAdvancedUrls: false }),
    renderAdvancedReadinessDetails(false),
  ];
}

function renderRuntimeCommandsCard() {
  return card("Runtime Commands", [
    h("p", {
      text: "Use Dashboard controls to start or stop the live bot listener. CLI commands remain available when you want terminal runtime control.",
    }),
    h("p", {}, [
      h("code", { text: "npm run check:env" }),
      " ",
      h("code", { text: "npm run build" }),
      " ",
      h("code", { text: "npm run dev:app-config" }),
    ]),
  ]);
}

function renderTwitchConfigurationPanel(
  config,
  validationChecks,
  options = {},
) {
  const title = options.title || "Twitch Configuration";
  const collapsible = options.collapsible === true;
  const children = [
    h("div", { className: "grid" }, [
      formRow(
        "Mode",
        h("select", { id: "mode", onChange: updateSettingsDraft }, [
          option("live", "live"),
          option("local", "local"),
        ]),
      ),
      formRow(
        "Redirect URI",
        h("input", {
          id: "redirectUri",
          className: !config.redirectUri ? "needs-attention" : "",
          onInput: updateSettingsDraft,
        }),
      ),
      formRow(
        "Client ID",
        h("input", {
          id: "clientId",
          className: !config.hasClientId ? "needs-attention" : "",
          autocomplete: "off",
          placeholder: config.hasClientId ? savedCredentialMask : "",
          onFocus: clearSavedCredentialMask,
          onBlur: restoreSavedCredentialMask,
          onInput: updateSettingsDraft,
        }),
      ),
      formRow(
        "Client Secret",
        h("input", {
          id: "clientSecret",
          className: !config.hasClientSecret ? "needs-attention" : "",
          type: "password",
          autocomplete: "new-password",
          placeholder: config.hasClientSecret ? savedCredentialMask : "",
          onFocus: clearSavedCredentialMask,
          onBlur: restoreSavedCredentialMask,
          onInput: updateSettingsDraft,
        }),
      ),
      formRow(
        "Broadcaster Login",
        h("input", {
          id: "broadcasterLogin",
          className: !config.broadcasterLogin ? "needs-attention" : "",
          placeholder: "channel login",
          onBlur: normalizeLoginField,
          onInput: updateSettingsDraft,
        }),
      ),
      formRow(
        "Bot Login",
        h("input", {
          id: "botLogin",
          className: !config.botLogin ? "needs-attention" : "",
          placeholder: "bot account login",
          onBlur: normalizeLoginField,
          onInput: updateSettingsDraft,
        }),
      ),
    ]),
    callout(
      title !== "Twitch Configuration"
        ? "Hosted Twitch uses Relay's Twitch app and secrets. These local OAuth fields are only for advanced self-hosted or fallback local testing."
        : "Saved Client ID and Client Secret are intentionally not shown. Paste them, click Save settings, then the fields return to saved and masked.",
      title !== "Twitch Configuration" ? "muted" : "info",
    ),
    oauthAccountCallout(config),
    botLoginReconnectCallout(config),
    h("div", { className: "actions" }, [
      actionButton("Save settings", { id: "save", onClick: saveSettings }),
      connectButton(config, "secondary"),
      config.hasAccessToken
        ? actionButton("Disconnect Twitch", {
            id: "disconnectTwitch",
            variant: "secondary",
            onClick: disconnectTwitch,
          })
        : null,
      actionButton("Rerun validation", {
        id: "validate",
        variant: "secondary",
        onClick: validateSetup,
      }),
    ]),
    h(
      "ul",
      { id: "checks" },
      validationChecks.map((check) =>
        h("li", {
          className: check.ok ? "ok" : "bad",
          text: `${check.ok ? "Ready" : "Needs attention"} ${check.name}: ${check.detail}`,
        }),
      ),
    ),
  ];

  return collapsible ? advancedPanel(title, children) : card(title, children);
}

function renderTwitchTransportPanel(relay, hostedMode, options = {}) {
  const showTransportSelect = options.showTransportSelect === true;
  const children = [
    showTransportSelect
      ? h("div", { className: "grid" }, [
          formRow(
            "Low-level Twitch transport",
            h(
              "select",
              { id: "twitchTransportMode", onChange: updateSettingsDraft },
              [
                option("relay-chatbot", "Relay Chat Bot identity"),
                option("local-user-token", "Local OAuth user token"),
              ],
            ),
          ),
        ])
      : null,
    statusGrid([
      [
        "Mode",
        relay.twitchTransportMode === "relay-chatbot"
          ? "Relay Chat Bot"
          : "Local OAuth user token",
        relay.twitchTransportMode === "relay-chatbot",
      ],
      [
        "Relay URL",
        relay.baseUrl || "missing",
        relay.twitchTransportMode !== "relay-chatbot" || Boolean(relay.baseUrl),
      ],
      [
        "Installation",
        relay.installationId || "missing",
        relay.twitchTransportMode !== "relay-chatbot" ||
          Boolean(relay.installationId),
      ],
      [
        "Console token",
        relay.hasConsoleToken ? "saved" : "missing",
        relay.twitchTransportMode !== "relay-chatbot" ||
          Boolean(relay.hasConsoleToken),
      ],
      [
        "Chat Bot identity live test",
        relay.chatbotIdentityValidatedAt || "not recorded",
        relay.twitchTransportMode !== "relay-chatbot" ||
          Boolean(relay.chatbotIdentityValidatedAt),
      ],
    ]),
    h("div", { className: "grid" }, [
      formRow(
        "Relay URL",
        h("input", {
          id: "relayBaseUrl",
          placeholder: "https://relay.vaexil.tv",
          onInput: updateSettingsDraft,
        }),
      ),
      formRow(
        "Relay Installation ID",
        h("input", {
          id: "relayInstallationId",
          placeholder: "Relay pairing installation ID",
          onInput: updateSettingsDraft,
        }),
      ),
      formRow(
        "Relay Console Token",
        h("input", {
          id: "relayConsoleToken",
          type: "password",
          autocomplete: "new-password",
          placeholder: relay.hasConsoleToken ? savedCredentialMask : "",
          onFocus: clearSavedCredentialMask,
          onBlur: restoreSavedCredentialMask,
          onInput: updateSettingsDraft,
        }),
      ),
    ]),
    callout(
      relay.identityNotice ||
        "Local chat sends appear as the authorized Twitch user. Hosted mode is required for Twitch Chat Bot identity.",
      relay.twitchTransportMode === "relay-chatbot" ? "warn" : "muted",
    ),
    callout(
      relay.twitchTransportMode === "relay-chatbot"
        ? "Relay Chat Bot identity sends through hosted Relay with app-token authorization."
        : "Local sends through direct OAuth chat. It can send messages, but Twitch will not label it as the hosted Chat Bot identity.",
      relay.twitchTransportMode === "relay-chatbot" ? "info" : "muted",
    ),
    relay.readiness?.checks?.length
      ? list(
          relay.readiness.checks.map(
            (check) =>
              `${check.ok ? "Ready" : "Needs attention"} ${check.key}: ${check.detail}`,
          ),
          relay.readiness.ready ? "ok" : "warn",
        )
      : null,
    relay.twitchTransportMode === "relay-chatbot"
      ? h("div", { className: "actions" }, [
          actionButton("Mark Chat Bot identity live-tested", {
            id: "relayValidateChatbotIdentity",
            variant: "secondary",
            onClick: markRelayChatbotIdentityValidated,
          }),
        ])
      : null,
  ];

  return hostedMode
    ? advancedPanel("Advanced Relay Transport Details", children)
    : card("Twitch Chat Transport", children);
}

function renderLocalSetupCompletion(config, required) {
  return card("Setup Completion", [
    statusGrid([
      [
        "Completion",
        isValidationPassed() ? "complete" : "incomplete",
        isValidationPassed(),
      ],
      [
        "Client ID",
        config.hasClientId ? "present" : "missing",
        config.hasClientId,
      ],
      [
        "Client Secret",
        config.hasClientSecret ? "present" : "missing",
        config.hasClientSecret,
      ],
      [
        "OAuth Token",
        config.hasAccessToken ? "present" : "missing",
        config.hasAccessToken,
      ],
      [
        "Refresh Token",
        config.hasRefreshToken ? "available" : "missing",
        config.hasRefreshToken,
      ],
      [
        "Broadcaster",
        config.broadcasterLogin || "missing",
        Boolean(config.broadcasterLogin),
      ],
      ["Bot", config.botLogin || "missing", Boolean(config.botLogin)],
      [
        "Scopes",
        (config.scopes || []).join(", ") || "missing",
        Boolean((config.scopes || []).length),
      ],
      ["Token", config.token || "not connected", Boolean(config.token)],
      [
        "Expires",
        config.tokenExpiresAt || "unknown",
        Boolean(config.tokenExpiresAt),
      ],
    ]),
    required.length
      ? list(
          required.map((item) => `Missing required config: ${item}`),
          "warn",
        )
      : callout("Required config fields are present.", "ok"),
  ]);
}

function renderRelaySetupCompletion(relay = {}) {
  const setup = relay.setupUrls || {};
  const remote = state.relayStatus || {};
  const readiness = remote.readiness || relay.readiness || {};
  const botGrant = relayReadinessCheck(readiness, "bot-grant");
  const broadcasterGrant = relayReadinessCheck(readiness, "broadcaster-grant");
  const separateBot = relayReadinessCheck(readiness, "separate-bot-account");
  const relayMode = relay.twitchTransportMode === "relay-chatbot";
  const configured = Boolean(relay.readiness?.ready);
  const eventSubOk = relayEventSubRegistered();
  const testSendOk = relayTestMessageSent();
  const complete = Boolean(
    relayMode &&
    configured &&
    botGrant?.ok &&
    broadcasterGrant?.ok &&
    separateBot?.ok &&
    eventSubOk &&
    testSendOk &&
    relay.chatbotIdentityValidatedAt,
  );
  const blockers = [
    relayMode ? null : "Select Hosted mode.",
    configured ? null : "Start hosted Twitch setup.",
    botGrant?.ok ? null : "Authorize the bot account OAuth grant.",
    broadcasterGrant?.ok
      ? null
      : "Authorize the broadcaster channel OAuth grant.",
    separateBot?.ok
      ? null
      : "Confirm the bot and broadcaster are separate Twitch accounts.",
    eventSubOk ? null : "Register Twitch EventSub after OAuth grants.",
    testSendOk ? null : "Send a Relay test message from Console.",
    relay.chatbotIdentityValidatedAt
      ? null
      : "Record the live Twitch Chat Bot identity check.",
  ].filter(Boolean);

  return card("Setup Completion", [
    statusGrid([
      ["Completion", complete ? "relay ready" : "relay pending", complete],
      ["Relay mode", relayMode ? "selected" : "not selected", relayMode],
      ["Relay URL", relay.baseUrl || "missing", Boolean(relay.baseUrl)],
      [
        "Installation",
        relay.installationId || "missing",
        Boolean(relay.installationId),
      ],
      [
        "Console token",
        relay.hasConsoleToken ? "saved" : "missing",
        Boolean(relay.hasConsoleToken),
      ],
      [
        "Bot OAuth",
        botGrant?.ok ? "authorized" : "pending",
        Boolean(botGrant?.ok),
      ],
      [
        "Broadcaster OAuth",
        broadcasterGrant?.ok ? "authorized" : "pending",
        Boolean(broadcasterGrant?.ok),
      ],
      [
        "Separate accounts",
        separateBot?.ok ? "confirmed" : "pending",
        Boolean(separateBot?.ok),
      ],
      ["EventSub", eventSubOk ? "registered" : "not recorded", eventSubOk],
      ["Relay test send", testSendOk ? "sent" : "not recorded", testSendOk],
      [
        "Chat Bot live test",
        relay.chatbotIdentityValidatedAt || "not recorded",
        Boolean(relay.chatbotIdentityValidatedAt),
      ],
    ]),
    blockers.length
      ? list(blockers, "warn")
      : callout(
          "Hosted Relay bot setup is code-ready. Complete live Twitch validation from Console.",
          "ok",
        ),
  ]);
}
