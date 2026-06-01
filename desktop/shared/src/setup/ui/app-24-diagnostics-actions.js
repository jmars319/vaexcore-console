async function saveOperatorMessages() {
  await runAction(
    "saveOperatorMessages",
    async () => {
      const result = await api.saveOperatorMessages(
        readOperatorTemplatePayload(),
      );
      state.operatorMessages = result.templates || [];
      state.operatorTemplateDraft = {};
      return result;
    },
    { skipRefresh: true, success: "Operator messages saved." },
  );
}

async function resetOperatorMessages() {
  if (!confirm("Reset operator message presets to defaults?")) {
    return;
  }

  await runAction(
    "resetOperatorMessages",
    async () => {
      const result = await api.resetOperatorMessages();
      state.operatorMessages = result.templates || [];
      state.operatorTemplateDraft = {};
      return result;
    },
    { skipRefresh: true, success: "Operator messages reset." },
  );
}

async function sendOperatorMessage(id, label, requiresConfirmation) {
  if (requiresConfirmation && !confirm(`Send "${label}" to Twitch chat now?`)) {
    return;
  }

  await runAction(
    "sendOperatorMessage",
    () => api.sendOperatorMessage(id, requiresConfirmation),
    {
      success: "Operator message queued.",
    },
  );
}

async function saveReminder() {
  await runAction(
    "saveReminder",
    async () => {
      const result = await api.saveReminder({
        enabled: Boolean(field("reminderEnabled")?.checked),
        intervalMinutes: Number(field("reminderInterval")?.value || 10),
      });
      state.reminder = result.reminder || {};
      state.reminderDraft = {};
      return result;
    },
    { skipRefresh: true, success: "Reminder settings saved." },
  );
}

async function sendReminderNow() {
  await runAction(
    "sendReminderNow",
    async () => {
      const result = await api.sendReminder();
      state.reminder = result.reminder || {};
      return result;
    },
    { success: "Reminder queued." },
  );
}

async function copyWinnerList() {
  const winners = activeWinnerList();
  const text = winners
    .map((winner) => `${winner.display_name} (@${winner.login})`)
    .join("\n");

  if (!text) {
    state.message = { text: "No winners to copy.", tone: "warn" };
    render();
    return;
  }

  await copyText(text, "Winner list copied.");
}

async function copyRecap() {
  await copyText(postStreamRecapText(), "Post-stream recap copied.");
}

async function copyPostStreamReview() {
  await copyText(postStreamReviewText(), "Post-stream review copied.");
}

function exportPostStreamReviewJson() {
  downloadTextFile(
    `vaexcore-post-stream-review-${new Date().toISOString().slice(0, 10)}.json`,
    `${JSON.stringify(postStreamReviewData(), null, 2)}\n`,
    "application/json",
  );
  state.message = { text: "Post-stream review JSON exported.", tone: "ok" };
  render();
}

async function copyIncidentNote() {
  await copyText(incidentNoteText(), "Incident note copied.");
}

async function runDiagnostics() {
  await runAction(
    "diagnostics",
    async () => {
      const report = await api.diagnostics();
      state.diagnostics = report;
      syncLaunchPreparation(report);
      return report;
    },
    { skipRefresh: true, success: "Diagnostics updated." },
  );
}

async function copyDiagnostics() {
  const report = state.diagnostics || (await api.diagnostics());
  state.diagnostics = report;
  syncLaunchPreparation(report);
  await copyText(JSON.stringify(report, null, 2), "Diagnostic report copied.");
}

async function copySupportBundle() {
  await runAction(
    "copySupportBundle",
    async () => {
      const bundle = await api.supportBundle();
      state.diagnostics = bundle.diagnostics || state.diagnostics;
      syncLaunchPreparation(bundle.diagnostics || {});
      await copyText(JSON.stringify(bundle, null, 2), "Support bundle copied.");
      return bundle;
    },
    { skipRefresh: true, quiet: true },
  );
}

function incidentNoteText() {
  const runtime = state.status?.runtime || {};
  const process = runtime.botProcess || {};
  const summary = state.giveaway?.summary || state.status?.giveaway || {};
  const recovery = runtime.outboundRecovery || {};
  const health = runtime.queueHealth || {};
  const runbook = liveRunbookSteps();

  return [
    `vaexcore console incident note - ${new Date().toISOString()}`,
    `Mode: ${runtime.mode || "unknown"}`,
    `Bot: ${process.status || "unknown"}${process.pid ? ` pid=${process.pid}` : ""}`,
    `EventSub: ${runtime.eventSubConnected ? "connected" : "not connected"}`,
    `Chat subscription: ${runtime.chatSubscriptionActive ? "active" : "inactive"}`,
    `Live chat: ${runtime.liveChatConfirmed ? "confirmed" : "pending"}`,
    `Queue: ${health.status || "unknown"} - ${health.nextAction || "none"}`,
    `Recovery: ${recovery.needed ? `${recovery.severity || "needed"} ${recovery.action || ""} ${recovery.failureCategory || ""}`.trim() : "clear"}`,
    recovery.reason ? `Recovery reason: ${recovery.reason}` : "",
    `Giveaway: ${summary.status || "none"} ${summary.title || ""}`.trim(),
    `Entries: ${summary.entryCount || 0}`,
    `Winners: ${summary.winnersDrawn || 0}/${summary.winnerCount || 0}`,
    `Undelivered: ${summary.undeliveredWinnersCount || 0}`,
    `Next runbook action: ${runbook[0]?.label || "Monitor"} - ${runbook[0]?.detail || "No action."}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function copyText(text, success) {
  try {
    await navigator.clipboard.writeText(text);
    state.message = { text: success, tone: "ok" };
  } catch {
    state.message = { text, tone: "muted" };
  }

  render();
}

function downloadTextFile(filename, text, type = "text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function sendGiveawayStatus() {
  await runAction(
    "sendGiveawayStatus",
    async () => {
      const result = await api.sendGiveawayStatus();
      if (result.state) {
        state.giveaway = result.state;
      }
      return result;
    },
    { success: "Giveaway status queued." },
  );
}

async function resendCriticalGiveaway() {
  await runAction(
    "resendCriticalGiveaway",
    async () => {
      const result = await api.resendCriticalGiveaway();
      if (result.state) {
        state.giveaway = result.state;
      }
      state.outboundMessages = result.messages || state.outboundMessages;
      state.outboundSummary = result.summary || state.outboundSummary;
      return result;
    },
    { success: "Critical giveaway message requeued." },
  );
}

async function resendOutboundMessage(id) {
  await runAction(
    "resendOutbound",
    async () => {
      const result = await api.resendOutboundMessage(id);
      state.outboundMessages = result.messages || [];
      state.outboundSummary = result.summary || {};
      return result;
    },
    { skipRefresh: true, success: "Outbound message requeued." },
  );
  await refreshAll();
}

async function resendGiveawayAnnouncement(action) {
  await runAction(
    "resendGiveawayAnnouncement",
    async () => {
      const result = await api.resendGiveawayAnnouncement(action);
      if (result.state) {
        state.giveaway = result.state;
      }
      return result;
    },
    { success: "Giveaway announcement queued." },
  );
}

function renderTestResult() {
  if (!state.testResult) {
    return h("div", {
      className: "message",
      text: "No simulated command has run yet.",
    });
  }

  const result = state.testResult;
  const replies = result.replies?.length
    ? result.replies
    : [fallbackCommandMessage(result)];
  const validationErrors =
    result.checks
      ?.filter((check) => !check.ok)
      .map((check) => `${check.name}: ${check.detail}`) || [];

  return h("div", {}, [
    statusGrid([
      ["Result", result.ok ? "ok" : "failed", result.ok],
      [
        "Router",
        result.routerResult || "n/a",
        result.routerResult !== "denied",
      ],
      [
        "Echo queued",
        result.echoQueued ? "yes" : "no",
        Boolean(result.echoQueued),
      ],
      [
        "Validation errors",
        validationErrors.length,
        validationErrors.length === 0,
      ],
    ]),
    h("h3", { text: "Replies" }),
    list(replies, result.ok ? "muted" : "bad"),
    validationErrors.length ? list(validationErrors, "bad") : null,
  ]);
}

function renderModerationTestResult() {
  const test = state.moderationTestResult || {};
  const result = test.result;
  const plan = test.enforcementPlan;

  if (!result) {
    return null;
  }

  return h("div", { className: "test-result" }, [
    statusGrid([
      [
        "Result",
        result.hit ? "hit" : result.skipped ? "skipped" : "clear",
        !result.hit,
      ],
      ["Action", result.hit?.action || "none", !result.hit],
      [
        "Filter actions",
        (result.hit?.filterActions || [])
          .map((item) => `${item.filterType}:${item.action}`)
          .join(", ") || "none",
        !result.hit,
      ],
      [
        "Matched rules",
        (result.hit?.matches || []).map((item) => item.detail).join("; ") ||
          "none",
        !result.hit,
      ],
      [
        "Bot Shield",
        result.botShield
          ? `${result.botShield.score}/${result.botShield.threshold}`
          : "off",
        !result.hit,
      ],
      [
        "Bot reasons",
        (result.botShield?.reasons || []).join(", ") || "none",
        !result.hit,
      ],
      [
        "First-time chatter",
        result.botShield
          ? result.botShield.firstTimeChatter
            ? "yes"
            : "no"
          : "unknown",
        !result.botShield?.firstTimeChatter,
      ],
      [
        "Silent first action",
        result.hit?.silent ? "yes" : "no",
        !result.hit?.silent,
      ],
      [
        "Escalation",
        result.hit?.escalation?.reason || "none",
        !result.hit || !result.hit.escalation,
      ],
      [
        "Timeout",
        result.hit?.timeoutSeconds ? `${result.hit.timeoutSeconds}s` : "none",
        !result.hit,
      ],
      [
        "Enforcement",
        plan ? `${plan.status}: ${plan.reason}` : "none",
        !result.hit || plan?.status === "skipped",
      ],
      [
        "Allowed links",
        (result.allowedLinks || []).join(", ") || "none",
        !result.hit,
      ],
      [
        "Permit",
        result.consumedPermit
          ? `available for ${result.consumedPermit.userLogin}`
          : "none",
        !result.hit,
      ],
      ["Reason", result.hit?.detail || result.reason || "none", !result.hit],
    ]),
    result.hit ? callout(result.hit.warningMessage, "warn") : null,
  ]);
}

function fallbackCommandMessage(result) {
  if (result.routerResult === "denied")
    return "Command denied by permission checks.";
  if (result.routerResult === "unknown") return "Unknown command ignored.";
  return result.ok
    ? "Command ran with no chat reply."
    : result.error || "Command failed.";
}
