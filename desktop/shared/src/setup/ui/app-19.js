async function validateDiscordBot() {
  await runAction(
    "discordValidateBot",
    async () => {
      const result = await api.discordStatus(true);
      state.discord = result;
      return result;
    },
    { skipRefresh: true, success: "Discord bot validation completed." },
  );
}

async function loadDiscordRoles() {
  await runAction(
    "discordLoadRoles",
    async () => {
      const result = await api.discordRoles();
      state.discordRoles = result.roles || [];
      state.discordRolesStatus = result;
      state.discord = {
        ...(state.discord || {}),
        config: result.config || state.discord?.config,
      };
      return result;
    },
    { skipRefresh: true, success: "Discord roles loaded." },
  );
}

function selectDiscordStaffRole(event) {
  const roleId = event?.target?.value || "";
  if (!roleId) return;
  state.discordDraft.staffRoleId = roleId;
  setValue("discordStaffRoleId", roleId);
}

async function saveDiscordSettings() {
  await runAction(
    "discordSave",
    async () => {
      const result = await api.saveDiscordConfig(readDiscordConfigPayload());
      state.discord = {
        ...(state.discord || {}),
        config: result.config,
      };
      state.discordDraft = {};
      return result;
    },
    { skipRefresh: true, success: "Discord settings saved." },
  );
}

function readDiscordSetupPayload() {
  return {
    templateId: field("discordSetupTemplateId")?.value || "",
    includeRoles: Boolean(field("discordCreateStreamAlertsRole")?.checked),
    applyPermissions: Boolean(field("discordApplyPermissions")?.checked),
    postStarterMessages: Boolean(field("discordPostStarterMessages")?.checked),
    lockStaffCategory: Boolean(field("discordLockStaffCategory")?.checked),
    staffRoleId: field("discordStaffRoleId")?.value || "",
  };
}

async function startDiscordRelayInstall() {
  if (!operatorRoleAllows("admin")) {
    state.message = {
      text: operatorRoleBlockedReason("admin"),
      tone: "warn",
    };
    render();
    return;
  }

  await runAction(
    "discordRelayInstallStart",
    async () => {
      const result = await api.discordRelayInstallStart();
      openExternalSetupUrl(result.authorizeUrl);
      state.discordRelayInstall = result;
      return result;
    },
    {
      skipRefresh: true,
      success: "Discord authorization opened. Return here after approving it.",
    },
  );
}

async function previewDiscordSetup() {
  await runAction(
    "discordPreviewSetup",
    async () => {
      const payload = readDiscordSetupPayload();
      const hostedSetup = useHostedDiscordSetup();
      const result = hostedSetup
        ? await api.previewDiscordRelaySetup(payload)
        : await api.previewDiscordSetup(payload);
      state.discordSetupPreview = result;
      if (hostedSetup) {
        state.discordRelayStatus = await api.discordRelayStatus();
      } else {
        state.discord = {
          ...(state.discord || {}),
          config: result.config || state.discord?.config,
        };
      }
      return result;
    },
    { skipRefresh: true, success: "Discord setup preview updated." },
  );
}

async function applyDiscordSetup() {
  if (
    !confirm(
      "Apply the Discord server layout now? Existing channels with matching names are reused.",
    )
  ) {
    return;
  }

  await runAction(
    "discordApplySetup",
    async () => {
      const payload = readDiscordSetupPayload();
      const hostedSetup = useHostedDiscordSetup();
      const result = hostedSetup
        ? await api.applyDiscordRelaySetup(payload)
        : await api.applyDiscordSetup(payload);
      state.discordSetupPreview = result;
      if (hostedSetup) {
        state.discordRelayStatus = await api.discordRelayStatus();
      } else {
        state.discord = await api.discordStatus();
      }
      return result;
    },
    { skipRefresh: true, success: "Discord server setup applied." },
  );
}

async function sendDiscordStreamAnnouncement() {
  if (!operatorRoleAllows("admin")) {
    state.message = {
      text: operatorRoleBlockedReason("admin"),
      tone: "warn",
    };
    render();
    return;
  }

  await runAction(
    "discordSendAnnouncement",
    async () => api.sendDiscordAnnouncement(readDiscordAnnouncementPayload()),
    { skipRefresh: true, success: "Discord announcement sent." },
  );
}

async function checkDiscordRelayStatus() {
  await runAction(
    "discordRelayStatus",
    async () => {
      const result = await api.discordRelayStatus();
      state.discordRelayStatus = result;
      state.discord = {
        ...(state.discord || {}),
        relay: result.relay || state.discord?.relay,
      };
      return result;
    },
    { skipRefresh: true, success: "Discord Relay status checked." },
  );
}

async function registerDiscordRelayCommands() {
  if (!operatorRoleAllows("admin")) {
    state.message = {
      text: operatorRoleBlockedReason("admin"),
      tone: "warn",
    };
    render();
    return;
  }

  if (
    !confirm(
      "Register VaexCore Discord slash commands through Relay? This updates the commands for the configured Discord application.",
    )
  ) {
    return;
  }

  await runAction(
    "discordRelayRegisterCommands",
    async () => {
      const result = await api.registerDiscordRelayCommands();
      state.discordRelayStatus = await api.discordRelayStatus();
      return result;
    },
    { skipRefresh: true, success: "Discord slash commands registered." },
  );
}

async function loadDiscordRelaySuggestions() {
  await runAction(
    "discordRelayLoadSuggestions",
    async () => {
      const result = await api.discordRelaySuggestions();
      state.discordRelaySuggestions = result.suggestions || [];
      return result;
    },
    { skipRefresh: true, success: "Discord suggestions loaded." },
  );
}

async function loadDiscordRelayActions(statusInput, fetchRemote = false) {
  const status =
    typeof statusInput === "string"
      ? statusInput
      : state.discordRelayActionFilter || "active";
  state.discordRelayActionFilter = status;
  await runAction(
    "discordRelayLoadActions",
    async () => {
      const result = fetchRemote
        ? await api.discordRelayEvents()
        : { ok: true, events: [] };
      const actionResult = await api.discordRelayActions(
        state.discordRelayActionFilter,
      );
      state.discordRelayEvents = result.events || [];
      state.discordRelayActions = actionResult.actions || [];
      return { ...result, actions: actionResult.actions };
    },
    { skipRefresh: true, success: "Discord Relay action queue loaded." },
  );
}

async function markDiscordRelayAction(id, status) {
  const requiredRole = status === "rejected" ? "moderator" : "admin";
  if (!operatorRoleAllows(requiredRole)) {
    state.message = {
      text: operatorRoleBlockedReason(requiredRole),
      tone: "warn",
    };
    render();
    return;
  }

  if (
    ["approved", "rejected", "sent"].includes(status) &&
    !confirm(`Mark this Discord Relay action ${status}?`)
  ) {
    return;
  }

  await runAction(
    `discordRelayAction:${id}:${status}`,
    async () => {
      const result = await api.updateDiscordRelayAction(id, status);
      const refreshed = await api.discordRelayActions(
        state.discordRelayActionFilter,
      );
      state.discordRelayActions = refreshed.actions || [];
      return result;
    },
    {
      skipRefresh: true,
      success: `Discord Relay action marked ${status}.`,
    },
  );
}

async function updateDiscordRelaySuggestion(id, status) {
  await runAction(
    `discordRelaySuggestion:${id}:${status}`,
    async () => {
      const result = await api.updateDiscordRelaySuggestion(id, status);
      const refreshed = await api.discordRelaySuggestions();
      state.discordRelaySuggestions = refreshed.suggestions || [];
      return result;
    },
    { skipRefresh: true, success: `Discord suggestion marked ${status}.` },
  );
}

async function disconnectTwitch() {
  if (
    !confirm(
      "Disconnect the current Twitch OAuth token? Your app Client ID and Client Secret stay saved.",
    )
  ) {
    return;
  }

  await runAction(
    "disconnectTwitch",
    async () => {
      const result = await api.disconnectTwitch();
      state.config = result.config;
      state.validSetup = false;
      state.validationChecks = [];
      state.oauthNotice = {
        tone: "ok",
        text: `Twitch connection cleared. Log into the Bot Login account (${state.config?.botLogin || "Bot Login"}), then click Connect Twitch as Bot Login.`,
      };
      return result;
    },
    { skipRefresh: true, success: "Twitch connection cleared." },
  );
  await refreshAll();
}

function derivedTransportForSetupMode(mode) {
  if (mode === "relay-assisted") return "relay-chatbot";
  if (mode === "local-only") return "local-user-token";
  return state.config?.relay?.twitchTransportMode || "relay-chatbot";
}

async function persistSetupMode(mode) {
  if (!setupModeIds.includes(mode)) {
    return;
  }

  if (
    mode === currentSetupMode(state.config || {}) &&
    !state.settingsDraft.setupMode
  ) {
    return;
  }

  const hadModeDraft = Object.hasOwn(state.settingsDraft, "setupMode");
  const hadTransportDraft = Object.hasOwn(
    state.settingsDraft,
    "twitchTransportMode",
  );
  const previousModeDraft = state.settingsDraft.setupMode;
  const previousTransportDraft = state.settingsDraft.twitchTransportMode;
  const derivedTransport = derivedTransportForSetupMode(mode);

  state.settingsDraft.setupMode = mode;
  if (mode === "relay-assisted") {
    state.settingsDraft.twitchTransportMode = derivedTransport;
  } else if (mode === "local-only") {
    state.settingsDraft.twitchTransportMode = derivedTransport;
  } else if (!state.settingsDraft.twitchTransportMode) {
    state.settingsDraft.twitchTransportMode = derivedTransport;
  }

  setValue("setupMode", mode);
  setValue("twitchTransportMode", state.settingsDraft.twitchTransportMode);

  const result = await runAction(
    "setupModeSave",
    async () => {
      const saved = await api.saveSetupMode(mode);
      state.config = saved.config || state.config;
      delete state.settingsDraft.setupMode;
      delete state.settingsDraft.twitchTransportMode;
      state.botCompletion = await api.botCompletion();
      return saved;
    },
    {
      skipRefresh: true,
      success: `${setupModeLabel(mode)} mode selected.`,
    },
  );

  if (!result) {
    if (hadModeDraft) {
      state.settingsDraft.setupMode = previousModeDraft;
    } else {
      delete state.settingsDraft.setupMode;
    }
    if (hadTransportDraft) {
      state.settingsDraft.twitchTransportMode = previousTransportDraft;
    } else {
      delete state.settingsDraft.twitchTransportMode;
    }
    render();
  }
}
function updateSettingsDraft(event) {
  const { id, value } = event.target;
  state.settingsDraft[id] = value;
  if (id === "setupMode" && value === "local-only") {
    state.settingsDraft.twitchTransportMode = "local-user-token";
    setValue("twitchTransportMode", "local-user-token");
  }
  if (id === "setupMode" && value === "relay-assisted") {
    state.settingsDraft.twitchTransportMode = "relay-chatbot";
    setValue("twitchTransportMode", "relay-chatbot");
  }
  if (id === "twitchTransportMode") {
    const currentMode = settingsValue("setupMode", currentSetupMode());
    if (currentMode !== "advanced") {
      state.settingsDraft.setupMode =
        value === "relay-chatbot" ? "relay-assisted" : "local-only";
      setValue("setupMode", state.settingsDraft.setupMode);
    }
  }
}

function updateDiscordDraft(event) {
  state.discordDraft[event.target.id] =
    event.target.type === "checkbox"
      ? event.target.checked
      : event.target.value;
  if (event.target.id === "discordSetupTemplateId") {
    state.discordSetupPreview = null;
    const config = state.discord?.config || state.config?.discord || {};
    const template = (config.setupTemplates || []).find(
      (item) => item.id === event.target.value,
    );
    const postStarterMessages = Boolean(template?.postStarterMessagesByDefault);
    state.discordDraft.discordPostStarterMessages = postStarterMessages;
    setChecked("discordPostStarterMessages", postStarterMessages);
  }
  updateDisabledState();
}

function updateTwitchOpsDraft(event) {
  state.twitchOpsDraft[event.target.id] =
    event.target.type === "checkbox"
      ? event.target.checked
      : event.target.value;
}

function updateCommandDraft(event) {
  const value =
    event.target.type === "checkbox"
      ? event.target.checked
      : event.target.value;
  state.commandDraft[event.target.id] = value;
}

function updateTimerDraft(event) {
  const value =
    event.target.type === "checkbox"
      ? event.target.checked
      : event.target.value;
  state.timerDraft[event.target.id] = value;
}

function updateModerationDraft(event) {
  const value =
    event.target.type === "checkbox"
      ? event.target.checked
      : event.target.value;
  state.moderationDraft[event.target.id] = value;
}

function updateModerationTermDraft(event) {
  const value =
    event.target.type === "checkbox"
      ? event.target.checked
      : event.target.value;
  state.moderationTermDraft[event.target.id] = value;
}

function updateModerationAllowedLinkDraft(event) {
  const value =
    event.target.type === "checkbox"
      ? event.target.checked
      : event.target.value;
  state.moderationAllowedLinkDraft[event.target.id] = value;
}

function updateModerationBlockedLinkDraft(event) {
  const value =
    event.target.type === "checkbox"
      ? event.target.checked
      : event.target.value;
  state.moderationBlockedLinkDraft[event.target.id] = value;
}

function updateModerationPermitDraft(event) {
  state.moderationPermitDraft[event.target.id] = event.target.value;
}

function updateGiveawayDraft(event) {
  state.giveawayDraft[event.target.id] = event.target.value;
}

function updateTemplateDraft(event) {
  const action = event.target.dataset.action;
  if (!action) return;
  state.templateDraft[action] = event.target.value;
}

function updateOperatorTemplateDraft(event) {
  const id = event.target.dataset.id;
  if (!id) return;
  state.operatorTemplateDraft[id] = event.target.value;
}

function updateReminderDraft(event) {
  const value =
    event.target.type === "checkbox"
      ? event.target.checked
      : event.target.value;
  state.reminderDraft[event.target.id] = value;
}
