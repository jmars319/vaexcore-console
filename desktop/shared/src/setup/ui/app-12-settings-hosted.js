function renderWindowsSetupPromptNotice() {
  if (!isWindowsSetupPrompt) {
    return null;
  }

  if (isRelayChatbotMode()) {
    return callout(
      "Hosted mode is selected. Complete the hosted Relay Setup Guide in this window; local Twitch OAuth warnings only apply if you switch to Local mode.",
      "info",
    );
  }

  return callout(
    "Twitch setup is not complete yet. Complete the Setup Guide in this window before a real chat bot or stream-key test. This window is safe to close if you are not testing Twitch right now.",
    "warn",
  );
}

function renderHostedRelaySetup(relay = {}, options = {}) {
  const setup = relay.setupUrls || {};
  const remote = state.relayStatus || {};
  const readiness = remote.readiness || {};
  const botGrant = relayReadinessCheck(readiness, "bot-grant");
  const broadcasterGrant = relayReadinessCheck(readiness, "broadcaster-grant");
  const separateBot = relayReadinessCheck(readiness, "separate-bot-account");
  const installation = remote.installation || {};
  const eventSubResult = state.relayEventSubResult || {};
  const testSendResult = state.relayTestSendResult || {};
  const eventSubOk = relayEventSubRegistered();
  const testSendOk = relayTestMessageSent();
  const relayConfigured = Boolean(relay.readiness?.ready);
  const relayMode = relay.twitchTransportMode === "relay-chatbot";
  const botOAuthUrl = setup.twitchBotOAuthUrl;
  const broadcasterOAuthUrl = setup.twitchBroadcasterOAuthUrl;
  const showAdvancedUrls = options.showAdvancedUrls !== false;

  return card("Hosted Relay Bot Setup", [
    statusGrid([
      ["Relay mode", relayMode ? "selected" : "not selected", relayMode],
      [
        "Hosted pairing",
        relayConfigured ? "saved" : "not connected",
        relayConfigured,
      ],
      [
        "Relay health",
        remote.connected ? "connected" : remote.error || "not checked",
        Boolean(remote.connected),
      ],
      [
        "Bot OAuth",
        installation.botLogin || (botGrant?.ok ? "authorized" : "pending"),
        Boolean(botGrant?.ok || installation.botLogin),
      ],
      [
        "Broadcaster OAuth",
        installation.broadcasterLogin ||
          (broadcasterGrant?.ok ? "authorized" : "pending"),
        Boolean(broadcasterGrant?.ok || installation.broadcasterLogin),
      ],
      [
        "Separate accounts",
        separateBot?.ok ? "confirmed" : "pending",
        Boolean(separateBot?.ok),
      ],
      [
        "Chat Bot live test",
        relay.chatbotIdentityValidatedAt || "not recorded",
        Boolean(relay.chatbotIdentityValidatedAt),
      ],
    ]),
    relayMode
      ? callout(
          relayConfigured
            ? "Hosted Relay is paired. Finish the Twitch account grants, let Relay register EventSub, then send a test message."
            : "Start hosted Twitch setup to create a Relay installation without showing a Twitch client secret, Relay admin token, installation ID, or Console token.",
          "ok",
        )
      : callout(
          "Select Hosted mode and save settings before live Chat Bot validation.",
          "warn",
        ),
    h("div", { className: "actions" }, [
      !relayConfigured
        ? actionButton("Start hosted setup", {
            id: "relayHostedConnect",
            busyKey: "relayHostedConnect",
            onClick: () => connectHostedRelay(false),
          })
        : null,
      relayConfigured
        ? actionButton("Log in as vaexcorebot", {
            id: "relayAuthorizeBot",
            variant: "secondary",
            disabled: !botOAuthUrl,
            onClick: () => openExternalSetupUrl(botOAuthUrl),
          })
        : null,
      relayConfigured
        ? actionButton("Log in as broadcaster", {
            id: "relayAuthorizeBroadcaster",
            variant: "secondary",
            disabled: !broadcasterOAuthUrl,
            onClick: () => openExternalSetupUrl(broadcasterOAuthUrl),
          })
        : null,
      relayConfigured
        ? actionButton("Refresh hosted status", {
            id: "relayStatus",
            variant: "secondary",
            disabled: !relayConfigured,
            onClick: checkRelayStatus,
          })
        : null,
    ]),
    showAdvancedUrls
      ? h(
          "details",
          disclosureAttributes("settings:hosted-urls", false, {
            className: "advanced-panel",
          }),
          [
            h("summary", {}, [h("strong", { text: "Advanced hosted URLs" })]),
            setupUrlRow(
              "Twitch callback URL",
              setup.twitchCallbackUrl,
              "Already configured for the hosted VaexCore Twitch app. Self-hosted operators can use this for their own app.",
              [
                {
                  label: "Copy",
                  onClick: () => copySetupText(setup.twitchCallbackUrl),
                },
              ],
            ),
            setupUrlRow(
              "Bot OAuth",
              botOAuthUrl,
              "Open while logged into vaexcorebot.",
              [
                {
                  label: "Copy",
                  onClick: () => copySetupText(botOAuthUrl),
                },
                {
                  label: "Open bot OAuth",
                  onClick: () => openExternalSetupUrl(botOAuthUrl),
                },
              ],
            ),
            setupUrlRow(
              "Broadcaster OAuth",
              broadcasterOAuthUrl,
              "Open while logged into the broadcaster account.",
              [
                {
                  label: "Copy",
                  onClick: () => copySetupText(broadcasterOAuthUrl),
                },
                {
                  label: "Open broadcaster OAuth",
                  onClick: () => openExternalSetupUrl(broadcasterOAuthUrl),
                },
              ],
            ),
            setupUrlRow(
              "Discord interactions",
              setup.discordInteractionUrl,
              "Use after Discord Worker secrets are set.",
              [
                {
                  label: "Copy",
                  onClick: () => copySetupText(setup.discordInteractionUrl),
                },
              ],
            ),
          ],
        )
      : null,
    remote.error
      ? callout(remote.error, remote.ok === false ? "bad" : "warn")
      : null,
    readiness.checks?.length
      ? list(
          readiness.checks.map(
            (check) =>
              `${check.ok ? "Ready" : "Needs setup"} ${check.key}: ${check.detail}`,
          ),
          readiness.ready ? "ok" : "warn",
        )
      : relay.readiness?.checks?.length
        ? list(
            relay.readiness.checks.map(
              (check) =>
                `${check.ok ? "Ready" : "Needs setup"} ${check.key}: ${check.detail}`,
            ),
            relay.readiness.ready ? "ok" : "warn",
          )
        : null,
    eventSubOk
      ? callout("Twitch EventSub registration completed through Relay.", "ok")
      : eventSubResult.error
        ? callout(eventSubResult.error, "bad")
        : botGrant?.ok && broadcasterGrant?.ok && separateBot?.ok
          ? callout(
              "Required next step: register Twitch EventSub so Relay can receive channel chat events.",
              "warn",
            )
          : null,
    testSendOk
      ? callout("Relay test chat message sent.", "ok")
      : testSendResult.error
        ? callout(testSendResult.error, "bad")
        : null,
    h("div", { className: "actions" }, [
      relayConfigured && showAdvancedUrls
        ? actionButton("Reset hosted pairing", {
            id: "relayHostedConnectReset",
            variant: "secondary",
            busyKey: "relayHostedConnect",
            onClick: () => connectHostedRelay(true),
          })
        : null,
      actionButton(
        eventSubOk ? "Register Twitch EventSub" : "Register required EventSub",
        {
          id: "relayRegisterEventSub",
          variant: eventSubOk ? "secondary" : undefined,
          disabled:
            !relayConfigured ||
            !botGrant?.ok ||
            !broadcasterGrant?.ok ||
            !separateBot?.ok,
          onClick: registerRelayEventSub,
        },
      ),
      actionButton("Send Relay test message", {
        id: "relayTestSend",
        variant: "secondary",
        disabled: !relayConfigured || !relayMode || !eventSubOk,
        onClick: sendRelayTestMessage,
      }),
      actionButton("Mark Chat Bot identity live-tested", {
        id: "relayValidateChatbotIdentityHosted",
        variant: "secondary",
        disabled: !relayMode,
        onClick: markRelayChatbotIdentityValidated,
      }),
    ]),
  ]);
}

function setupUrlRow(label, url, detail, actions = []) {
  const available = Boolean(url);
  return h("div", { className: "template-row setup-url-row" }, [
    h("span", {}, [
      h("strong", { text: label }),
      h("small", { text: detail }),
      h("code", {
        text: available ? url : "Save Relay URL and installation ID first.",
      }),
    ]),
    h(
      "div",
      { className: "actions inline-actions" },
      actions.map((action) =>
        actionButton(action.label, {
          variant: "secondary",
          disabled: !available,
          onClick: action.onClick,
        }),
      ),
    ),
  ]);
}

function relayReadinessCheck(readiness = {}, key) {
  return (readiness.checks || []).find((check) => check.key === key);
}

function botCompletionCheck(key) {
  return (state.botCompletion?.checks || []).find((check) => check.key === key);
}

function botCompletionComplete(key) {
  return Boolean(botCompletionCheck(key)?.complete);
}

function relayEventSubRegistered() {
  return Boolean(
    state.relayEventSubResult?.ok || botCompletionComplete("twitch-eventsub"),
  );
}

function relayTestMessageSent() {
  return Boolean(
    state.relayTestSendResult?.ok || botCompletionComplete("twitch-test-send"),
  );
}

function isRelayChatbotMode(config = state.config || {}) {
  return config.relay?.twitchTransportMode === "relay-chatbot";
}

function getRelaySetupProgress(relay = state.config?.relay || {}) {
  const setup = relay.setupUrls || {};
  const remote = state.relayStatus || {};
  const readiness = remote.readiness || relay.readiness || {};
  const botGrant = relayReadinessCheck(readiness, "bot-grant");
  const broadcasterGrant = relayReadinessCheck(readiness, "broadcaster-grant");
  const separateBot = relayReadinessCheck(readiness, "separate-bot-account");
  const progress = {
    relayMode: relay.twitchTransportMode === "relay-chatbot",
    relayPaired: Boolean(relay.readiness?.ready),
    callbackUrlReady: Boolean(setup.twitchCallbackUrl || relay.baseUrl),
    botAuthorized: Boolean(botGrant?.ok || remote.installation?.botLogin),
    broadcasterAuthorized: Boolean(
      broadcasterGrant?.ok || remote.installation?.broadcasterLogin,
    ),
    separateAccounts: Boolean(separateBot?.ok),
    eventSubRegistered: relayEventSubRegistered(),
    relayTestSent: relayTestMessageSent(),
    chatbotIdentityValidated: Boolean(relay.chatbotIdentityValidatedAt),
    discordEndpointReady: Boolean(setup.discordInteractionUrl),
  };

  return {
    ...progress,
    steps: [
      {
        id: "relay-pair",
        label: "Hosted Relay connected",
        complete: progress.relayMode && progress.relayPaired,
      },
      {
        id: "relay-bot-oauth",
        label: "Bot OAuth",
        complete: progress.botAuthorized,
      },
      {
        id: "relay-broadcaster-oauth",
        label: "Broadcaster OAuth",
        complete: progress.broadcasterAuthorized,
      },
      {
        id: "relay-eventsub",
        label: "EventSub registered",
        complete: progress.eventSubRegistered,
      },
      {
        id: "relay-test",
        label: "Chat Bot verified",
        complete: progress.relayTestSent && progress.chatbotIdentityValidated,
      },
    ],
  };
}
