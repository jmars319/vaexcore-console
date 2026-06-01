function renderGiveawayRecapCard() {
  const recap = state.giveaway?.recap || {};

  if (!recap.available) {
    return card("Post-Giveaway Recap", [
      callout("No giveaway has run yet.", "muted"),
    ]);
  }

  return card("Post-Giveaway Recap", [
    statusGrid([
      ["Giveaway", `#${recap.id} ${recap.title}`, true],
      ["Status", recap.status, recap.status === "ended"],
      ["Entries", recap.entryCount || 0, true],
      ["Winners", recap.activeWinnerCount || 0, true],
      [
        "Pending Delivery",
        recap.pendingDeliveryCount || 0,
        Number(recap.pendingDeliveryCount || 0) === 0,
      ],
      ["Delivered", recap.deliveredWinnerCount || 0, true],
      ["Critical Messages", recap.criticalMessageCount || 0, true],
      [
        "Failed Messages",
        recap.failedMessageCount || 0,
        Number(recap.failedMessageCount || 0) === 0,
      ],
      ["Sent Messages", recap.sentMessageCount || 0, true],
      ["Resent Messages", recap.resentMessageCount || 0, true],
      [
        "Pending Messages",
        recap.pendingMessageCount || 0,
        Number(recap.pendingMessageCount || 0) === 0,
      ],
      [
        "Critical Confirmed",
        recap.confirmedCriticalCount || 0,
        Number(recap.blockingCriticalCount || 0) === 0,
      ],
      [
        "Critical Pending",
        recap.pendingCriticalCount || 0,
        Number(recap.pendingCriticalCount || 0) === 0,
      ],
      [
        "Missing Critical",
        recap.missingCriticalCount || 0,
        Number(recap.missingCriticalCount || 0) === 0,
      ],
      [
        "Blocking Critical",
        recap.blockingCriticalCount || 0,
        Number(recap.blockingCriticalCount || 0) === 0,
      ],
    ]),
    dataTable(
      ["Winner", "Delivered"],
      (recap.winners || []).map((winner) => [
        `${winner.displayName} @${winner.login}`,
        winner.delivered ? "yes" : "pending",
      ]),
    ),
  ]);
}

function renderPanicResendCard() {
  const failures = criticalGiveawayFailures();
  const latest = failures[0];

  return card("Panic Resend", [
    statusGrid([
      ["Failed Critical", failures.length, failures.length === 0],
      ["Latest Action", latest?.action || "none", !latest],
      ["Latest Reason", latest?.reason || "none", !latest],
      ["Updated", latest?.updatedAt || "none", !latest],
    ]),
    latest
      ? callout(
          "Review the failed message, then resend only if chat did not receive the critical giveaway announcement.",
          "bad",
        )
      : callout(
          "No failed critical giveaway messages need panic resend.",
          "ok",
        ),
    latest
      ? h("pre", {
          className: "runtime-log failure-log",
          text: `${latest.action || "message"}: ${latest.message}`,
        })
      : null,
    h("div", { className: "actions" }, [
      actionButton("Panic resend latest critical", {
        id: "panicCardResendCritical",
        variant: "danger",
        busyKey: "resendCriticalGiveaway",
        onClick: resendCriticalGiveaway,
      }),
    ]),
  ]);
}

function renderPostStreamRecapCard() {
  const text = postStreamRecapText();

  return card("Post-Stream Recap", [
    h(
      "textarea",
      {
        id: "postStreamRecap",
        className: "recap-text",
        readonly: "readonly",
      },
      text,
    ),
    h("div", { className: "actions" }, [
      actionButton("Copy recap", {
        id: "postStreamCopyRecap",
        variant: "secondary",
        busyKey: "copyRecap",
        onClick: copyRecap,
      }),
    ]),
  ]);
}

function renderFeatureGateCard(key) {
  const gate = featureGate(key);
  const mode = gate.mode || "off";
  const isLive = mode === "live";
  const isTest = mode === "test";

  return card("Feature Gate", [
    statusGrid([
      ["Mode", mode, isLive],
      [
        "Local tests",
        gate.testAllowed ? "allowed" : "blocked",
        gate.testAllowed,
      ],
      [
        "Twitch chat",
        gate.liveAllowed ? "allowed" : "blocked",
        gate.liveAllowed,
      ],
      ["Updated", gate.updatedAt || "default", true],
    ]),
    h("div", { className: "actions segmented-actions" }, [
      actionButton("Off", {
        id: `${key}-gate-off`,
        variant: mode === "off" ? "" : "secondary",
        busyKey: "featureGate",
        disabled: mode === "off",
        onClick: () => setFeatureGate(key, "off"),
      }),
      actionButton("Test", {
        id: `${key}-gate-test`,
        variant: isTest ? "" : "secondary",
        busyKey: "featureGate",
        disabled: isTest,
        onClick: () => setFeatureGate(key, "test"),
      }),
      actionButton("Live", {
        id: `${key}-gate-live`,
        variant: isLive ? "" : "secondary",
        busyKey: "featureGate",
        disabled: isLive,
        onClick: () => setFeatureGate(key, "live"),
      }),
    ]),
    callout(featureGateSummary(gate), isLive ? "ok" : isTest ? "info" : "warn"),
  ]);
}
function renderCommands() {
  const commands = filteredCustomCommands();
  const selected = selectedCustomCommand();
  const history = state.commandHistory || [];
  const reservedNames = (state.commandReservedNames || [])
    .map((name) => `!${name}`)
    .join(", ");

  return [
    sectionHeader(
      "Commands",
      "Manage local custom chat commands, permissions, cooldowns, and usage history.",
      h("div", { className: "actions section-actions" }, [
        actionButton("New command", {
          id: "newCommand",
          variant: "secondary",
          onClick: newCustomCommand,
        }),
        actionButton("Refresh", {
          id: "refreshCommands",
          variant: "secondary",
          busyKey: "refresh",
          onClick: refreshAll,
        }),
      ]),
    ),
    renderFeatureGateCard("custom_commands"),
    renderCommandPresetPackCard(),
    renderCommandPresetCard(),
    card("Command Library", [
      statusGrid([
        ["Total", state.commandSummary.total || 0, true],
        ["Enabled", state.commandSummary.enabled || 0, true],
        [
          "Disabled",
          state.commandSummary.disabled || 0,
          Number(state.commandSummary.disabled || 0) === 0,
        ],
        ["Aliases", state.commandSummary.aliases || 0, true],
        ["Uses", state.commandSummary.uses || 0, true],
      ]),
      h("div", { className: "toolbar" }, [
        formRow(
          "Search commands",
          h("input", {
            id: "commandFilter",
            placeholder: "filter by command or alias",
            onInput: (event) => {
              state.commandFilter = event.target.value;
              render();
            },
          }),
        ),
        h("span", {
          className: "count",
          text: `${commands.length} of ${(state.commands || []).length} visible`,
        }),
      ]),
      dataTable(
        [
          "Command",
          "State",
          "Permission",
          "Cooldowns",
          "Aliases",
          "Uses",
          "Actions",
        ],
        commands.map((command) => [
          `!${command.name}`,
          statusChip(command.enabled ? "enabled" : "disabled"),
          commandPermissionChip(command.permission),
          `${command.globalCooldownSeconds}s global / ${command.userCooldownSeconds}s user`,
          command.aliases.length
            ? command.aliases.map((alias) => `!${alias}`).join(", ")
            : "",
          `${command.useCount || 0}${command.lastUsedAt ? ` last ${command.lastUsedAt}` : ""}`,
          h("div", { className: "actions inline-actions table-actions" }, [
            actionButton("Edit", {
              id: `command-edit-${command.id}`,
              variant: "secondary",
              onClick: () => editCustomCommand(command.id),
            }),
            actionButton(command.enabled ? "Disable" : "Enable", {
              id: `command-enable-${command.id}`,
              variant: "secondary",
              busyKey: "commandEnable",
              onClick: () => toggleCustomCommand(command.id, !command.enabled),
            }),
            actionButton("Duplicate", {
              id: `command-duplicate-${command.id}`,
              variant: "secondary",
              busyKey: "commandDuplicate",
              onClick: () => duplicateCustomCommand(command.id),
            }),
            actionButton("Delete", {
              id: `command-delete-${command.id}`,
              variant: "danger",
              busyKey: "commandDelete",
              onClick: () => deleteCustomCommand(command.id, command.name),
            }),
          ]),
        ]),
      ),
      reservedNames
        ? callout(`Reserved names: ${reservedNames}`, "muted")
        : null,
    ]),
    card("Command Editor", [
      selected
        ? callout(`Editing !${selected.name}`, selected.enabled ? "ok" : "warn")
        : callout(
            "Create a new command or select one from the library.",
            "muted",
          ),
      h("div", { className: "grid three" }, [
        formRow(
          "Command name",
          h("input", {
            id: "commandName",
            placeholder: "discord",
            onInput: updateCommandDraft,
          }),
        ),
        formRow(
          "Permission",
          h(
            "select",
            { id: "commandPermission", onChange: updateCommandDraft },
            [
              option("viewer", "viewer"),
              option("moderator", "moderator"),
              option("broadcaster", "broadcaster"),
            ],
          ),
        ),
        h("label", { className: "inline-check editor-check" }, [
          h("input", {
            id: "commandEnabled",
            type: "checkbox",
            onChange: updateCommandDraft,
          }),
          "Enabled",
        ]),
        formRow(
          "Global cooldown seconds",
          h("input", {
            id: "commandGlobalCooldown",
            type: "number",
            min: "0",
            max: "86400",
            onInput: updateCommandDraft,
          }),
        ),
        formRow(
          "User cooldown seconds",
          h("input", {
            id: "commandUserCooldown",
            type: "number",
            min: "0",
            max: "86400",
            onInput: updateCommandDraft,
          }),
        ),
        formRow(
          "Aliases",
          h("textarea", {
            id: "commandAliases",
            placeholder: "links\nsocials",
            onInput: updateCommandDraft,
          }),
        ),
      ]),
      formRow(
        "Response variants",
        h("textarea", {
          id: "commandResponses",
          className: "command-response-editor",
          placeholder:
            "Join the Discord: https://example.com\n{user}, Discord is at https://example.com",
          onInput: updateCommandDraft,
        }),
      ),
      callout(
        "Placeholders: {user}, {displayName}, {login}, {args}, {arg1} through {arg9}, {target}, {count}. Put each random response variant on its own line.",
        "info",
      ),
      h("div", { className: "grid three" }, [
        formRow(
          "Preview actor",
          h("input", { id: "commandPreviewActor", placeholder: "viewer" }),
        ),
        formRow(
          "Preview role",
          h("select", { id: "commandPreviewRole" }, [
            option("viewer", "viewer"),
            option("mod", "mod"),
            option("broadcaster", "broadcaster"),
          ]),
        ),
        formRow(
          "Preview args",
          h("input", {
            id: "commandPreviewArgs",
            placeholder: "target extra text",
          }),
        ),
      ]),
      h("div", { className: "actions" }, [
        actionButton("Save command", {
          id: "saveCommand",
          onClick: saveCustomCommand,
        }),
        actionButton("Preview response", {
          id: "previewCommand",
          variant: "secondary",
          onClick: previewCustomCommand,
        }),
        actionButton("Run test command", {
          id: "testCustomCommand",
          variant: "secondary",
          onClick: testCustomCommand,
        }),
      ]),
      renderCommandPreview(),
      renderTestResult(),
    ]),
    card("Import And Export", [
      h("div", { className: "actions" }, [
        actionButton("Export commands JSON", {
          id: "exportCommands",
          variant: "secondary",
          onClick: exportCustomCommands,
        }),
        actionButton("Import commands JSON", {
          id: "importCommands",
          variant: "secondary",
          onClick: importCustomCommands,
        }),
      ]),
      formRow(
        "Import JSON",
        h("textarea", {
          id: "commandImportJson",
          className: "command-import",
          placeholder: '{"commands":[...]}',
        }),
      ),
    ]),
    card("Recent Command Uses", [
      dataTable(
        ["Timestamp", "Command", "Alias", "User", "Response"],
        history
          .slice(0, 20)
          .map((entry) => [
            entry.createdAt || "",
            `!${entry.commandName}`,
            entry.aliasUsed && entry.aliasUsed !== entry.commandName
              ? `!${entry.aliasUsed}`
              : "",
            entry.userLogin || "",
            formatMessagePreview(entry.responseText || ""),
          ]),
      ),
    ]),
    message(),
  ];
}

function renderCommandPresetCard() {
  const presets = state.commandPresets || [];

  return card("Starter Commands", [
    presets.length
      ? dataTable(
          [
            "Preset",
            "Category",
            "Command",
            "Permission",
            "Response",
            "Status",
            "Actions",
          ],
          presets.map((preset) => [
            preset.label,
            preset.category || "Utility",
            `!${preset.commandName}${preset.aliases?.length ? ` (${preset.aliases.map((alias) => `!${alias}`).join(", ")})` : ""}`,
            commandPermissionChip(preset.permission || "viewer"),
            formatMessagePreview((preset.responses || [])[0] || ""),
            preset.inspection?.status === "ready"
              ? preset.inspection?.nextAction || "ready"
              : preset.inspection?.detail || "blocked",
            actionButton("Create disabled", {
              id: `command-preset-${preset.id}`,
              variant: "secondary",
              busyKey: "commandPreset",
              disabled: preset.inspection?.status !== "ready",
              onClick: () => applyCommandPreset(preset.id),
            }),
          ]),
        )
      : callout("No command presets are available.", "muted"),
  ]);
}
