async function applyTimerPreset(id) {
  await runAction(
    "timerPreset",
    async () => {
      const result = await api.applyTimerPreset(id);
      setTimerState(result);
      state.selectedTimerId = result.timer?.id ?? state.selectedTimerId;
      state.timerDraft = {};
      return result;
    },
    { skipRefresh: true, success: "Timer preset created disabled." },
  );
}

function applyTimerSuggestion(id) {
  const suggestion = timerSuggestions.find((item) => item.id === id);
  if (!suggestion) return;

  state.selectedTimerId = null;
  state.timerDraft = {
    timerName: suggestion.name,
    timerInterval: suggestion.intervalMinutes,
    timerMinChatMessages: suggestion.minChatMessages,
    timerEnabled: false,
    timerMessage: suggestion.message,
  };
  state.message = {
    text: "Timer suggestion loaded into the editor. Review it before saving.",
    tone: "ok",
  };
  render();
  field("timerName")?.focus();
}

async function copyTimerSuggestion(id) {
  const suggestion = timerSuggestions.find((item) => item.id === id);
  if (!suggestion) return;
  await copyText(suggestion.message, "Timer suggestion copied.");
}

async function exportTimers() {
  await runAction(
    "exportTimers",
    async () => {
      const exported = await api.exportTimers();
      downloadTextFile(
        `vaexcore-timers-${new Date().toISOString().slice(0, 10)}.json`,
        `${JSON.stringify(exported, null, 2)}\n`,
        "application/json",
      );
      return { ok: true };
    },
    { skipRefresh: true, success: "Timers exported." },
  );
}

async function importTimers() {
  const raw = field("timerImportJson")?.value || "";
  if (!raw.trim()) {
    state.message = {
      text: "Paste exported timer JSON before importing.",
      tone: "warn",
    };
    render();
    return;
  }

  await runAction(
    "importTimers",
    async () => {
      const result = await api.importTimers(JSON.parse(raw));
      setTimerState(result);
      state.timerDraft = {};
      return result;
    },
    { skipRefresh: true, success: "Timers imported." },
  );
}

async function applyCommandPreset(id) {
  await runAction(
    "commandPreset",
    async () => {
      const result = await api.applyCommandPreset(id);
      setCommandState(result);
      state.selectedCommandId = result.command?.id ?? state.selectedCommandId;
      state.commandDraft = {};
      return result;
    },
    { skipRefresh: true, success: "Command preset created disabled." },
  );
}

async function applyCommandPresetPack(id) {
  await runAction(
    "commandPresetPack",
    async () => {
      const result = await api.applyCommandPresetPack(id);
      setCommandState(result);
      state.selectedCommandId =
        result.created?.[0]?.id ?? state.selectedCommandId;
      state.commandDraft = {};
      return result;
    },
    {
      skipRefresh: true,
      success: "Utility pack created ready commands disabled.",
    },
  );
}

function applyModerationSuggestion(id) {
  const suggestion = moderationSuggestions.find((item) => item.id === id);
  if (!suggestion) return;

  if (suggestion.type === "warning") {
    state.moderationDraft = {
      ...state.moderationDraft,
      moderationWarningMessage: suggestion.value,
    };
  } else if (suggestion.type === "blockedPhrase") {
    state.moderationTermDraft = {
      moderationTerm: suggestion.value,
      moderationTermEnabled: true,
    };
  } else if (suggestion.type === "blockedDomain") {
    state.moderationBlockedLinkDraft = {
      moderationBlockedDomain: suggestion.value,
      moderationBlockedDomainEnabled: true,
    };
  } else if (suggestion.type === "allowedDomain") {
    state.moderationAllowedLinkDraft = {
      moderationAllowedDomain: suggestion.value,
      moderationAllowedDomainEnabled: true,
    };
  }

  state.message = {
    text: "Moderation suggestion loaded into the matching editor. Test it before saving live rules.",
    tone: "ok",
  };
  render();

  const focusByType = {
    warning: "moderationWarningMessage",
    blockedPhrase: "moderationTerm",
    blockedDomain: "moderationBlockedDomain",
    allowedDomain: "moderationAllowedDomain",
  };
  field(focusByType[suggestion.type])?.focus();
}

async function copyModerationSuggestion(id) {
  const suggestion = moderationSuggestions.find((item) => item.id === id);
  if (!suggestion) return;
  await copyText(suggestion.value, "Moderation suggestion copied.");
}

async function saveModerationSettings() {
  await runAction(
    "saveModerationSettings",
    async () => {
      const result = await api.saveModerationSettings(
        readModerationSettingsPayload(),
      );
      setModerationState(result);
      state.moderationDraft = {};
      return result;
    },
    { skipRefresh: true, success: "Moderation settings saved." },
  );
}

async function saveModerationTerm() {
  await runAction(
    "saveModerationTerm",
    async () => {
      const result = await api.saveModerationTerm(readModerationTermPayload());
      setModerationState(result);
      state.moderationTermDraft = {};
      return result;
    },
    { skipRefresh: true, success: "Blocked phrase saved." },
  );
}

async function toggleModerationTerm(id, enabled) {
  await runAction(
    "moderationTermEnable",
    async () => {
      const result = await api.enableModerationTerm(id, enabled);
      setModerationState(result);
      return result;
    },
    {
      skipRefresh: true,
      success: enabled ? "Blocked phrase enabled." : "Blocked phrase disabled.",
    },
  );
}

async function deleteModerationTerm(id, term) {
  if (!confirm(`Delete blocked phrase "${term}"?`)) {
    return;
  }

  await runAction(
    "moderationTermDelete",
    async () => {
      const result = await api.deleteModerationTerm(id);
      setModerationState(result);
      return result;
    },
    { skipRefresh: true, success: "Blocked phrase deleted." },
  );
}

async function saveModerationAllowedLink() {
  await runAction(
    "saveModerationAllowedLink",
    async () => {
      const result = await api.saveModerationAllowedLink(
        readModerationAllowedLinkPayload(),
      );
      setModerationState(result);
      state.moderationAllowedLinkDraft = {};
      return result;
    },
    { skipRefresh: true, success: "Allowed domain saved." },
  );
}

async function toggleModerationAllowedLink(id, enabled) {
  await runAction(
    "moderationAllowedLinkEnable",
    async () => {
      const result = await api.enableModerationAllowedLink(id, enabled);
      setModerationState(result);
      return result;
    },
    {
      skipRefresh: true,
      success: enabled ? "Allowed domain enabled." : "Allowed domain disabled.",
    },
  );
}

async function deleteModerationAllowedLink(id, domain) {
  if (!confirm(`Delete allowed domain "${domain}"?`)) {
    return;
  }

  await runAction(
    "moderationAllowedLinkDelete",
    async () => {
      const result = await api.deleteModerationAllowedLink(id);
      setModerationState(result);
      return result;
    },
    { skipRefresh: true, success: "Allowed domain deleted." },
  );
}

async function saveModerationBlockedLink() {
  await runAction(
    "saveModerationBlockedLink",
    async () => {
      const result = await api.saveModerationBlockedLink(
        readModerationBlockedLinkPayload(),
      );
      setModerationState(result);
      state.moderationBlockedLinkDraft = {};
      return result;
    },
    { skipRefresh: true, success: "Blocked domain saved." },
  );
}

async function toggleModerationBlockedLink(id, enabled) {
  await runAction(
    "moderationBlockedLinkEnable",
    async () => {
      const result = await api.enableModerationBlockedLink(id, enabled);
      setModerationState(result);
      return result;
    },
    {
      skipRefresh: true,
      success: enabled ? "Blocked domain enabled." : "Blocked domain disabled.",
    },
  );
}

async function deleteModerationBlockedLink(id, domain) {
  if (!confirm(`Delete blocked domain "${domain}"?`)) {
    return;
  }

  await runAction(
    "moderationBlockedLinkDelete",
    async () => {
      const result = await api.deleteModerationBlockedLink(id);
      setModerationState(result);
      return result;
    },
    { skipRefresh: true, success: "Blocked domain deleted." },
  );
}

async function grantModerationLinkPermit() {
  await runAction(
    "grantModerationLinkPermit",
    async () => {
      const result = await api.grantModerationLinkPermit(
        readModerationPermitPayload(),
      );
      setModerationState(result);
      state.moderationPermitDraft = {};
      return result;
    },
    { skipRefresh: true, success: "Link permit granted." },
  );
}

async function runModerationTest() {
  await runAction(
    "runModerationTest",
    async () => {
      const result = await api.simulateModeration({
        actor: field("moderationTestActor")?.value || "viewer",
        role: field("moderationTestRole")?.value || "viewer",
        text: field("moderationTestText")?.value || "",
      });
      setModerationState(result);
      state.moderationTestResult = result;
      return result;
    },
    { skipRefresh: true, success: "Moderation test completed." },
  );
}

function newCustomCommand() {
  state.selectedCommandId = null;
  state.commandDraft = {
    commandName: "",
    commandPermission: "viewer",
    commandEnabled: true,
    commandGlobalCooldown: 30,
    commandUserCooldown: 10,
    commandAliases: "",
    commandResponses: "",
  };
  state.commandPreview = null;
  render();
}

function editCustomCommand(id) {
  const command = (state.commands || []).find(
    (item) => Number(item.id) === Number(id),
  );
  if (!command) return;
  state.selectedCommandId = command.id;
  state.commandDraft = {};
  state.commandPreview = null;
  render();
  field("commandName")?.focus();
}

async function saveCustomCommand() {
  await runAction(
    "saveCommand",
    async () => {
      const result = await api.saveCommand(readCommandPayload());
      setCommandState(result);
      state.selectedCommandId = result.command?.id ?? state.selectedCommandId;
      state.commandDraft = {};
      return result;
    },
    { skipRefresh: true, success: "Custom command saved." },
  );
}

async function toggleCustomCommand(id, enabled) {
  await runAction(
    "commandEnable",
    async () => {
      const result = await api.enableCommand(id, enabled);
      setCommandState(result);
      return result;
    },
    {
      skipRefresh: true,
      success: enabled ? "Custom command enabled." : "Custom command disabled.",
    },
  );
}

async function duplicateCustomCommand(id) {
  await runAction(
    "commandDuplicate",
    async () => {
      const result = await api.duplicateCommand(id);
      setCommandState(result);
      state.selectedCommandId = result.command?.id ?? null;
      state.commandDraft = {};
      return result;
    },
    { skipRefresh: true, success: "Custom command duplicated." },
  );
}

async function deleteCustomCommand(id, name) {
  if (
    !confirm(
      `Delete !${name}? Usage history remains in the audit log, but the command definition will be removed.`,
    )
  ) {
    return;
  }

  await runAction(
    "commandDelete",
    async () => {
      const result = await api.deleteCommand(id);
      setCommandState(result);
      state.selectedCommandId = null;
      state.commandDraft = {};
      return result;
    },
    { skipRefresh: true, success: "Custom command deleted." },
  );
}

async function previewCustomCommand() {
  await runAction(
    "previewCommand",
    async () => {
      const payload = readCommandPayload();
      const result = await api.previewCommand({
        commandId: payload.id,
        responseText:
          splitLines(field("commandResponses")?.value || "")[0] || "",
        actor: field("commandPreviewActor")?.value || "viewer",
        role: field("commandPreviewRole")?.value || "viewer",
        rawArgs: field("commandPreviewArgs")?.value || "target",
      });
      state.commandPreview = result;
      return result;
    },
    { skipRefresh: true, success: "Command preview rendered." },
  );
}

async function testCustomCommand() {
  await runAction(
    "testCustomCommand",
    async () => {
      const payload = readCommandPayload();
      const name = String(payload.name || "").replace(/^!/, "");
      const args = field("commandPreviewArgs")?.value || "";
      const result = await api.simulateCommand({
        actor: field("commandPreviewActor")?.value || "viewer",
        role: field("commandPreviewRole")?.value || "viewer",
        command: `!${name}${args ? ` ${args}` : ""}`,
      });
      state.testResult = result;
      return result;
    },
    { success: "Custom command test completed." },
  );
}
