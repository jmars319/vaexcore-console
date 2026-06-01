function renderBotRuntimeCard(runtime) {
  const process = runtime?.botProcess || {};
  const running = Boolean(process.running);
  const canStart = canStartBot(runtime);
  const recentLogs = process.recentLogs || [];
  const failureLogs = outboundFailureLogs(recentLogs);

  return card("Bot Runtime", [
    statusGrid([
      ["Process", process.status || "stopped", running],
      ["PID", process.pid || "none", running],
      [
        "EventSub",
        runtime?.eventSubConnected ? "connected" : "not connected",
        runtime?.eventSubConnected,
      ],
      [
        "Chat Subscription",
        runtime?.chatSubscriptionActive ? "active" : "inactive",
        runtime?.chatSubscriptionActive,
      ],
      [
        "Live Chat",
        runtime?.liveChatConfirmed ? "confirmed" : "pending",
        runtime?.liveChatConfirmed,
      ],
    ]),
    h("div", { className: "actions" }, [
      actionButton("Start Bot", {
        id: "botStart",
        variant: "secondary",
        onClick: startBot,
      }),
      actionButton("Stop Bot", {
        id: "botStop",
        variant: "secondary",
        onClick: stopBot,
      }),
    ]),
    canStart || running
      ? null
      : callout(
          "Complete setup and let automatic validation finish before starting the bot.",
          "warn",
        ),
    process.lastError ? callout(process.lastError, "bad") : null,
    failureLogs.length
      ? h("div", {}, [
          h("h3", { text: "Outbound Failure Logs" }),
          h("pre", {
            className: "runtime-log failure-log",
            text: failureLogs.slice(-5).join("\n"),
          }),
        ])
      : null,
    recentLogs.length
      ? h("pre", {
          className: "runtime-log",
          text: recentLogs.slice(-8).join("\n"),
        })
      : h("p", { className: "muted", text: "No bot runtime logs yet." }),
  ]);
}

function renderQueueHealthCard() {
  const health = state.status?.runtime?.queueHealth || {};
  const tone = queueTone(health.status);

  return card("Queue Health", [
    statusGrid([
      ["Status", health.status || "unknown", tone === "ok"],
      ["Pending", health.pending || 0, Number(health.pending || 0) === 0],
      ["Oldest Age", health.oldestAge || "0s", !health.stale],
      ["Processing", health.processing ? "yes" : "no", true],
      ["Oldest Action", health.oldestAction || "none", true],
      [
        "Oldest Importance",
        health.oldestImportance || "normal",
        health.oldestImportance !== "critical",
      ],
      [
        "Retry Delay",
        health.retryDelay || "0s",
        Number(health.retryDelayMs || 0) === 0,
      ],
      ["Send Throttle", health.rateLimitDelay || "0s", !health.rateLimited],
      [
        "Rate Limited",
        health.rateLimitedPending || 0,
        Number(health.rateLimitedPending || 0) === 0,
      ],
      ["Max Attempts", health.maxAttempts || 4, true],
      ["Stale", health.stale ? "yes" : "no", !health.stale],
    ]),
    callout(health.nextAction || "Queue health unavailable.", tone),
    health.blockers?.length
      ? list(health.blockers, tone === "bad" ? "bad" : "warn")
      : null,
  ]);
}

function renderRecoveryChecklistCard() {
  const recovery = state.status?.runtime?.outboundRecovery || {};
  const tone = recovery.needed
    ? recovery.severity === "critical"
      ? "bad"
      : "warn"
    : "ok";

  return card("Recovery Checklist", [
    statusGrid([
      ["Needed", recovery.needed ? "yes" : "no", !recovery.needed],
      [
        "Safe To Resend",
        recovery.safeToResend ? "yes" : "no",
        recovery.needed ? recovery.safeToResend : true,
      ],
      ["Action", recovery.action || "none", !recovery.needed],
      [
        "Category",
        recovery.failureCategory || "none",
        !recovery.needed ||
          !["auth", "config"].includes(recovery.failureCategory),
      ],
      [
        "Attempts",
        recovery.attempts || 0,
        !recovery.needed || Number(recovery.attempts || 0) < 4,
      ],
    ]),
    callout(recovery.nextAction || "No outbound recovery needed.", tone),
    recovery.reason ? callout(`Last failure: ${recovery.reason}`, tone) : null,
    recovery.steps?.length
      ? list(recovery.steps, recovery.needed ? "warn" : "muted")
      : null,
  ]);
}

function renderFailureLogCard() {
  const logs = outboundFailureLogs(
    state.status?.runtime?.botProcess?.recentLogs || [],
  );

  return card("Outbound Failure Logs", [
    logs.length
      ? h("pre", {
          className: "runtime-log failure-log",
          text: logs.slice(-8).join("\n"),
        })
      : callout("No outbound chat failures in recent bot logs.", "ok"),
  ]);
}

function renderPreflightCard() {
  const result = state.preflightResult;
  const launch = currentLaunchPreparation();

  return card("Preflight Rehearsal", [
    h("p", {
      text: "This runs automatically on launch. Rerun it before going live if setup or stream state changed.",
    }),
    h("div", { className: "actions" }, [
      actionButton("Run preflight", {
        id: "runPreflight",
        variant: "secondary",
        onClick: runPreflight,
      }),
    ]),
    result
      ? statusGrid([
          ["Summary", result.ok ? "ready" : "not ready", result.ok],
          ["Next action", result.nextAction || "none", result.ok],
        ])
      : null,
    result?.checks?.length
      ? dataTable(
          ["Check", "Result", "Detail"],
          result.checks.map((check) => [
            check.name,
            h("span", {
              className: `chip ${check.ok ? "ok" : "bad"}`,
              text: check.ok ? "pass" : "fail",
            }),
            check.detail,
          ]),
        )
      : callout(
          launch?.status === "running"
            ? "Automatic preflight is running."
            : "Automatic preflight has not completed in this session.",
          launch?.status === "running" ? "warn" : "muted",
        ),
  ]);
}

function renderOutboundHistoryCard() {
  const messages = state.outboundMessages || [];
  const summary = state.outboundSummary || {};
  const failed = messages.filter((item) => item.status === "failed");
  const recent = messages.slice(0, 12);

  return card("Outbound Chat History", [
    statusGrid([
      ["Tracked", summary.total || 0],
      ["Sent", summary.sent || 0, Number(summary.failed || 0) === 0],
      ["Queued/Retrying", summary.queued || 0, true],
      ["Failed", summary.failed || 0, Number(summary.failed || 0) === 0],
      [
        "Critical Failed",
        summary.criticalFailed || 0,
        Number(summary.criticalFailed || 0) === 0,
      ],
    ]),
    h("div", { className: "actions" }, [
      actionButton("Resend last failed", {
        id: "resendLastFailed",
        variant: "secondary",
        disabled: failed.length === 0,
        onClick: () => resendOutboundMessage(),
      }),
      actionButton("Refresh history", {
        id: "refreshOutbound",
        variant: "secondary",
        onClick: refreshOutboundMessages,
      }),
    ]),
    failed.length
      ? callout(
          "One or more outbound messages failed. Use resend after checking that the text is still appropriate.",
          "warn",
        )
      : null,
    dataTable(
      [
        "Updated",
        "Source",
        "Status",
        "Category",
        "Attempts",
        "Message",
        "Action",
      ],
      recent.map((item) => [
        item.updatedAt || "",
        item.source || "",
        statusChip(item.status),
        failureCategoryChip(item.failureCategory),
        item.attempts || 0,
        formatMessagePreview(item.message),
        item.status === "failed"
          ? actionButton("Resend", {
              id: `resend-${item.id}`,
              variant: "secondary",
              busyKey: "resendOutbound",
              onClick: () => resendOutboundMessage(item.id),
            })
          : "",
      ]),
    ),
  ]);
}

function renderGiveawayOutboundCard() {
  const messages = giveawayOutboundMessages();
  const assurance = state.giveaway?.assurance || {};
  const critical = messages.filter((item) => item.importance === "critical");
  const failed = critical.filter((item) => item.status === "failed");
  const pending = critical.filter((item) =>
    ["queued", "sending", "retrying"].includes(item.status),
  );
  const sent = critical.filter((item) =>
    ["sent", "resent"].includes(item.status),
  );
  const phaseRows = assurance.phases || [];

  return card("Giveaway Chat Assurance", [
    statusGrid([
      [
        "Critical Confirmed",
        assurance.summary?.confirmedCritical || sent.length,
        Number(assurance.summary?.blockingCritical || 0) === 0,
      ],
      [
        "Critical Pending",
        assurance.summary?.pendingCritical || pending.length,
        Number(assurance.summary?.pendingCritical || pending.length) === 0,
      ],
      ["Critical Failed", failed.length, failed.length === 0],
      [
        "Missing Critical",
        assurance.summary?.missingCritical || 0,
        Number(assurance.summary?.missingCritical || 0) === 0,
      ],
      ["Tracked Messages", messages.length, true],
      ["Recap Sent", assurance.summary?.sent || 0, true],
      ["Recap Resent", assurance.summary?.resent || 0, true],
      [
        "Recap Pending",
        assurance.summary?.pending || 0,
        Number(assurance.summary?.failed || 0) === 0,
      ],
    ]),
    assurance.blockContinue
      ? callout(
          `Do not continue giveaway operations yet. ${assurance.nextAction || "Resolve critical chat assurance first."}`,
          "bad",
        )
      : failed.length
        ? callout(
            "A critical giveaway chat message failed. Resend it before continuing live operations.",
            "bad",
          )
        : callout(
            messages.length
              ? "Required critical giveaway messages have send confirmation or are not required yet."
              : "No giveaway chat messages tracked yet.",
            messages.length ? "ok" : "muted",
          ),
    phaseRows.length
      ? dataTable(
          [
            "Phase",
            "Required",
            "Delivery",
            "Category",
            "Queue ID",
            "Attempts",
            "Next Attempt",
            "Reason",
            "Recovery",
            "Action",
          ],
          phaseRows.map((phase) => [
            phase.label,
            phase.required ? "yes" : "tracked",
            statusChip(phase.queueStatus || phase.status),
            failureCategoryChip(phase.failureCategory),
            shortId(phase.outboundMessageId),
            phase.attempts || 0,
            phase.nextAttemptAt || "",
            phase.reason || "",
            phase.deliveryDetail || phase.recovery || "",
            phase.canSend
              ? actionButton(phase.status === "missing" ? "Send" : "Resend", {
                  id: `phase-resend-${phase.id}`,
                  variant: "secondary",
                  busyKey: "resendGiveawayAnnouncement",
                  onClick: () =>
                    resendGiveawayAnnouncement(phase.action || phase.id),
                })
              : "",
          ]),
        )
      : null,
    dataTable(
      [
        "Action",
        "Importance",
        "Status",
        "Category",
        "Attempts",
        "Message",
        "Updated",
        "Resend",
      ],
      messages.slice(0, 10).map((item) => [
        item.action || "message",
        importanceChip(item.importance),
        statusChip(item.status),
        failureCategoryChip(item.failureCategory),
        item.attempts || 0,
        formatMessagePreview(item.message),
        item.updatedAt || "",
        item.status === "failed"
          ? actionButton("Resend", {
              id: `giveaway-resend-${item.id}`,
              variant: "secondary",
              busyKey: "resendOutbound",
              onClick: () => resendOutboundMessage(item.id),
            })
          : "",
      ]),
    ),
  ]);
}

function renderGiveawayReminderCard() {
  const reminder = state.reminder || {};

  return card("Reminder Controls", [
    h("p", {
      text: "Timed reminders only queue while entries are open and chat is configured.",
    }),
    h("div", { className: "grid" }, [
      h("label", { className: "inline-check" }, [
        h("input", {
          id: "reminderEnabled",
          type: "checkbox",
          onChange: updateReminderDraft,
        }),
        "Enable timed reminders",
      ]),
      formRow(
        "Interval minutes",
        h("input", {
          id: "reminderInterval",
          type: "number",
          min: "2",
          max: "60",
          onInput: updateReminderDraft,
        }),
      ),
    ]),
    statusGrid([
      [
        "State",
        reminder.enabled ? "enabled" : "off",
        Boolean(reminder.enabled),
      ],
      [
        "Open Giveaway",
        reminder.openGiveaway ? reminder.giveawayTitle || "yes" : "no",
        Boolean(reminder.openGiveaway),
      ],
      ["Last Sent", reminder.lastSentAt || "never", true],
      [
        "Next Send",
        reminder.nextSendAt || "none",
        !reminder.enabled || Boolean(reminder.nextSendAt),
      ],
    ]),
    reminder.lastError ? callout(reminder.lastError, "warn") : null,
    h("div", { className: "actions" }, [
      actionButton("Save reminder", {
        id: "saveReminder",
        variant: "secondary",
        onClick: saveReminder,
      }),
      actionButton("Send reminder now", {
        id: "sendReminderNow",
        variant: "secondary",
        onClick: sendReminderNow,
      }),
    ]),
  ]);
}

function renderGiveawayTemplatesCard() {
  const templates = state.templates || [];

  return card("Message Templates", [
    h("p", {
      text: "Customize local giveaway chat messages without storing prize codes. Leave placeholders in braces when you want live giveaway values inserted.",
    }),
    h(
      "div",
      { className: "template-list" },
      templates.map((template) =>
        h("label", { className: "template-row" }, [
          h("span", {}, [
            h("strong", { text: template.label }),
            h("small", { text: template.description }),
          ]),
          h("textarea", {
            id: `template-${template.action}`,
            "data-action": template.action,
            onInput: updateTemplateDraft,
          }),
        ]),
      ),
    ),
    callout(
      "Available placeholders: {title}, {keyword}, {winnerCount}, {entryCount}, {displayName}, {winners}, {winnerPlural}, {drawnCount}, {requestedCount}, {partial}, {rerolled}, {replacement}.",
    ),
    h("div", { className: "actions" }, [
      actionButton("Save templates", {
        id: "saveTemplates",
        variant: "secondary",
        onClick: saveTemplates,
      }),
      actionButton("Reset templates", {
        id: "resetTemplates",
        variant: "secondary",
        onClick: resetTemplates,
      }),
    ]),
  ]);
}
