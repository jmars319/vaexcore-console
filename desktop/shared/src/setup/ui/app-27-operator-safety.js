const operatorRoleRanks = {
  viewer: 0,
  moderator: 1,
  admin: 2,
  owner: 3,
};

function operatorRoleAllows(requiredRole = "viewer") {
  return (
    operatorRoleRanks[state.operatorRole || "owner"] >=
    operatorRoleRanks[requiredRole]
  );
}

function operatorRoleBlockedReason(requiredRole = "viewer") {
  return `Blocked because ${state.operatorRole || "owner"} mode requires ${requiredRole} or higher.`;
}

function setOperatorRole(role) {
  state.operatorRole = operatorRoleRanks[role] === undefined ? "owner" : role;
  try {
    window.localStorage?.setItem("vaexcore.operatorRole", state.operatorRole);
  } catch {
    // Browser storage is optional; the role still applies to this session.
  }
  render();
}

function renderOperatorRoleCard() {
  const role = state.operatorRole || "owner";
  return card("Local Operator Role", [
    statusGrid([
      ["Current role", role, true],
      [
        "Provider setup",
        operatorRoleAllows("admin") ? "allowed" : "blocked",
        operatorRoleAllows("admin"),
      ],
      [
        "Moderation review",
        operatorRoleAllows("moderator") ? "allowed" : "blocked",
        operatorRoleAllows("moderator"),
      ],
      [
        "Viewer mode",
        role === "viewer" ? "read-only" : "operator",
        role !== "viewer",
      ],
    ]),
    h("div", { className: "grid three" }, [
      formRow(
        "Role mode",
        h(
          "select",
          {
            id: "operatorRoleSelect",
            onChange: (event) => setOperatorRole(event.target.value),
          },
          ["owner", "admin", "moderator", "viewer"].map((item) =>
            h("option", {
              value: item,
              selected: item === role,
              text: item,
            }),
          ),
        ),
      ),
    ]),
    list(
      [
        "Owner: local setup, provider registration, live approvals, moderation, and tests.",
        "Admin: provider setup, approvals, moderation, and tests.",
        "Moderator: review/reject queues, moderation simulations, and local tests.",
        "Viewer: read-only inspection of status, replay, and diagnostics.",
      ],
      "muted",
    ),
  ]);
}

function renderModerationSafetyCard() {
  const canModerate = operatorRoleAllows("moderator");
  const canAdmin = operatorRoleAllows("admin");
  return card("Moderation And Event Safety", [
    statusGrid([
      [
        "Role gate",
        canModerate ? "moderation allowed" : "read-only",
        canModerate,
      ],
      [
        "Live provider actions",
        canAdmin ? "admin allowed" : "admin blocked",
        canAdmin,
      ],
      ["Feature gates", "confirmation required", true],
    ]),
    list(
      [
        "Warn-only mode stays available when optional Twitch enforcement scopes are missing.",
        "Delete, timeout, live provider setup, and sent-state approvals require admin or owner mode.",
        "Viewer mode disables new approval actions and keeps replay/diagnostics visible.",
        "Relay ownership stays in Relay; Console only records local operator review and explicit actions.",
      ],
      "muted",
    ),
    canModerate
      ? callout("Current role can review moderation and event queues.", "ok")
      : callout(operatorRoleBlockedReason("moderator"), "warn"),
  ]);
}

function renderEventReplayCard() {
  const relayEvents = state.relayEvents || [];
  const discordEvents = state.discordRelayEvents || [];
  const replay = [
    ...relayEvents.map((event) => ({
      kind: "Twitch",
      label: `${event.userDisplayName || event.userLogin || "viewer"}: ${event.text || ""}`,
      detail: event.receivedAt || "",
      payload: event,
    })),
    ...discordEvents.map((event) => ({
      kind: "Discord",
      label: event.commandName ? `/${event.commandName}` : "interaction",
      detail: `${event.username || event.userId || "unknown"} ${event.receivedAt || ""}`,
      payload: event,
    })),
  ];

  return card("Live Event Replay", [
    statusGrid([
      ["Twitch events", relayEvents.length, relayEvents.length > 0],
      ["Discord events", discordEvents.length, discordEvents.length > 0],
      ["Payloads", "redacted local view", true],
    ]),
    h("div", { className: "actions" }, [
      actionButton("Load replay", {
        id: "loadEventReplay",
        variant: "secondary",
        busyKey: "eventReplay",
        onClick: loadEventReplay,
      }),
      actionButton("Copy replay JSON", {
        id: "copyEventReplay",
        variant: "secondary",
        disabled: replay.length === 0,
        onClick: () => copyEventReplay(replay),
      }),
    ]),
    replay.length
      ? h(
          "div",
          { className: "template-list compact-list" },
          replay.slice(0, 20).map((event) =>
            h("div", { className: "template-row" }, [
              h("span", {}, [
                h("strong", { text: event.label }),
                h("small", { text: event.detail }),
                h("small", {
                  text: JSON.stringify(redactReplayPayload(event.payload)),
                }),
              ]),
              h("span", { className: "chip info", text: event.kind }),
            ]),
          ),
        )
      : callout(
          "Load replay to inspect recent Twitch and Discord provider events.",
          "muted",
        ),
  ]);
}

async function loadEventReplay() {
  await runAction(
    "eventReplay",
    async () => {
      const [relayEvents, discordEvents, discordActions] = await Promise.all([
        api.relayEvents(25),
        api.discordRelayEvents(),
        api.discordRelayActions(state.discordRelayActionFilter || "active"),
      ]);
      state.relayEvents = relayEvents.events || [];
      state.discordRelayEvents = discordEvents.events || [];
      state.discordRelayActions = discordActions.actions || [];
      return { ok: true };
    },
    { skipRefresh: true, success: "Event replay loaded." },
  );
}

async function copyEventReplay(replay) {
  await copyText(
    JSON.stringify(
      replay.map((event) => ({
        ...event,
        payload: redactReplayPayload(event.payload),
      })),
      null,
      2,
    ),
    "Replay JSON copied.",
  );
}

function renderCommandTestingSandbox() {
  return card("Command Testing Sandbox", [
    callout(
      "Sandbox runs local simulations and dry-run previews only. It never posts provider writes.",
      "info",
    ),
    h("div", { className: "grid three" }, [
      formRow(
        "Sandbox kind",
        h("select", { id: "sandboxKind" }, [
          option("chat", "chat command"),
          option("slash", "Discord slash command"),
          option("giveaway", "giveaway lifecycle"),
          option("timer", "timer check"),
          option("announcement", "announcement draft"),
        ]),
      ),
      formRow(
        "Actor",
        h("input", { id: "sandboxActor", placeholder: "viewer" }),
      ),
      formRow(
        "Role",
        h("select", { id: "sandboxRole" }, [
          option("viewer", "viewer"),
          option("mod", "mod"),
          option("broadcaster", "broadcaster"),
        ]),
      ),
      formRow(
        "Command or title",
        h("input", { id: "sandboxCommand", placeholder: "!ping or /live" }),
      ),
      formRow(
        "Draft text",
        h("input", {
          id: "sandboxDraftText",
          placeholder: "Announcement, timer, or slash-command detail",
        }),
      ),
    ]),
    h("div", { className: "actions" }, [
      actionButton("Run sandbox", {
        id: "runCommandSandbox",
        variant: "secondary",
        busyKey: "commandSandbox",
        requiredRole: "moderator",
        onClick: runCommandSandbox,
      }),
      actionButton("Run giveaway lifecycle", {
        id: "runSandboxGiveaway",
        variant: "secondary",
        busyKey: "commandSandbox",
        requiredRole: "moderator",
        onClick: () => runCommandSandbox("giveaway"),
      }),
    ]),
    renderTestResult(),
  ]);
}

async function runCommandSandbox(forcedKind) {
  if (!operatorRoleAllows("moderator")) {
    state.message = {
      text: operatorRoleBlockedReason("moderator"),
      tone: "warn",
    };
    render();
    return;
  }

  const kind = forcedKind || field("sandboxKind")?.value || "chat";
  await runAction(
    "commandSandbox",
    async () => {
      if (kind === "chat") {
        const result = await api.simulateCommand({
          actor: field("sandboxActor")?.value || "viewer",
          role: field("sandboxRole")?.value || "viewer",
          command: field("sandboxCommand")?.value || "!ping",
        });
        state.testResult = result;
        return result;
      }

      if (kind === "giveaway") {
        if (!confirm("Run a local test giveaway lifecycle?")) {
          return { ok: true, cancelled: true };
        }
        const result = await api.giveawayAction("run-test", {
          confirmed: true,
        });
        state.testResult = result;
        return result;
      }

      const result = sandboxDryRunResult(kind);
      state.testResult = result;
      return result;
    },
    { success: "Command sandbox completed." },
  );
}

function sandboxDryRunResult(kind) {
  const command = field("sandboxCommand")?.value || `/${kind}`;
  const draft = field("sandboxDraftText")?.value || "No draft text provided.";
  const timerCount = state.timers?.length || 0;
  const detail =
    kind === "timer"
      ? `${timerCount} timer definition(s) available for local review.`
      : kind === "announcement"
        ? `Announcement draft preview: ${draft}`
        : `Slash-command dry run: ${command} ${draft}`;
  return {
    ok: true,
    routerResult: "dry-run",
    echoQueued: false,
    replies: [detail],
    checks: [
      {
        ok: true,
        name: "Provider writes",
        detail: "No provider write was attempted.",
      },
    ],
  };
}

function redactReplayPayload(value) {
  if (Array.isArray(value)) return value.map(redactReplayPayload);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /token|secret|authorization|signature/i.test(key)
          ? "[redacted]"
          : redactReplayPayload(item),
      ]),
    );
  }
  if (typeof value === "string" && value.length > 180) {
    return `${value.slice(0, 180)}...`;
  }
  return value;
}
