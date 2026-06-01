function renderDiscordHostedConnectCard() {
  const relay =
    state.discord?.config?.relay || state.config?.discord?.relay || {};
  const status = state.discordRelayStatus || {};
  const hosted = discordHostedConfig();
  const connected = Boolean(hosted.connected || hosted.guildId);
  const secretReady = Boolean(
    hosted.hasApplicationId && hosted.hasClientSecret && hosted.hasBotToken,
  );

  return card("Hosted Discord Connect", [
    statusGrid([
      ["Relay", relay.configured ? "configured" : "missing", relay.configured],
      [
        "Discord app",
        secretReady ? "ready" : "needs Worker secrets",
        secretReady,
      ],
      [
        "Server",
        connected
          ? hosted.guildName || hosted.guildId || "connected"
          : "not connected",
        connected,
      ],
      [
        "Setup",
        hosted.setupAppliedAt || "not applied",
        Boolean(hosted.setupAppliedAt),
      ],
    ]),
    connected ? callout("Connected through Relay.", "ok") : null,
    status.readiness?.checks?.some(
      (check) =>
        !check.ok &&
        [
          "discord-bot-token",
          "discord-application-id",
          "discord-client-secret",
        ].includes(check.key),
    )
      ? callout(
          "Relay needs DISCORD_APPLICATION_ID, DISCORD_CLIENT_SECRET, DISCORD_BOT_TOKEN, and DISCORD_PUBLIC_KEY before hosted Discord setup can run.",
          "warn",
        )
      : null,
    h("div", { className: "actions" }, [
      actionButton(connected ? "Reconnect Discord" : "Connect Discord", {
        id: "discordRelayInstallStart",
        onClick: startDiscordRelayInstall,
      }),
      actionButton("Refresh hosted status", {
        id: "discordRelayHostedRefresh",
        variant: "secondary",
        onClick: checkDiscordRelayStatus,
      }),
      actionButton("Register slash commands", {
        id: "discordRelayRegisterCommandsHosted",
        variant: "secondary",
        onClick: registerDiscordRelayCommands,
      }),
    ]),
  ]);
}

function renderDiscordRelayPanel(discord) {
  const relay =
    discord.relay ||
    discord.config?.relay ||
    state.config?.discord?.relay ||
    {};
  const remote = state.discordRelayStatus || {};
  const suggestions = state.discordRelaySuggestions || [];
  const actions = state.discordRelayActions || [];
  const readiness = remote.readiness || {};
  const localReadiness = relay.localReadiness || {};

  return card("Relay Slash Commands And Suggestions", [
    statusGrid([
      [
        "Relay configured",
        relay.configured ? "ready" : "missing",
        relay.configured,
      ],
      [
        "Interaction URL",
        relay.interactionUrl || "missing",
        Boolean(relay.interactionUrl),
      ],
      [
        "Relay health",
        remote.connected ? "connected" : remote.error || "not checked",
        remote.connected,
      ],
      [
        "Slash commands",
        readiness.ready ? "registered" : "not validated",
        Boolean(readiness.ready),
      ],
      ["Suggestions loaded", suggestions.length || 0, suggestions.length >= 0],
      ["Announcement actions", actions.length || 0, actions.length >= 0],
    ]),
    relay.interactionUrl
      ? callout(
          `Relay Discord setup uses Worker secrets and this public endpoint for slash commands and suggestions. Set the Discord application Interactions Endpoint URL to ${relay.interactionUrl}.`,
          "info",
        )
      : callout(
          "Save Relay settings before configuring Discord slash commands and suggestions.",
          "warn",
        ),
    remote.error
      ? callout(remote.error, remote.ok === false ? "bad" : "warn")
      : null,
    readiness.checks?.length
      ? list(
          readiness.checks.map(
            (check) =>
              `${check.ok ? "PASS" : "TODO"} ${check.key}: ${check.detail}`,
          ),
          readiness.ready ? "ok" : "warn",
        )
      : localReadiness.checks?.length
        ? list(
            localReadiness.checks.map(
              (check) =>
                `${check.ok ? "PASS" : "TODO"} ${check.key}: ${check.detail}`,
            ),
            localReadiness.ready ? "ok" : "warn",
          )
        : null,
    h("div", { className: "actions" }, [
      actionButton("Check Relay", {
        id: "discordRelayStatus",
        variant: "secondary",
        onClick: checkDiscordRelayStatus,
      }),
      actionButton("Register slash commands", {
        id: "discordRelayRegisterCommands",
        variant: "secondary",
        onClick: registerDiscordRelayCommands,
      }),
      actionButton("Load suggestions", {
        id: "discordRelayLoadSuggestions",
        variant: "secondary",
        onClick: loadDiscordRelaySuggestions,
      }),
      actionButton("Load action queue", {
        id: "discordRelayLoadActions",
        variant: "secondary",
        onClick: () => loadDiscordRelayActions(undefined, true),
      }),
    ]),
    h("div", { className: "actions segmented-actions" }, [
      ...["active", "queued", "approved", "rejected", "sent"].map((status) =>
        actionButton(status, {
          id: `discordRelayActionFilter-${status}`,
          className: `segmented-button${
            state.discordRelayActionFilter === status ? " active" : ""
          }`,
          onClick: () => loadDiscordRelayActions(status),
        }),
      ),
    ]),
    actions.length
      ? h(
          "div",
          { className: "template-list" },
          actions.map((action) =>
            h("div", { className: "template-row" }, [
              h("span", {}, [
                h("strong", { text: `/${action.commandName}` }),
                h("small", {
                  text: `${action.username} - ${action.status} - ${action.receivedAt || ""}${discordRelayActionOptions(action)}`,
                }),
              ]),
              h("div", { className: "actions inline-actions" }, [
                ...["approved", "rejected", "sent"].map((status) =>
                  actionButton(status, {
                    id: `discord-action-${action.relayEventId}-${status}`,
                    variant: "secondary",
                    disabled: action.status === status,
                    onClick: () =>
                      markDiscordRelayAction(action.relayEventId, status),
                  }),
                ),
              ]),
            ]),
          ),
        )
      : callout(
          "No Relay announcement actions are loaded. Public /live, /late, /cancelled, and /scheduled commands stay reviewable here.",
          "muted",
        ),
    suggestions.length
      ? h(
          "div",
          { className: "template-list" },
          suggestions.map((suggestion) =>
            h("div", { className: "template-row" }, [
              h("span", {}, [
                h("strong", { text: suggestion.text }),
                h("small", {
                  text: `${suggestion.username} - ${suggestion.status} - ${suggestion.createdAt || ""}`,
                }),
              ]),
              h("div", { className: "actions inline-actions" }, [
                ...["reviewed", "accepted", "rejected", "archived"].map(
                  (status) =>
                    actionButton(status, {
                      id: `discord-suggestion-${suggestion.id}-${status}`,
                      variant: "secondary",
                      onClick: () =>
                        updateDiscordRelaySuggestion(suggestion.id, status),
                    }),
                ),
              ]),
            ]),
          ),
        )
      : callout("No Relay suggestions loaded.", "muted"),
  ]);
}

function discordRelayActionOptions(action) {
  const entries = Object.entries(action.options || {});
  if (!entries.length) return "";
  return ` - ${entries
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ")}`;
}

function discordHostedConfig() {
  return (
    state.discordRelayStatus?.hosted ||
    state.discordRelayStatus?.config ||
    state.discord?.relay?.hosted ||
    {}
  );
}

function discordHostedConnected() {
  const hosted = discordHostedConfig();
  return Boolean(hosted.connected || hosted.guildId);
}

function useHostedDiscordSetup() {
  return (
    selectedSetupMode(state.config || {}) !== "local-only" &&
    discordHostedConnected()
  );
}

function renderDiscordPlan(result) {
  if (!result?.plan) {
    return callout(
      "Preview setup to see exactly which categories, text channels, voice channels, and optional roles Console will create.",
    );
  }

  const plan = result.plan;
  const summary = plan.summary || {};
  const actions = plan.actions || [];

  return h("div", { className: "discord-plan" }, [
    statusGrid([
      ["Channels to create", summary.channelsToCreate || 0],
      ["Existing channels", summary.existingChannels || 0],
      ["Roles to create", summary.rolesToCreate || 0],
      ["Skipped roles", summary.skippedRoles || 0],
      ["Permission actions", summary.permissionOverwrites || 0],
      ["Starter messages", summary.starterMessagesToPost || 0],
      ["Starter messages skipped", summary.starterMessagesSkipped || 0],
      [
        "Blocked privacy",
        (summary.blockedPermissions || 0) +
          (summary.starterMessagesBlocked || 0),
        !(summary.blockedPermissions || summary.starterMessagesBlocked),
      ],
    ]),
    callout(
      "Required bot permissions for the full setup: View Channels, Manage Channels, Manage Roles, Send Messages, and Embed Links. Created roles intentionally avoid Administrator, Kick Members, Ban Members, and Manage Server.",
      "info",
    ),
    h("div", { className: "compact-capability-list" }, [
      h("span", { text: "Stream alerts map to live-now." }),
      h("span", { text: "General announcements map to announcements." }),
      h("span", { text: "Relay suggestions map to suggestions." }),
      h("span", { text: "Relay operators map to VaexCore Operator." }),
      h("span", {
        text: plan.lockStaffCategory
          ? "Staff privacy will only touch the STAFF category."
          : "Staff privacy is preview-only until enabled with a Staff role.",
      }),
    ]),
    result.message ? callout(result.message, "warn") : null,
    h(
      "ul",
      { className: "discord-plan-list", "data-scroll-key": "discord-plan" },
      actions.map((action) =>
        h("li", {
          className:
            action.type === "create_channel" || action.type === "create_role"
              ? "warn"
              : action.type === "blocked_permission" ||
                  action.type === "blocked_starter_message"
                ? "bad"
                : action.type === "apply_permission_overwrite" ||
                    action.type === "post_starter_message"
                  ? "warn"
                  : action.type === "skip_role" ||
                      action.type === "skip_starter_message"
                    ? "muted"
                    : "ok",
          text: `${action.name}: ${action.detail}`,
        }),
      ),
    ),
  ]);
}
function renderSuite() {
  const suite = state.suiteStatus || {};
  const apps = suite.apps || [];
  const timeline = suite.timeline || [];
  const expectedApps = apps.length || 3;
  const readyApps = apps.filter(
    (app) => app.installed && app.running && app.reachable && !app.stale,
  ).length;

  return [
    sectionHeader(
      "Suite",
      "Shared app presence, local session, launcher, and timeline.",
      h("div", { className: "actions" }, [
        actionButton("Refresh", {
          id: "suiteRefresh",
          variant: "secondary",
          onClick: refreshAll,
          busyKey: "refresh",
        }),
        actionButton("Launch Suite", {
          id: "suiteLaunch",
          variant: "secondary",
          busyKey: "launchSuite",
          onClick: launchSuite,
        }),
      ]),
    ),
    card("Suite Session", [
      statusGrid([
        ["Session", suite.session?.title || "none", Boolean(suite.session)],
        [
          "Session ID",
          suite.session?.sessionId || "none",
          Boolean(suite.session),
        ],
        [
          "Ready Apps",
          `${readyApps}/${expectedApps}`,
          readyApps === expectedApps,
        ],
        ["Protocol", `schema ${suite.protocol?.schemaVersion || 1}`, true],
      ]),
      suite.protocol?.directory
        ? callout(suite.protocol.directory, "muted")
        : null,
    ]),
    card("Suite Presence", [
      apps.length
        ? h(
            "div",
            { className: "suite-list" },
            apps.map((app) =>
              h("div", { className: "suite-row" }, [
                h("span", {}, [
                  h("strong", { text: app.appName }),
                  h("small", { text: app.activityDetail || app.detail }),
                  h("small", { text: app.healthUrl || app.discoveryFile }),
                ]),
                h("span", {
                  className: `chip ${suiteStatusTone(app)}`,
                  text: suiteStatusLabel(app),
                }),
                h("span", {
                  className: "chip muted",
                  text: app.suiteSessionId ? "in session" : "no session",
                }),
              ]),
            ),
          )
        : callout("No suite status is available yet.", "warn"),
    ]),
    card("Suite Timeline", [
      timeline.length
        ? h(
            "div",
            { className: "suite-list" },
            timeline.map((item) =>
              h("div", { className: "suite-row timeline" }, [
                h("span", {}, [
                  h("strong", { text: item.title }),
                  h("small", { text: item.detail }),
                ]),
                h("span", {
                  className: "chip muted",
                  text: item.sourceAppName,
                }),
                h("span", {
                  className: "chip muted",
                  text: formatTimelineTimestamp(item.createdAt),
                }),
              ]),
            ),
          )
        : callout("No shared suite activity yet.", "muted"),
    ]),
    message(),
  ];
}

function renderTesting() {
  return [
    sectionHeader(
      "Testing",
      "Testing tools are for local verification before using a live stream.",
    ),
    card("Simulate Entrant", [
      h("div", { className: "grid" }, [
        formRow(
          "Username/login",
          h("input", { id: "simLogin", placeholder: "alice" }),
        ),
        formRow(
          "Display name",
          h("input", { id: "simDisplayName", placeholder: "Alice" }),
        ),
      ]),
      h("div", { className: "actions" }, [
        actionButton("Add entrant", {
          id: "addEntrant",
          variant: "secondary",
          onClick: () =>
            runGiveawayAction("add-entrant", {
              login: field("simLogin").value,
              displayName: field("simDisplayName").value,
            }),
        }),
      ]),
    ]),
    card("Simulate Command", [
      h("div", { className: "grid three" }, [
        formRow("Actor username", h("input", { id: "simActor" })),
        formRow(
          "Actor role",
          h("select", { id: "simRole" }, [
            option("viewer", "viewer"),
            option("mod", "mod"),
            option("broadcaster", "broadcaster"),
          ]),
        ),
        formRow("Command text", h("input", { id: "simCommand" })),
      ]),
      h("div", { className: "actions" }, [
        actionButton("Run command", {
          id: "runCommand",
          variant: "secondary",
          onClick: runSimulatedCommand,
        }),
        actionButton("Run local lifecycle test", {
          id: "runTestGiveaway",
          variant: "secondary",
          onClick: runLifecycleTest,
        }),
      ]),
      renderTestResult(),
    ]),
    message(),
  ];
}
