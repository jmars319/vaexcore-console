async function exportCustomCommands() {
  await runAction(
    "exportCommands",
    async () => {
      const exported = await api.exportCommands();
      downloadTextFile(
        `vaexcore-custom-commands-${new Date().toISOString().slice(0, 10)}.json`,
        `${JSON.stringify(exported, null, 2)}\n`,
        "application/json",
      );
      return { ok: true };
    },
    { skipRefresh: true, success: "Custom commands exported." },
  );
}

async function importCustomCommands() {
  const raw = field("commandImportJson")?.value || "";
  if (!raw.trim()) {
    state.message = {
      text: "Paste exported command JSON before importing.",
      tone: "warn",
    };
    render();
    return;
  }

  await runAction(
    "importCommands",
    async () => {
      const result = await api.importCommands(JSON.parse(raw));
      setCommandState(result);
      state.commandDraft = {};
      return result;
    },
    { skipRefresh: true, success: "Custom commands imported." },
  );
}

async function exportBotConfigBundle() {
  await runAction(
    "exportBotConfig",
    async () => {
      const exported = await api.exportBotConfig();
      downloadTextFile(
        `vaexcore-safe-bot-config-${new Date().toISOString().slice(0, 10)}.json`,
        `${JSON.stringify(exported, null, 2)}\n`,
        "application/json",
      );
      return { ok: true };
    },
    { skipRefresh: true, success: "Safe bot config exported." },
  );
}

async function importBotConfigBundle() {
  const raw = field("botConfigImportJson")?.value || "";
  if (!raw.trim()) {
    state.message = {
      text: "Paste exported safe bot config JSON before importing.",
      tone: "warn",
    };
    render();
    return;
  }

  await runAction(
    "importBotConfig",
    async () => api.importBotConfig(JSON.parse(raw)),
    {
      success: "Safe bot config imported.",
    },
  );
}
async function saveSettings() {
  const payload = readSettingsPayload();

  await runAction(
    "save",
    async () => {
      const result = await api.saveConfig(payload);
      state.config = result.config;
      state.settingsDraft = {};
      return result;
    },
    { success: "Settings saved." },
  );
}
async function checkRelayStatus() {
  await runAction(
    "relayStatus",
    async () => {
      const result = await api.relayStatus();
      state.relayStatus = result;
      state.config = {
        ...(state.config || {}),
        relay: result.relay || state.config?.relay,
      };
      state.botCompletion = await api.botCompletion();
      return result;
    },
    { skipRefresh: true, success: "Relay status checked." },
  );
}

async function connectHostedRelay(force = false) {
  await runAction(
    "relayHostedConnect",
    async () => {
      const result = await api.connectHostedRelay({ force });
      state.config = result.config || state.config;
      state.relayStatus = result.status || state.relayStatus;
      state.botCompletion = await api.botCompletion();
      const botUrl =
        result.install?.next?.botOAuthUrl ||
        result.relay?.setupUrls?.twitchBotOAuthUrl ||
        state.config?.relay?.setupUrls?.twitchBotOAuthUrl;
      if (!result.alreadyPaired && botUrl) {
        openExternalSetupUrl(botUrl);
      }
      return result;
    },
    {
      skipRefresh: true,
      success: "Hosted Relay pairing is ready.",
    },
  );
}

async function checkSetupMode(mode) {
  await runAction(
    mode === "relay-assisted" ? "checkRelaySetupMode" : "checkLocalSetupMode",
    async () => {
      const result = await api.checkSetupMode(mode);
      state.config = result.config || state.config;
      state.botCompletion = await api.botCompletion();
      return result;
    },
    {
      skipRefresh: true,
      success: `${setupModeLabel(mode)} checked.`,
    },
  );
}

async function runSetupHealthChecks() {
  const mode = currentSetupMode(state.config || {});
  const modes = mode === "advanced" ? ["local-only", "relay-assisted"] : [mode];

  await runAction(
    "setupHealthChecks",
    async () => {
      let result = null;
      for (const item of modes) {
        result = await api.checkSetupMode(item);
        state.config = result.config || state.config;
      }
      state.botCompletion = await api.botCompletion();
      return result || { ok: true };
    },
    {
      skipRefresh: true,
      success: "Provider setup checks completed.",
    },
  );
}

async function registerRelayEventSub() {
  if (
    !confirm(
      "Register the required Twitch EventSub chat subscription through Relay? This is normally automatic after both Twitch OAuth grants, but it is safe to retry.",
    )
  ) {
    return;
  }

  await runAction(
    "relayRegisterEventSub",
    async () => {
      const result = await api.registerRelayEventSub();
      state.relayEventSubResult = result;
      state.relayStatus = await api.relayStatus();
      state.botCompletion = await api.botCompletion();
      return result;
    },
    { skipRefresh: true, success: "Relay EventSub registered." },
  );
}

async function sendRelayTestMessage() {
  await runAction(
    "relayTestSend",
    async () => {
      const result = await api.relayTestSend();
      state.relayTestSendResult = result;
      state.config = {
        ...(state.config || {}),
        relay: result.relay || state.config?.relay,
      };
      return result;
    },
    { skipRefresh: true, success: "Relay test message sent." },
  );
}

async function markRelayChatbotIdentityValidated() {
  if (
    !confirm(
      "Mark Twitch Chat Bot identity as live-tested only after Twitch shows vaexcorebot as a Chat Bot in the channel user list.",
    )
  ) {
    return;
  }

  await runAction(
    "relayValidateChatbotIdentity",
    async () => {
      const result = await api.markRelayChatbotIdentityValidated({
        confirmed: true,
        note: "Operator confirmed Twitch user list shows vaexcorebot as Chat Bot.",
      });
      state.config = {
        ...(state.config || {}),
        relay: result.relay,
      };
      return result;
    },
    { skipRefresh: true, success: "Chat Bot identity validation recorded." },
  );
}

async function refreshBotCompletion() {
  await runAction(
    "botCompletion",
    async () => {
      const result = await api.botCompletion();
      state.botCompletion = result;
      return result;
    },
    { skipRefresh: true, success: "Bot completion refreshed." },
  );
}

async function recordBotValidation(key, confirmed = true) {
  await runAction(
    `botValidation:${key}`,
    async () => {
      const result = await api.recordBotValidation(key, confirmed);
      state.botCompletion = await api.botCompletion();
      return result;
    },
    {
      skipRefresh: true,
      success: confirmed
        ? "Bot validation record saved."
        : "Bot validation record cleared.",
    },
  );
}

async function runBotRehearsal() {
  await runAction(
    "botRehearsal",
    async () => {
      const result = await api.runBotRehearsal();
      state.botRehearsal = result;
      state.botCompletion = result.completion || state.botCompletion;
      return result;
    },
    { skipRefresh: true, success: "Bot setup rehearsal completed." },
  );
}

async function runFullLocalRehearsal() {
  await runAction(
    "localRehearsal",
    async () => {
      const result = await api.runFullLocalRehearsal();
      state.localRehearsal = result;
      state.botCompletion = result.completion || state.botCompletion;
      state.botRehearsal = result.botRehearsal || state.botRehearsal;
      state.relayStatus = result.relayStatus || state.relayStatus;
      state.discordSetupPreview =
        result.discordPreview || state.discordSetupPreview;
      state.diagnostics = result.diagnostics || state.diagnostics;
      if (result.giveaway?.summary) {
        state.giveaway = {
          ...(state.giveaway || {}),
          summary: result.giveaway.summary,
          assurance: result.giveaway.assurance,
        };
      }
      return result;
    },
    { skipRefresh: true, success: "Full local rehearsal completed." },
  );
}

async function loadBotSupportBundle() {
  await runAction(
    "botSupportBundle",
    async () => {
      const result = await api.botSupportBundle();
      state.botSupportBundle = result;
      state.botCompletion = result.completion || state.botCompletion;
      return result;
    },
    { skipRefresh: true, success: "Bot support bundle generated." },
  );
}

async function copyBotSupportBundle() {
  await runAction(
    "botSupportBundleCopy",
    async () => {
      const result = await api.botSupportBundle();
      state.botSupportBundle = result;
      state.botCompletion = result.completion || state.botCompletion;
      await copyText(
        JSON.stringify(result, null, 2),
        "Bot support bundle copied.",
      );
      return result;
    },
    { skipRefresh: true, quiet: true },
  );
}

async function exportBotSupportBundle() {
  await runAction(
    "botSupportBundleExport",
    async () => {
      const result = await api.botSupportBundle();
      state.botSupportBundle = result;
      state.botCompletion = result.completion || state.botCompletion;
      downloadTextFile(
        `vaexcore-bot-support-${new Date().toISOString().slice(0, 10)}.json`,
        `${JSON.stringify(result, null, 2)}\n`,
        "application/json",
      );
      return result;
    },
    { skipRefresh: true, success: "Bot support bundle exported." },
  );
}

async function copySetupText(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    state.message = { text: "Copied setup value.", tone: "ok" };
  } catch {
    state.message = { text, tone: "info" };
  }
  render();
}

function openExternalSetupUrl(url) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

async function startTwitchPoll() {
  await runTwitchCreatorOp(
    "poll",
    {
      title: field("twitchPollTitle")?.value || "",
      choices: field("twitchPollChoices")?.value || "",
      durationSeconds: field("twitchPollDuration")?.value || "120",
    },
    "Start this Twitch poll live?",
    "Twitch poll started.",
  );
}

async function endTwitchPoll() {
  const id = prompt("Poll ID to end:");
  if (!id) return;
  await runTwitchCreatorOp(
    "poll/end",
    { id, status: "TERMINATED" },
    "End this Twitch poll now?",
    "Twitch poll ended.",
  );
}

async function startTwitchPrediction() {
  await runTwitchCreatorOp(
    "prediction",
    {
      title: field("twitchPredictionTitle")?.value || "",
      outcomes: field("twitchPredictionOutcomes")?.value || "",
      predictionWindowSeconds: field("twitchPredictionWindow")?.value || "120",
    },
    "Start this Twitch prediction live?",
    "Twitch prediction started.",
  );
}

async function endTwitchPrediction(status) {
  await runTwitchCreatorOp(
    "prediction/end",
    {
      id: field("twitchPredictionId")?.value || "",
      status,
      winningOutcomeId: field("twitchWinningOutcomeId")?.value || "",
    },
    `${status.toLowerCase()} this Twitch prediction now?`,
    "Twitch prediction updated.",
  );
}

async function sendTwitchAnnouncement() {
  await runTwitchCreatorOp(
    "announcement",
    {
      message: field("twitchAnnouncementMessage")?.value || "",
      color: field("twitchAnnouncementColor")?.value || "primary",
    },
    "Send this Twitch announcement live?",
    "Twitch announcement sent.",
  );
}

async function sendTwitchShoutout() {
  await runTwitchCreatorOp(
    "shoutout",
    { targetLogin: field("twitchTargetLogin")?.value || "" },
    "Send this Twitch shoutout live?",
    "Twitch shoutout sent.",
  );
}

async function startTwitchRaid() {
  await runTwitchCreatorOp(
    "raid",
    { targetLogin: field("twitchTargetLogin")?.value || "" },
    "Start this Twitch raid flow live?",
    "Twitch raid flow started.",
  );
}

async function cancelTwitchRaid() {
  await runTwitchCreatorOp(
    "raid/cancel",
    {},
    "Cancel the current Twitch raid flow?",
    "Twitch raid flow canceled.",
  );
}

async function runTwitchCreatorOp(action, body, confirmation, success) {
  if (!confirm(confirmation)) {
    return;
  }

  await runAction(
    `twitchCreatorOps:${action}`,
    async () => {
      const result = await api.runTwitchCreatorOp(action, {
        ...body,
        confirmed: true,
      });
      state.twitchOps = result.state || state.twitchOps;
      return result;
    },
    { skipRefresh: true, success },
  );
}
