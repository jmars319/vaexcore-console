async function refreshAfterAction() {
  const [
    status,
    launchPreparation,
    giveaway,
    commands,
    timers,
    moderation,
    templates,
    operatorMessages,
    reminder,
    audit,
    outbound,
    featureGateResult,
    streamPresetResult,
    suiteStatus,
    twitchOps,
    discordStatus,
    discordRelayStatus,
    botCompletion,
  ] = await Promise.all([
    api.status(),
    api.launchPreparation(),
    api.giveaway(),
    api.commands(),
    api.timers(),
    api.moderation(),
    api.templates(),
    api.operatorMessages(),
    api.reminder(),
    api.auditLogs(),
    api.outboundMessages(),
    api.featureGates(),
    api.streamPresets(),
    api.suiteStatus(),
    api.twitchCreatorOps(),
    api.discordStatus(),
    api.discordRelayStatus(),
    api.botCompletion(),
  ]);
  state.status = status;
  syncLaunchPreparation(launchPreparation);
  state.giveaway = giveaway;
  setCommandState(commands);
  setTimerState(timers);
  setModerationState(moderation);
  state.templates = templates.templates || [];
  state.operatorMessages = operatorMessages.templates || [];
  state.reminder = reminder.reminder || {};
  state.auditLogs = audit.logs || [];
  state.outboundMessages = outbound.messages || [];
  state.outboundSummary = outbound.summary || {};
  state.featureGates = featureGateResult.featureGates || [];
  state.streamPresets = streamPresetResult.presets || [];
  state.suiteStatus = suiteStatus;
  state.twitchOps = twitchOps;
  state.discord = discordStatus;
  state.discordRelayStatus = discordRelayStatus;
  state.botCompletion = botCompletion;
  syncLaunchPreparation(status);
  state.validSetup = isValidationPassed();
}

async function refreshOutboundMessages() {
  await runAction(
    "refreshOutbound",
    async () => {
      const outbound = await api.outboundMessages();
      state.outboundMessages = outbound.messages || [];
      state.outboundSummary = outbound.summary || {};
      return { ok: true };
    },
    { quiet: true },
  );
}

async function refreshAuditLogs() {
  await runAction(
    "refreshAudit",
    async () => {
      const audit = await api.auditLogs();
      state.auditLogs = audit.logs || [];
      return { ok: true };
    },
    { quiet: true },
  );
}

function setCommandState(result = {}) {
  state.commands = result.commands || [];
  state.commandHistory = result.invocations || [];
  state.commandSummary = result.summary || {
    total: 0,
    enabled: 0,
    disabled: 0,
    aliases: 0,
    uses: 0,
  };
  state.commandReservedNames = result.reservedNames || [];
  state.commandPresets = result.presets || state.commandPresets || [];
  state.commandPresetPacks =
    result.presetPacks || state.commandPresetPacks || [];
  state.commandFeatureGate = result.featureGate || state.commandFeatureGate;

  if (
    state.selectedCommandId &&
    !state.commands.some(
      (command) => Number(command.id) === Number(state.selectedCommandId),
    )
  ) {
    state.selectedCommandId = null;
    state.commandDraft = {};
  }
}

function setTimerState(result = {}) {
  state.timers = result.timers || [];
  state.timerSummary = result.summary || {
    total: 0,
    enabled: 0,
    disabled: 0,
    sent: 0,
    blocked: 0,
    waitingForActivity: 0,
    nextFireAt: "",
  };
  state.timerFeatureGate = result.featureGate || state.timerFeatureGate;
  state.timerReadiness = result.readiness || state.timerReadiness;
  state.timerPresets = result.presets || state.timerPresets || [];

  if (
    state.selectedTimerId &&
    !state.timers.some(
      (timer) => Number(timer.id) === Number(state.selectedTimerId),
    )
  ) {
    state.selectedTimerId = null;
    state.timerDraft = {};
  }
}

function setModerationState(result = {}) {
  state.moderation = result;
  state.moderationTerms = result.terms || [];
  state.moderationAllowedLinks = result.allowedLinks || [];
  state.moderationBlockedLinks = result.blockedLinks || [];
  state.moderationLinkPermits = result.linkPermits || [];
  state.moderationHits = result.hits || [];
  state.moderationSummary = result.summary || {
    terms: 0,
    enabledTerms: 0,
    allowedLinks: 0,
    enabledAllowedLinks: 0,
    blockedLinks: 0,
    enabledBlockedLinks: 0,
    activeLinkPermits: 0,
    roleExemptions: 0,
    filtersEnabled: 0,
    enforcementFilters: 0,
    botShield: "off",
    hits: 0,
  };
  state.moderationEnforcement = result.enforcement || null;
  state.moderationFeatureGate =
    result.featureGate || state.moderationFeatureGate;
}

async function runAction(key, fn, options = {}) {
  if (!options.background) {
    foregroundRefreshGeneration += 1;
  }
  state.busy.add(key);
  if (!options.quiet) state.message = { text: "Working...", tone: "muted" };
  if (!options.background) {
    render();
  }

  try {
    const result = await fn();
    if (result && result.ok === false) {
      throw new Error(result.error || "Action failed");
    }
    if (!options.skipRefresh) await refreshAfterAction();
    if (!options.quiet)
      state.message = {
        text: options.success || "Action completed.",
        tone: "ok",
      };
    return result;
  } catch (error) {
    state.message = { text: error.message || "Action failed.", tone: "bad" };
    return null;
  } finally {
    state.busy.delete(key);
    if (!options.background) {
      render();
    }
  }
}

async function startGiveaway() {
  await runGiveawayAction("start", giveawayConfigBody());
}

async function saveGiveawayConfig() {
  await runGiveawayAction("config", giveawayConfigBody());
}

function giveawayConfigBody() {
  return {
    title: field("giveawayTitle").value,
    keyword: field("giveawayKeyword").value || "enter",
    winnerCount: Number(field("winnerCount").value || 1),
    entryWindowMinutes: Number(field("entryWindowMinutes").value || 10),
    itemName: field("itemName").value,
    gameName: field("gameName").value,
    itemEdition: field("itemEdition").value,
    prizeType: field("prizeType").value,
    platformMode: field("platformMode").value,
    supportedPlatforms: String(field("supportedPlatforms").value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    minimumFollowAgeDays: Number(field("minimumFollowAgeDays").value || 7),
    responseWindowMinutes: Number(field("responseWindowMinutes").value || 7),
    previousWinnerRestrictionMode: field("previousWinnerRestrictionMode").value,
    marketplaceName: field("marketplaceName").value,
    marketplaceNote: field("marketplaceNote").value,
    ageGuidanceText: field("ageGuidanceText").value,
    regionAvailabilityDisclaimer: field("regionAvailabilityDisclaimer").value,
  };
}

async function runGiveawayAction(name, body = {}, confirmation) {
  if (
    shouldWarnBeforeGiveawayAction(name) &&
    !confirm(
      `${state.giveaway.assurance.nextAction} Chat may not have received the previous critical giveaway announcement. Continue anyway?`,
    )
  ) {
    return;
  }

  if (confirmation && !confirm(confirmation)) {
    return;
  }
  await runAction(`g${name}`, () => api.giveawayAction(name, body), {
    success: "Giveaway state updated.",
  });
}

function shouldWarnBeforeGiveawayAction(name) {
  const assurance = state.giveaway?.assurance;
  return Boolean(
    assurance?.blockContinue &&
    ["close", "draw", "reroll", "end"].includes(name),
  );
}

async function endGiveaway() {
  const warnings = state.giveaway?.summary?.endWarnings || [];
  const warningText = warnings.length ? `${warnings.join(" ")} ` : "";
  if (!confirm(`${warningText}End giveaway?`)) {
    return;
  }
  await runGiveawayAction("end");
}

async function confirmWinner() {
  await runGiveawayAction("confirm", {
    username: field("confirmSelect").value,
    selectedPlatform: field("selectedPlatform").value,
    regionCountry: field("regionCountry").value,
    deliveryMethod: field("deliveryMethod").value,
    marketplaceUsed: field("marketplaceUsed").value,
    purchaseStatus: field("purchaseStatus").value,
  });
}

async function setWinnerPurchaseStatus() {
  await runGiveawayAction("purchase-status", {
    username: field("purchaseStatusWinnerSelect").value,
    purchaseStatus: field("purchaseStatus").value,
  });
}

async function removeEntrant(login) {
  if (!confirm(`Remove ${login} from this giveaway?`)) {
    return;
  }
  await runGiveawayAction("remove-entrant", {
    username: login,
    reason: "Removed by operator",
  });
}

async function exportGiveawayResults() {
  await runAction(
    "exportGiveawayResults",
    async () => {
      const result = await api.giveawayExport();
      const text = JSON.stringify(result.export || {}, null, 2);
      await navigator.clipboard?.writeText(text);
      state.lastGiveawayExport = result.export;
      return result;
    },
    { success: "Redacted giveaway results copied." },
  );
}

async function runSimulatedCommand() {
  await runAction(
    "runCommand",
    async () => {
      const result = await api.simulateCommand({
        actor: field("simActor").value,
        role: field("simRole").value,
        command: field("simCommand").value,
      });
      state.testResult = result;
      return result;
    },
    { success: "Simulated command completed." },
  );
}

async function runLifecycleTest() {
  if (
    !confirm(
      "Run a local test giveaway? This writes test giveaway rows to SQLite and requires no active giveaway.",
    )
  ) {
    return;
  }
  await runAction(
    "runTestGiveaway",
    async () => {
      const result = await api.giveawayAction("run-test", { confirmed: true });
      state.testResult = result;
      return result;
    },
    { success: "Lifecycle test completed." },
  );
}

async function setFeatureGate(key, mode) {
  if (
    mode === "live" &&
    !confirm(
      "Enable this feature for live Twitch chat? Run local tests first if this is a new workflow.",
    )
  ) {
    return;
  }

  await runAction("featureGate", () => api.setFeatureGate(key, mode), {
    success: "Feature gate updated.",
  });
}
async function applyStreamPreset(id) {
  const preset = (state.streamPresets || []).find((item) => item.id === id);
  const confirmed =
    !preset?.requiresConfirmation ||
    confirm(
      `Apply ${preset.label}? This changes feature gates for stream operation. Run preflight now if you are going live immediately.`,
    );

  if (!confirmed) {
    return;
  }

  await runAction(
    "streamPreset",
    async () => {
      const result = await api.applyStreamPreset(id, confirmed);
      state.streamPresets = result.presets || state.streamPresets;
      state.featureGates = result.featureGates || state.featureGates;
      return result;
    },
    { success: "Stream preset applied." },
  );
}

function newTimer() {
  state.selectedTimerId = null;
  state.timerDraft = {
    timerName: "",
    timerInterval: 5,
    timerMinChatMessages: 5,
    timerEnabled: false,
    timerMessage: "",
  };
  render();
}

function editTimer(id) {
  const timer = (state.timers || []).find(
    (item) => Number(item.id) === Number(id),
  );
  if (!timer) return;
  state.selectedTimerId = timer.id;
  state.timerDraft = {};
  render();
  field("timerName")?.focus();
}

async function saveTimer() {
  await runAction(
    "saveTimer",
    async () => {
      const result = await api.saveTimer(readTimerPayload());
      setTimerState(result);
      state.selectedTimerId = result.timer?.id ?? state.selectedTimerId;
      state.timerDraft = {};
      return result;
    },
    { skipRefresh: true, success: "Timer saved." },
  );
}

async function toggleTimer(id, enabled) {
  await runAction(
    "timerEnable",
    async () => {
      const result = await api.enableTimer(id, enabled);
      setTimerState(result);
      return result;
    },
    {
      skipRefresh: true,
      success: enabled ? "Timer enabled." : "Timer disabled.",
    },
  );
}

async function deleteTimer(id, name) {
  if (!confirm(`Delete timer "${name}"?`)) {
    return;
  }

  await runAction(
    "timerDelete",
    async () => {
      const result = await api.deleteTimer(id);
      setTimerState(result);
      state.selectedTimerId = null;
      state.timerDraft = {};
      return result;
    },
    { skipRefresh: true, success: "Timer deleted." },
  );
}

async function sendTimerNow(id) {
  if (!confirm("Send this timer message to Twitch chat now?")) {
    return;
  }

  await runAction(
    "timerSend",
    async () => {
      const result = await api.sendTimerNow(id);
      setTimerState(result);
      return result;
    },
    { skipRefresh: true, success: "Timer queued." },
  );
}
