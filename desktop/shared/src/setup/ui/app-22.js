function settingsValue(id, fallback) {
  return draftValue(state.settingsDraft, id, fallback);
}

function commandValue(id, fallback) {
  return draftValue(state.commandDraft, id, fallback);
}

function timerValue(id, fallback) {
  return draftValue(state.timerDraft, id, fallback);
}

function moderationValue(id, fallback) {
  return draftValue(state.moderationDraft, id, fallback);
}

function discordValue(id, fallback) {
  return draftValue(state.discordDraft, id, fallback);
}

function twitchOpsValue(id, fallback) {
  return draftValue(state.twitchOpsDraft, id, fallback);
}

function giveawayValue(id, fallback) {
  return draftValue(state.giveawayDraft, id, fallback);
}

function templateValue(action, fallback) {
  return draftValue(state.templateDraft, action, fallback);
}

function operatorTemplateValue(id, fallback) {
  return draftValue(state.operatorTemplateDraft, id, fallback);
}

function reminderValue(id, fallback) {
  return draftValue(state.reminderDraft, id, fallback);
}

function draftValue(draft, id, fallback) {
  return Object.prototype.hasOwnProperty.call(draft, id) ? draft[id] : fallback;
}

function fieldValue(id, fallback) {
  return field(id)?.value ?? settingsValue(id, fallback);
}

function credentialFieldValue(id, hasSavedCredential) {
  const value = fieldValue(id, hasSavedCredential ? savedCredentialMask : "");
  return hasSavedCredential && value === savedCredentialMask ? "" : value;
}

function hasSavedCredential(id) {
  if (id === "clientId") return Boolean(state.config?.hasClientId);
  if (id === "clientSecret") return Boolean(state.config?.hasClientSecret);
  if (id === "relayConsoleToken") {
    return Boolean(state.config?.relay?.hasConsoleToken);
  }
  return false;
}

function setValue(id, value) {
  const node = field(id);
  if (node && document.activeElement !== node) {
    node.value = value;
  }
}

function setChecked(id, value) {
  const node = field(id);
  if (node && document.activeElement !== node) {
    node.checked = Boolean(value);
  }
}

function focusField(id) {
  const node = field(id);
  if (!node) return;
  node.scrollIntoView({ block: "center" });
  node.focus();
}

function syncWinnerSelects() {
  const winners = state.giveaway?.winners || [];
  const activeWinners = winners.filter((winner) => !winner.rerolled_at);
  setOptions("rerollSelect", activeWinners);
  setOptions(
    "claimSelect",
    activeWinners.filter((winner) => !winner.claimed_at),
  );
  setOptions(
    "deliverSelect",
    activeWinners.filter((winner) => !winner.delivered_at),
  );
  setOptions(
    "confirmSelect",
    activeWinners.filter((winner) => winner.status !== "confirmed"),
  );
  setOptions(
    "expireSelect",
    activeWinners.filter((winner) => winner.status !== "expired"),
  );
  setOptions("purchaseStatusWinnerSelect", activeWinners);
}

function setOptions(id, winners) {
  const node = field(id);
  if (!node) return;
  const selected = giveawayValue(id, node.value);
  node.replaceChildren(
    ...winners.map((winner) => option(winner.login, winner.display_name)),
  );
  if (winners.some((winner) => winner.login === selected)) {
    node.value = selected;
  }
}

function suggestedDrawCount() {
  const summary = state.giveaway?.summary || {};
  const remaining = Math.max(
    Number(summary.winnerCount || 1) - Number(summary.winnersDrawn || 0),
    1,
  );
  return Math.min(
    remaining,
    Math.max(Number(summary.entryCount || remaining), 1),
  );
}

function updateDisabledState() {
  const summary = state.giveaway?.summary || {};
  const status = summary.status || "none";
  const winners = state.giveaway?.winners || [];
  const activeWinners = winners.filter((winner) => !winner.rerolled_at);
  const undelivered = activeWinners.filter((winner) => !winner.delivered_at);
  const config = state.config || {};
  const discordConfig = state.discord?.config || config.discord || {};
  const discordRelayConfig = discordConfig.relay || {};
  const hostedDiscord = discordHostedConfig();
  const hostedDiscordReady =
    discordRelayConfig.configured && Boolean(hostedDiscord.guildId);
  const localDiscordReady = Boolean(
    discordConfig.hasBotToken && discordConfig.guildId,
  );
  const relayConfig = config.relay || {};
  const runtime = state.status?.runtime || {};
  const botProcess = runtime.botProcess || {};
  const connectReady =
    config.hasClientId &&
    config.hasClientSecret &&
    Boolean(config.redirectUri) &&
    Boolean(config.botLogin);
  const validationReady = missingConfigFields(config).length === 0;
  const guideValidationReady =
    validationReady && Boolean(config.hasAccessToken);
  const botRunning = Boolean(botProcess.running);
  const botStartReady = canStartBot(runtime);
  const hasGiveaway = status !== "none";
  const hasRecap = Boolean(state.giveaway?.recap?.available);
  const failedCritical = criticalGiveawayFailures().length > 0;
  const canSendGiveawayStatus = hasGiveaway && state.validSetup;
  const canPanicResend = failedCritical && state.validSetup;
  const relayProgress = getRelaySetupProgress(relayConfig);
  const relayEventSubReady =
    relayConfig.readiness?.ready &&
    relayProgress.botAuthorized &&
    relayProgress.broadcasterAuthorized &&
    relayProgress.separateAccounts;

  setDisabled(
    "gstart",
    status !== "none",
    "Start is disabled because a giveaway already exists.",
  );
  setDisabled(
    "gconfig",
    !hasGiveaway,
    "Save config is disabled until a giveaway exists.",
  );
  setDisabled(
    "gtimerStart",
    status !== "open",
    "Timer controls are disabled unless entries are open.",
  );
  setDisabled(
    "gtimerStop",
    status !== "open" || !summary.timer?.running,
    "Stop timer is disabled unless the entry timer is running.",
  );
  setDisabled(
    "glastcall",
    status !== "open",
    "Last call is disabled unless entries are open.",
  );
  setDisabled(
    "gclose",
    status !== "open",
    "Close is disabled unless entries are open.",
  );
  setDisabled(
    "gdraw",
    status !== "closed",
    "Draw is disabled until entries are closed.",
  );
  setDisabled(
    "gend",
    status === "none",
    "End is disabled because no giveaway exists.",
  );
  setDisabled(
    "greroll",
    activeWinners.length === 0,
    "Reroll is disabled until winners exist.",
  );
  setDisabled(
    "gclaim",
    activeWinners.filter((winner) => !winner.claimed_at).length === 0,
    "Claim is disabled until an unclaimed winner exists.",
  );
  setDisabled(
    "gconfirm",
    activeWinners.filter((winner) => winner.status !== "confirmed").length ===
      0,
    "Confirm is disabled until a pending or expired winner exists.",
  );
  setDisabled(
    "gexpire",
    activeWinners.filter((winner) => winner.status !== "expired").length === 0,
    "Expire is disabled until a pending winner exists.",
  );
  setDisabled(
    "gpurchaseStatus",
    activeWinners.length === 0,
    "Purchase status is disabled until winners exist.",
  );
  setDisabled(
    "gdeliver",
    undelivered.length === 0,
    "Deliver is disabled until an undelivered winner exists.",
  );
  setDisabled(
    "gdeliverAll",
    undelivered.length === 0,
    "Mark all delivered is disabled until undelivered winners exist.",
  );
  setDisabled(
    "copyWinners",
    activeWinners.length === 0,
    "Copy winners is disabled until winners exist.",
  );
  setDisabled(
    "exportGiveawayResults",
    !hasGiveaway && !hasRecap,
    "Export is disabled until a giveaway or recap exists.",
  );
  setDisabled(
    "dashboardSendGiveawayStatus",
    !canSendGiveawayStatus,
    hasGiveaway
      ? "Automatic validation must pass before sending status to chat."
      : "No giveaway exists.",
  );
  setDisabled(
    "liveSendGiveawayStatus",
    !canSendGiveawayStatus,
    hasGiveaway
      ? "Automatic validation must pass before sending status to chat."
      : "No giveaway exists.",
  );
  setDisabled(
    "dashboardPanicResendCritical",
    !canPanicResend,
    failedCritical
      ? "Automatic validation must pass before panic resend."
      : "No failed critical giveaway message exists.",
  );
  setDisabled(
    "livePanicResendCritical",
    !canPanicResend,
    failedCritical
      ? "Automatic validation must pass before panic resend."
      : "No failed critical giveaway message exists.",
  );
  setDisabled(
    "panicCardResendCritical",
    !canPanicResend,
    failedCritical
      ? "Automatic validation must pass before panic resend."
      : "No failed critical giveaway message exists.",
  );
  setDisabled("dashboardCopyRecap", !hasRecap, "No giveaway recap exists.");
  setDisabled("liveCopyRecap", !hasRecap, "No giveaway recap exists.");
  setDisabled("postStreamCopyRecap", !hasRecap, "No giveaway recap exists.");
  setDisabled(
    "sendReminderNow",
    status !== "open",
    "Reminder is disabled unless entries are open.",
  );
  setDisabled(
    "validate",
    !validationReady,
    "Save Twitch credentials and connect OAuth before rerunning validation.",
  );
  setDisabled(
    "guideValidate",
    !guideValidationReady,
    "Connect Twitch before rerunning validation.",
  );
  setDisabled(
    "disconnectTwitch",
    !config.hasAccessToken,
    "No Twitch connection to disconnect.",
  );
  setDisabled(
    "guideDisconnectTwitch",
    !config.hasAccessToken,
    "No Twitch connection to disconnect.",
  );
  setDisabled(
    "test",
    !state.validSetup,
    "Automatic validation must pass before sending a setup test message.",
  );
  setDisabled(
    "guideTest",
    !state.validSetup,
    "Automatic validation must pass before sending a setup test message.",
  );
  setDisabled(
    "sendChat",
    !state.validSetup,
    "Automatic validation must pass before sending chat.",
  );
  setDisabled(
    "ping",
    !state.validSetup,
    "Automatic validation must pass before sending chat.",
  );
  for (const template of state.operatorMessages || []) {
    setDisabled(
      `operator-send-${template.id}`,
      !state.validSetup,
      "Automatic validation must pass before sending operator messages.",
    );
  }
  setDisabled(
    "botStart",
    !botStartReady || botRunning,
    botRunning
      ? "Bot is already running."
      : "Complete setup and let automatic validation finish before starting the bot.",
  );
  setDisabled(
    "guideBotStart",
    !botStartReady || botRunning,
    botRunning
      ? "Bot is already running."
      : "Complete setup and let automatic validation finish before starting the bot.",
  );
  setDisabled("botStop", !botRunning, "Bot is not running.");
  setDisabled("guideBotStop", !botRunning, "Bot is not running.");
  setDisabled(
    "discordValidateBot",
    !discordConfig.hasBotToken,
    "Save a Discord bot token before validating the bot.",
  );
  setDisabled(
    "discordPreviewSetup",
    !(hostedDiscordReady || localDiscordReady),
    "Connect Discord through Relay or save a local bot token and server ID before previewing setup.",
  );
  setDisabled(
    "discordApplySetup",
    !(hostedDiscordReady || localDiscordReady),
    "Connect Discord through Relay or save a local bot token and server ID before applying setup.",
  );
  setDisabled(
    "discordSendAnnouncement",
    !(discordConfig.hasBotToken && discordConfig.streamAnnouncementChannelId),
    "Save Discord setup and an announcement channel before sending.",
  );
  setDisabled(
    "discordRelayStatus",
    !discordRelayConfig.configured,
    "Save Relay URL, installation ID, and console token before checking Discord Relay.",
  );
  setDisabled(
    "discordRelayHostedRefresh",
    !discordRelayConfig.configured,
    "Save Relay URL, installation ID, and console token before checking hosted Discord status.",
  );
  setDisabled(
    "discordRelayInstallStart",
    !discordRelayConfig.configured,
    "Save Relay URL, installation ID, and console token before connecting Discord.",
  );
  setDisabled(
    "discordRelayRegisterCommands",
    !(discordRelayConfig.configured && hostedDiscordReady),
    "Connect Discord through Relay before registering slash commands.",
  );
  setDisabled(
    "discordRelayRegisterCommandsHosted",
    !(discordRelayConfig.configured && hostedDiscordReady),
    "Connect Discord through Relay before registering slash commands.",
  );
  setDisabled(
    "discordRelayLoadSuggestions",
    !discordRelayConfig.configured,
    "Save Relay URL, installation ID, and console token before loading suggestions.",
  );
  setDisabled(
    "discordLockStaffCategory",
    !(
      discordValue("discordStaffRoleId", discordConfig.staffRoleId || "") ||
      field("discordStaffRoleId")?.value
    ),
    "Save or enter a Staff role ID before enabling Staff category privacy.",
  );
  setDisabled(
    "relayStatus",
    !relayConfig.readiness?.ready,
    "Start hosted Twitch setup before checking Relay.",
  );
  setDisabled(
    "settingsRelayStatus",
    !relayConfig.readiness?.ready,
    "Start hosted Twitch setup before checking Relay.",
  );
  setDisabled(
    "guideRelayStatus",
    !relayConfig.readiness?.ready,
    "Start hosted Twitch setup before checking Relay.",
  );
  setDisabled(
    "guideRelayStatusAfterOAuth",
    !relayConfig.readiness?.ready,
    "Start hosted Twitch setup before checking Relay.",
  );
  setDisabled(
    "relayRegisterEventSub",
    !relayEventSubReady,
    "Complete bot and broadcaster OAuth with separate accounts before registering EventSub.",
  );
  setDisabled(
    "guideRelayRegisterEventSub",
    !relayEventSubReady,
    "Complete bot and broadcaster OAuth with separate accounts before registering EventSub.",
  );
  setDisabled(
    "relayTestSend",
    relayConfig.twitchTransportMode !== "relay-chatbot" ||
      !relayConfig.readiness?.ready ||
      !relayProgress.eventSubRegistered,
    "Register Twitch EventSub before sending a Relay test message.",
  );
  setDisabled(
    "guideRelayTestSend",
    relayConfig.twitchTransportMode !== "relay-chatbot" ||
      !relayConfig.readiness?.ready ||
      !relayProgress.eventSubRegistered,
    "Register Twitch EventSub before sending a Relay test message.",
  );
  setDisabled(
    "relayValidateChatbotIdentity",
    config.relay?.twitchTransportMode !== "relay-chatbot",
    "Select Hosted mode before recording live Chat Bot validation.",
  );
  setDisabled(
    "relayValidateChatbotIdentityHosted",
    config.relay?.twitchTransportMode !== "relay-chatbot",
    "Select Hosted mode before recording live Chat Bot validation.",
  );
  setDisabled(
    "guideRelayValidateChatbotIdentity",
    config.relay?.twitchTransportMode !== "relay-chatbot",
    "Select Hosted mode before recording live Chat Bot validation.",
  );

  const connectLinks = [
    ...document.querySelectorAll('a[data-action="connect-twitch"]'),
  ];
  for (const link of connectLinks) {
    if (!connectReady) link.classList.add("disabled");
  }
}
