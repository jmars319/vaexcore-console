function renderCommandPresetPackCard() {
  const packs = state.commandPresetPacks || [];

  return card("Utility Packs", [
    callout(
      "Packs create commands as disabled drafts. Review links and copy, then enable only after local tests.",
      "muted",
    ),
    packs.length
      ? dataTable(
          ["Pack", "Commands", "Ready", "Status", "Actions"],
          packs.map((pack) => [
            pack.label,
            pack.description || "",
            `${pack.readyCount || 0}/${pack.commandCount || 0}`,
            pack.inspection?.detail || "",
            actionButton("Create ready disabled", {
              id: `command-pack-${pack.id}`,
              variant: "secondary",
              busyKey: "commandPresetPack",
              disabled: !pack.readyCount,
              onClick: () => applyCommandPresetPack(pack.id),
            }),
          ]),
        )
      : callout("No utility packs are available.", "muted"),
  ]);
}
function renderTimers() {
  const timers = state.timers || [];
  const selected = selectedTimer();
  const readiness = state.timerReadiness || {};
  return [
    sectionHeader(
      "Timers",
      "Schedule local stream messages with live readiness, non-command chat activity, and queue guardrails.",
      h("div", { className: "actions section-actions" }, [
        actionButton("New timer", {
          id: "newTimer",
          variant: "secondary",
          onClick: newTimer,
        }),
        actionButton("Refresh", {
          id: "refreshTimers",
          variant: "secondary",
          busyKey: "refresh",
          onClick: refreshAll,
        }),
      ]),
    ),
    renderFeatureGateCard("timers"),
    renderTimerReadinessCard(),
    renderTimerPresetCard(),
    renderTimerSuggestionCard(),
    card("Timer Library", [
      statusGrid([
        ["Total", state.timerSummary.total || 0, true],
        ["Enabled", state.timerSummary.enabled || 0, true],
        [
          "Disabled",
          state.timerSummary.disabled || 0,
          Number(state.timerSummary.disabled || 0) === 0,
        ],
        ["Sent", state.timerSummary.sent || 0, true],
        [
          "Blocked",
          state.timerSummary.blocked || 0,
          Number(state.timerSummary.blocked || 0) === 0,
        ],
        ["Waiting activity", state.timerSummary.waitingForActivity || 0, true],
        ["Next fire", state.timerSummary.nextFireAt || "none", true],
        [
          "Readiness",
          readiness.ok ? "ready" : "blocked",
          Boolean(readiness.ok),
        ],
      ]),
      readiness.reason
        ? callout(readiness.reason, readiness.ok ? "ok" : "warn")
        : null,
      dataTable(
        [
          "Timer",
          "State",
          "Interval",
          "Activity",
          "Last Sent",
          "Next Fire",
          "Status",
          "Why / Next Action",
          "Actions",
        ],
        timers.map((timer) => [
          timer.name,
          statusChip(timer.enabled ? "enabled" : "disabled"),
          `${timer.intervalMinutes}m`,
          timer.minChatMessages > 0
            ? `${Math.min(timer.chatMessagesSinceLastFire || 0, timer.minChatMessages)}/${timer.minChatMessages}`
            : "off",
          timer.lastSentAt || "never",
          timer.nextFireAt || "none",
          timer.lastStatus === "blocked" && timer.lastError
            ? `${timer.lastStatus}: ${timer.lastError}`
            : timer.lastStatus || "never",
          timer.inspection
            ? `${timer.inspection.detail} ${timer.inspection.nextAction || ""}`.trim()
            : "",
          h("div", { className: "actions inline-actions table-actions" }, [
            actionButton("Edit", {
              id: `timer-edit-${timer.id}`,
              variant: "secondary",
              onClick: () => editTimer(timer.id),
            }),
            actionButton(timer.enabled ? "Disable" : "Enable", {
              id: `timer-enable-${timer.id}`,
              variant: "secondary",
              busyKey: "timerEnable",
              onClick: () => toggleTimer(timer.id, !timer.enabled),
            }),
            actionButton("Send now", {
              id: `timer-send-${timer.id}`,
              variant: "secondary",
              busyKey: "timerSend",
              disabled: !timer.enabled || !readiness.ok,
              onClick: () => sendTimerNow(timer.id),
            }),
            actionButton("Delete", {
              id: `timer-delete-${timer.id}`,
              variant: "danger",
              busyKey: "timerDelete",
              onClick: () => deleteTimer(timer.id, timer.name),
            }),
          ]),
        ]),
      ),
    ]),
    card("Timer Editor", [
      selected
        ? callout(`Editing ${selected.name}`, selected.enabled ? "ok" : "warn")
        : callout("Create a timer or select one from the library.", "muted"),
      h("div", { className: "grid three" }, [
        formRow(
          "Timer name",
          h("input", {
            id: "timerName",
            placeholder: "Discord reminder",
            onInput: updateTimerDraft,
          }),
        ),
        formRow(
          "Interval minutes",
          h("input", {
            id: "timerInterval",
            type: "number",
            min: "5",
            max: "1440",
            onInput: updateTimerDraft,
          }),
        ),
        formRow(
          "Chat messages required",
          h("input", {
            id: "timerMinChatMessages",
            type: "number",
            min: "0",
            max: "500",
            onInput: updateTimerDraft,
          }),
        ),
        h("label", { className: "inline-check editor-check" }, [
          h("input", {
            id: "timerEnabled",
            type: "checkbox",
            onChange: updateTimerDraft,
          }),
          "Enabled",
        ]),
      ]),
      formRow(
        "Message",
        h("textarea", {
          id: "timerMessage",
          className: "command-response-editor",
          placeholder: "Follow the channel for schedule updates.",
          onInput: updateTimerDraft,
        }),
      ),
      callout(
        "Timers use the outbound queue and only fire when Timers are Live, the bot is live-ready, the queue is clear, and the timer's non-command chat activity requirement is met. Minimum interval is 5 minutes.",
        "info",
      ),
      h("div", { className: "actions" }, [
        actionButton("Save timer", { id: "saveTimer", onClick: saveTimer }),
        selected
          ? actionButton("Send now", {
              id: "sendSelectedTimer",
              variant: "secondary",
              busyKey: "timerSend",
              disabled: !selected.enabled || !readiness.ok,
              onClick: () => sendTimerNow(selected.id),
            })
          : null,
      ]),
    ]),
    card("Import And Export", [
      h("div", { className: "actions" }, [
        actionButton("Export timers JSON", {
          id: "exportTimers",
          variant: "secondary",
          onClick: exportTimers,
        }),
        actionButton("Import timers JSON", {
          id: "importTimers",
          variant: "secondary",
          onClick: importTimers,
        }),
      ]),
      formRow(
        "Import JSON",
        h("textarea", {
          id: "timerImportJson",
          className: "command-import",
          placeholder: '{"timers":[...]}',
        }),
      ),
    ]),
    message(),
  ];
}

function renderTimerReadinessCard() {
  const readiness = state.timerReadiness || {};
  const checks = readiness.checks || [];

  return card("Live Timer Readiness", [
    statusGrid([
      [
        "Feature gate",
        readiness.gateMode || featureGate("timers").mode || "off",
        readiness.gateMode === "live",
      ],
      ["Summary", readiness.ok ? "ready" : "blocked", Boolean(readiness.ok)],
      [
        "Next action",
        readiness.nextAction || readiness.reason || "Review timer setup.",
        Boolean(readiness.ok),
      ],
    ]),
    checks.length
      ? dataTable(
          ["Check", "Status", "Detail"],
          checks.map((check) => [
            check.name,
            statusChip(check.ok ? "ok" : "blocked"),
            check.detail || "",
          ]),
        )
      : null,
  ]);
}

function renderTimerPresetCard() {
  const presets = state.timerPresets || [];

  return card("Preset Starters", [
    presets.length
      ? dataTable(
          ["Preset", "Interval", "Message", "Actions"],
          presets.map((preset) => [
            preset.name,
            `${preset.intervalMinutes}m`,
            formatMessagePreview(preset.message),
            actionButton("Create disabled", {
              id: `timer-preset-${preset.id}`,
              variant: "secondary",
              busyKey: "timerPreset",
              onClick: () => applyTimerPreset(preset.id),
            }),
          ]),
        )
      : callout("No timer presets are available.", "muted"),
  ]);
}

function renderTimerSuggestionCard() {
  return card("Timer Suggestions", [
    callout(
      "Optional starters only. Copy a message or load one into the editor, then review it before saving.",
      "muted",
    ),
    dataTable(
      ["Use case", "Interval", "Activity", "Message", "Actions"],
      timerSuggestions.map((suggestion) => [
        suggestion.useCase,
        `${suggestion.intervalMinutes}m`,
        suggestion.minChatMessages
          ? `${suggestion.minChatMessages} chat messages`
          : "off",
        formatMessagePreview(suggestion.message),
        h("div", { className: "actions inline-actions table-actions" }, [
          actionButton("Load", {
            id: `timer-suggestion-load-${suggestion.id}`,
            variant: "secondary",
            onClick: () => applyTimerSuggestion(suggestion.id),
          }),
          actionButton("Copy", {
            id: `timer-suggestion-copy-${suggestion.id}`,
            variant: "secondary",
            busyKey: "copySuggestion",
            onClick: () => copyTimerSuggestion(suggestion.id),
          }),
        ]),
      ]),
    ),
  ]);
}

function renderModerationSuggestionCard() {
  return card("Moderation Suggestions", [
    callout(
      "Optional examples only. Copy a value or load it into the matching editor, then test before saving live rules.",
      "muted",
    ),
    dataTable(
      ["Use case", "Target", "Value", "Actions"],
      moderationSuggestions.map((suggestion) => [
        suggestion.useCase,
        suggestion.target,
        formatMessagePreview(suggestion.value),
        h("div", { className: "actions inline-actions table-actions" }, [
          actionButton("Load", {
            id: `moderation-suggestion-load-${suggestion.id}`,
            variant: "secondary",
            onClick: () => applyModerationSuggestion(suggestion.id),
          }),
          actionButton("Copy", {
            id: `moderation-suggestion-copy-${suggestion.id}`,
            variant: "secondary",
            busyKey: "copySuggestion",
            onClick: () => copyModerationSuggestion(suggestion.id),
          }),
        ]),
      ]),
    ),
  ]);
}
