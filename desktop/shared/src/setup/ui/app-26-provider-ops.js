function renderProviderOnboardingCard() {
  const onboarding = state.botCompletion?.providerOnboarding || {};
  const steps = onboarding.steps || [];

  return card("Provider Setup Wizard", [
    callout(
      onboarding.headline ||
        "Refresh bot completion to load Twitch, Discord, and Relay setup steps.",
      onboarding.status === "ready" ? "ok" : "warn",
    ),
    steps.length
      ? h(
          "div",
          { className: "bot-completion-sections" },
          steps.map((step, index) =>
            h(
              "div",
              {
                className: `bot-completion-section ${
                  step.complete ? "ok ready" : "warn todo"
                }`,
              },
              [
                h("div", { className: "bot-completion-section-head" }, [
                  h("span", {}, [
                    h("strong", { text: `${index + 1}. ${step.label}` }),
                    h("small", { text: step.detail || step.nextAction || "" }),
                  ]),
                  h("span", {
                    className: `chip ${step.complete ? "ok" : "warn"}`,
                    text: step.complete ? "ready" : "todo",
                  }),
                ]),
              ],
            ),
          ),
        )
      : callout("Provider setup steps have not been loaded yet.", "muted"),
    h("div", { className: "actions" }, [
      actionButton("Start hosted setup", {
        id: "providerWizardHostedSetup",
        variant: "secondary",
        busyKey: "relayHostedConnect",
        requiredRole: "admin",
        onClick: () => connectHostedRelay(false),
      }),
      actionButton("Open bot OAuth", {
        id: "providerWizardBotOAuth",
        variant: "secondary",
        requiredRole: "admin",
        disabled: !state.config?.relay?.setupUrls?.twitchBotOAuthUrl,
        onClick: () =>
          openExternalSetupUrl(
            state.config?.relay?.setupUrls?.twitchBotOAuthUrl,
          ),
      }),
      actionButton("Open broadcaster OAuth", {
        id: "providerWizardBroadcasterOAuth",
        variant: "secondary",
        requiredRole: "admin",
        disabled: !state.config?.relay?.setupUrls?.twitchBroadcasterOAuthUrl,
        onClick: () =>
          openExternalSetupUrl(
            state.config?.relay?.setupUrls?.twitchBroadcasterOAuthUrl,
          ),
      }),
      actionButton("Register EventSub", {
        id: "providerWizardEventSub",
        variant: "secondary",
        busyKey: "relayRegisterEventSub",
        requiredRole: "admin",
        onClick: registerRelayEventSub,
      }),
      actionButton("Register Discord commands", {
        id: "providerWizardDiscordCommands",
        variant: "secondary",
        busyKey: "discordRelayRegisterCommands",
        requiredRole: "admin",
        onClick: registerDiscordRelayCommands,
      }),
    ]),
  ]);
}

function renderBotIdentityDashboard() {
  const identity = state.botCompletion?.botIdentity || {};
  const bot = identity.bot || {};
  const broadcaster = identity.broadcaster || {};
  const scopes = identity.twitchScopes || {};
  const relay = identity.relayTransport || {};
  const discord = identity.discordInstall || {};
  const reconnectActions = identity.reconnectActions || [];

  return card("Bot Identity Dashboard", [
    statusGrid([
      [
        "Broadcaster",
        broadcaster.login || "missing",
        Boolean(broadcaster.login && broadcaster.oauthReady),
      ],
      [
        "Bot account",
        bot.login || "missing",
        Boolean(bot.login && bot.oauthReady),
      ],
      [
        "Token freshness",
        tokenFreshnessLabel(bot),
        tokenFreshnessReady(bot) ||
          Boolean(bot.oauthReady && !bot.tokenExpiresAt),
      ],
      [
        "Scopes",
        scopes.ready ? "ready" : missingScopeLabel(scopes),
        Boolean(scopes.ready),
      ],
      [
        "EventSub",
        identity.eventSub?.state || "todo",
        identity.eventSub?.ready,
      ],
      ["Relay", relay.state || "not checked", Boolean(relay.connected)],
      [
        "Discord",
        discord.state || "not checked",
        Boolean(discord.slashCommandsReady),
      ],
    ]),
    relay.detail
      ? callout(relay.detail, relay.connected ? "ok" : "warn")
      : null,
    reconnectActions.length
      ? h("div", { className: "bot-next-actions" }, [
          h("strong", { text: "Reconnect or reauthorize" }),
          list(reconnectActions.slice(0, 6), "warn"),
        ])
      : callout("No reconnect actions are currently reported.", "ok"),
    h("div", { className: "actions" }, [
      actionButton("Refresh identity", {
        id: "botIdentityRefresh",
        variant: "secondary",
        busyKey: "botCompletion",
        onClick: refreshBotCompletion,
      }),
      actionButton("Check Relay", {
        id: "botIdentityRelayStatus",
        variant: "secondary",
        busyKey: "relayStatus",
        onClick: checkRelayStatus,
      }),
      actionButton("Check Discord", {
        id: "botIdentityDiscordStatus",
        variant: "secondary",
        busyKey: "discordRelayStatus",
        onClick: checkDiscordRelayStatus,
      }),
    ]),
  ]);
}

function renderConsoleGoLiveChecklist() {
  const checklist = state.botCompletion?.goLiveChecklist || {};
  const items = checklist.items || [];

  return card("Go Live Checklist", [
    callout(
      checklist.status === "ready"
        ? "Console provider setup is ready for live operation."
        : checklist.nextAction ||
            "Refresh bot completion to load go-live blockers.",
      checklist.status === "ready" ? "ok" : "warn",
    ),
    items.length
      ? h(
          "div",
          { className: "bot-check-list" },
          items.map((item) =>
            h("div", { className: "bot-check-row" }, [
              h("span", {
                className: item.complete ? "ok" : "warn",
                text: item.complete ? "ready" : "blocked",
              }),
              h("span", {}, [
                h("strong", { text: item.label }),
                h("small", { text: item.detail }),
              ]),
            ]),
          ),
        )
      : callout("Go-live checklist has not been loaded yet.", "muted"),
    h("div", { className: "actions" }, [
      actionButton("Run Operations Check", {
        id: "goLiveOperationsCheck",
        variant: "secondary",
        busyKey: "localRehearsal",
        onClick: runFullLocalRehearsal,
      }),
      actionButton("Refresh completion", {
        id: "goLiveRefreshCompletion",
        variant: "secondary",
        busyKey: "botCompletion",
        onClick: refreshBotCompletion,
      }),
      actionButton("Suite status", {
        id: "goLiveSuiteStatus",
        variant: "secondary",
        busyKey: "suiteStatus",
        onClick: loadSuiteStatus,
      }),
    ]),
  ]);
}

function renderProviderActivityTimeline() {
  const events = providerTimelineEvents();

  return card("Provider Activity Timeline", [
    statusGrid([
      [
        "Relay",
        state.relayStatus?.connected ? "connected" : "not checked",
        state.relayStatus?.connected,
      ],
      ["Twitch events", state.relayEvents.length, state.relayEvents.length > 0],
      [
        "Discord events",
        state.discordRelayEvents.length,
        state.discordRelayEvents.length > 0,
      ],
      [
        "Discord actions",
        state.discordRelayActions.length,
        state.discordRelayActions.length === 0,
      ],
      [
        "Suggestions",
        state.discordRelaySuggestions.length,
        state.discordRelaySuggestions.length === 0,
      ],
    ]),
    events.length
      ? h(
          "div",
          { className: "template-list compact-list" },
          events.slice(0, 12).map((event) =>
            h("div", { className: "template-row" }, [
              h("span", {}, [
                h("strong", { text: event.label }),
                h("small", { text: event.detail }),
              ]),
              h("span", {
                className: `chip ${event.tone || "info"}`,
                text: event.kind,
              }),
            ]),
          ),
        )
      : callout(
          "Load provider activity to review Relay chat events, Discord interactions, suggestions, announcements, and recent errors.",
          "muted",
        ),
    h("div", { className: "actions" }, [
      actionButton("Load provider activity", {
        id: "providerActivityLoad",
        variant: "secondary",
        busyKey: "providerActivity",
        onClick: loadProviderActivity,
      }),
      actionButton("Send Relay test", {
        id: "providerActivityRelayTest",
        variant: "secondary",
        busyKey: "relayTestSend",
        requiredRole: "admin",
        onClick: sendRelayTestMessage,
      }),
    ]),
  ]);
}

function providerTimelineEvents() {
  const relayEvents = (state.relayEvents || []).map((event) => ({
    kind: "Twitch",
    tone: "info",
    label: `${event.userDisplayName || event.userLogin || "viewer"}: ${formatMessagePreview(event.text || "")}`,
    detail: formatProviderTimestamp(event.receivedAt),
  }));
  const discordEvents = (state.discordRelayEvents || []).map((event) => ({
    kind: "Discord",
    tone: event.allowed === false ? "warn" : "info",
    label: event.commandName ? `/${event.commandName}` : "Discord interaction",
    detail: `${event.username || event.userId || "unknown"} at ${formatProviderTimestamp(event.receivedAt)}`,
  }));
  const suggestions = (state.discordRelaySuggestions || []).map((item) => ({
    kind: "Suggestion",
    tone: item.status === "new" ? "warn" : "info",
    label: item.text || "Viewer suggestion",
    detail: `${item.username || item.userId || "unknown"} - ${item.status || "new"}`,
  }));
  const actions = (state.discordRelayActions || []).map((item) => ({
    kind: "Announcement",
    tone: item.status === "active" ? "warn" : "info",
    label: item.title || item.action || item.kind || "Queued action",
    detail: `${item.status || "queued"} at ${formatProviderTimestamp(item.createdAt || item.updatedAt || "")}`,
  }));
  const outbound = (state.outboundMessages || [])
    .slice(0, 5)
    .map((message) => ({
      kind: "Chat",
      tone: message.status === "failed" ? "warn" : "info",
      label: formatMessagePreview(message.message || message.body || ""),
      detail: `${message.status || "queued"} at ${formatProviderTimestamp(message.createdAt || message.sentAt || "")}`,
    }));
  const records = (state.botCompletion?.validation?.checklist || [])
    .filter((item) => item.recordedAt)
    .map((item) => ({
      kind: "Validation",
      tone: "ok",
      label: item.label,
      detail: `recorded ${formatProviderTimestamp(item.recordedAt)}`,
    }));

  return [
    ...relayEvents,
    ...discordEvents,
    ...suggestions,
    ...actions,
    ...outbound,
    ...records,
  ];
}

function tokenFreshnessLabel(bot = {}) {
  if (!bot.tokenExpiresAt) {
    return bot.oauthReady ? "relay-managed" : "not checked";
  }
  const expiry = Date.parse(bot.tokenExpiresAt);
  if (!Number.isFinite(expiry)) return "unknown";
  if (expiry <= Date.now()) return "expired";
  return `expires ${new Date(expiry).toLocaleString()}`;
}

function tokenFreshnessReady(bot = {}) {
  if (!bot.tokenExpiresAt) return false;
  const expiry = Date.parse(bot.tokenExpiresAt);
  return Number.isFinite(expiry) && expiry > Date.now();
}

function missingScopeLabel(scopes = {}) {
  const missing = scopes.missing || [];
  if (!missing.length) return "not checked";
  return `missing ${missing.join(", ")}`;
}

function formatProviderTimestamp(value) {
  if (!value) return "unknown time";
  return formatTimelineTimestamp(value);
}

async function loadSuiteStatus() {
  await runAction(
    "suiteStatus",
    async () => {
      const result = await api.suiteStatus();
      state.suiteStatus = result;
      return result;
    },
    { skipRefresh: true, success: "Suite status loaded." },
  );
}
