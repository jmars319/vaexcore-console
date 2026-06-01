function normalizeLoginField(event) {
  const normalized = normalizeLoginInput(event.target.value);
  if (normalized === event.target.value) {
    return;
  }

  event.target.value = normalized;
  state.settingsDraft[event.target.id] = normalized;
}

function normalizeLoginInput(value) {
  const trimmed = value.trim().replace(/^@/, "");
  const maybeUrl = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^(www\.)?twitch\.tv\//i.test(trimmed)
      ? `https://${trimmed}`
      : null;

  if (!maybeUrl) {
    return trimmed.toLowerCase();
  }

  try {
    const parsed = new URL(maybeUrl);
    if (
      ["twitch.tv", "www.twitch.tv"].includes(parsed.hostname.toLowerCase())
    ) {
      return (
        parsed.pathname.split("/").filter(Boolean)[0] || ""
      ).toLowerCase();
    }
  } catch {
    return trimmed.toLowerCase();
  }

  return trimmed.toLowerCase();
}

function clearSavedCredentialMask(event) {
  const id = event.target.id;
  if (
    !["clientId", "clientSecret", "relayConsoleToken"].includes(id) ||
    event.target.value !== savedCredentialMask
  ) {
    return;
  }
  event.target.value = "";
  state.settingsDraft[id] = "";
}

function restoreSavedCredentialMask(event) {
  const id = event.target.id;
  if (!hasSavedCredential(id) || event.target.value !== "") {
    return;
  }
  delete state.settingsDraft[id];
  event.target.value = savedCredentialMask;
}

function readSettingsPayload() {
  return {
    mode: fieldValue("mode", state.config?.mode || "live"),
    setupMode: fieldValue(
      "setupMode",
      state.config?.setupMode || currentSetupMode(state.config),
    ),
    redirectUri: fieldValue(
      "redirectUri",
      state.config?.redirectUri || defaultRedirectUri,
    ),
    clientId: credentialFieldValue("clientId", state.config?.hasClientId),
    clientSecret: credentialFieldValue(
      "clientSecret",
      state.config?.hasClientSecret,
    ),
    broadcasterLogin: fieldValue(
      "broadcasterLogin",
      state.config?.broadcasterLogin || "",
    ),
    botLogin: fieldValue("botLogin", state.config?.botLogin || ""),
    twitchTransportMode: fieldValue(
      "twitchTransportMode",
      state.config?.relay?.twitchTransportMode || "local-user-token",
    ),
    relayBaseUrl: fieldValue(
      "relayBaseUrl",
      state.config?.relay?.baseUrl || "",
    ),
    relayInstallationId: fieldValue(
      "relayInstallationId",
      state.config?.relay?.installationId || "",
    ),
    relayConsoleToken: credentialFieldValue(
      "relayConsoleToken",
      state.config?.relay?.hasConsoleToken,
    ),
  };
}

function readDiscordConfigPayload() {
  const config = state.discord?.config || state.config?.discord || {};
  return {
    botToken: field("discordBotToken")?.value || "",
    guildId: field("discordGuildId")?.value || config.guildId || "",
    streamAnnouncementChannelId:
      field("discordStreamAnnouncementChannelId")?.value ||
      config.streamAnnouncementChannelId ||
      "",
    generalAnnouncementChannelId:
      field("discordGeneralAnnouncementChannelId")?.value ||
      config.generalAnnouncementChannelId ||
      "",
    streamAlertsRoleId:
      field("discordStreamAlertsRoleId")?.value ||
      config.streamAlertsRoleId ||
      "",
    operatorRoleId:
      field("discordOperatorRoleId")?.value || config.operatorRoleId || "",
    staffRoleId: field("discordStaffRoleId")?.value || config.staffRoleId || "",
    lockStaffCategory: Boolean(field("discordLockStaffCategory")?.checked),
    setupTemplateId:
      field("discordSetupTemplateId")?.value || config.setupTemplateId || "",
  };
}

function readDiscordAnnouncementPayload() {
  return {
    kind: field("discordAnnouncementKind")?.value || "live",
    title: field("discordAnnouncementTitle")?.value || "",
    detail: field("discordAnnouncementDetail")?.value || "",
    streamUrl: field("discordAnnouncementStreamUrl")?.value || "",
    scheduledFor: field("discordAnnouncementScheduledFor")?.value || "",
    mentionRole: Boolean(field("discordMentionRole")?.checked),
  };
}

function readCommandPayload() {
  const selected = selectedCustomCommand();
  return {
    id: selected?.id,
    name: field("commandName")?.value || "",
    permission: field("commandPermission")?.value || "viewer",
    enabled: Boolean(field("commandEnabled")?.checked),
    globalCooldownSeconds: Number(field("commandGlobalCooldown")?.value || 0),
    userCooldownSeconds: Number(field("commandUserCooldown")?.value || 0),
    aliases: splitLinesAndCommas(field("commandAliases")?.value || ""),
    responses: splitLines(field("commandResponses")?.value || ""),
  };
}

function readTimerPayload() {
  const selected = selectedTimer();
  return {
    id: selected?.id,
    name: field("timerName")?.value || "",
    intervalMinutes: Number(field("timerInterval")?.value || 5),
    minChatMessages: Number(field("timerMinChatMessages")?.value || 0),
    enabled: Boolean(field("timerEnabled")?.checked),
    message: field("timerMessage")?.value || "",
  };
}

function readModerationSettingsPayload() {
  return {
    blockedTermsEnabled: Boolean(field("blockedTermsEnabled")?.checked),
    linkFilterEnabled: Boolean(field("linkFilterEnabled")?.checked),
    capsFilterEnabled: Boolean(field("capsFilterEnabled")?.checked),
    repeatFilterEnabled: Boolean(field("repeatFilterEnabled")?.checked),
    symbolFilterEnabled: Boolean(field("symbolFilterEnabled")?.checked),
    botShieldEnabled: Boolean(field("botShieldEnabled")?.checked),
    blockedTermsAction: field("blockedTermsAction")?.value || "warn",
    linkFilterAction: field("linkFilterAction")?.value || "warn",
    capsFilterAction: field("capsFilterAction")?.value || "warn",
    repeatFilterAction: field("repeatFilterAction")?.value || "warn",
    symbolFilterAction: field("symbolFilterAction")?.value || "warn",
    botShieldAction: field("botShieldAction")?.value || "delete",
    botShieldScoreThreshold: Number(
      field("botShieldScoreThreshold")?.value || 70,
    ),
    timeoutSeconds: Number(field("timeoutSeconds")?.value || 60),
    warningMessage: field("moderationWarningMessage")?.value || "",
    capsMinLength: Number(field("capsMinLength")?.value || 20),
    capsRatio: Number(field("capsRatio")?.value || 0.75),
    repeatLimit: Number(field("repeatLimit")?.value || 3),
    repeatWindowSeconds: Number(field("repeatWindowSeconds")?.value || 30),
    symbolMinLength: Number(field("symbolMinLength")?.value || 12),
    symbolRatio: Number(field("symbolRatio")?.value || 0.6),
    escalationEnabled: Boolean(field("escalationEnabled")?.checked),
    escalationWindowSeconds: Number(
      field("escalationWindowSeconds")?.value || 300,
    ),
    escalationDeleteAfter: Number(field("escalationDeleteAfter")?.value || 2),
    escalationTimeoutAfter: Number(field("escalationTimeoutAfter")?.value || 3),
    exemptBroadcaster: Boolean(field("exemptBroadcaster")?.checked),
    exemptModerators: Boolean(field("exemptModerators")?.checked),
    exemptVips: Boolean(field("exemptVips")?.checked),
    exemptSubscribers: Boolean(field("exemptSubscribers")?.checked),
  };
}

function readModerationTermPayload() {
  return {
    term: field("moderationTerm")?.value || "",
    enabled: Boolean(field("moderationTermEnabled")?.checked),
  };
}

function readModerationAllowedLinkPayload() {
  return {
    domain: field("moderationAllowedDomain")?.value || "",
    enabled: Boolean(field("moderationAllowedDomainEnabled")?.checked),
  };
}

function readModerationBlockedLinkPayload() {
  return {
    domain: field("moderationBlockedDomain")?.value || "",
    enabled: Boolean(field("moderationBlockedDomainEnabled")?.checked),
  };
}

function readModerationPermitPayload() {
  return {
    userLogin: field("moderationPermitUser")?.value || "",
    minutes: Number(field("moderationPermitMinutes")?.value || 5),
  };
}

function readTemplatePayload() {
  const payload = {};

  for (const template of state.templates || []) {
    const id = `template-${template.action}`;
    payload[template.action] = templateValue(
      template.action,
      template.template || "",
    );
    if (field(id)) {
      payload[template.action] = field(id).value;
    }
  }

  return payload;
}

function splitLines(value) {
  return value
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitLinesAndCommas(value) {
  return value
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readOperatorTemplatePayload() {
  const payload = {};

  for (const template of state.operatorMessages || []) {
    const id = `operator-template-${template.id}`;
    payload[template.id] = operatorTemplateValue(
      template.id,
      template.template || "",
    );
    if (field(id)) {
      payload[template.id] = field(id).value;
    }
  }

  return payload;
}

async function validateSetup() {
  await runAction(
    "validate",
    async () => {
      const result = await api.validate();
      state.validSetup = Boolean(result.ok);
      state.validationChecks = result.checks || [];
      return result;
    },
    { skipRefresh: true, success: "Validation completed." },
  );
  await refreshAll();
}

async function sendSetupTest() {
  const result = await runAction("test", () => api.testSend(), {
    success: "Test message sent.",
  });
  if (result?.ok) {
    state.testMessageSent = true;
    render();
  }
}

async function startBot() {
  await runAction(
    "botStart",
    async () => {
      const result = await api.botStart();
      if (result?.checks) {
        state.preflightResult = {
          ok: Boolean(result.ok),
          checks: result.checks,
          nextAction: result.nextAction || result.error || "",
          summary: state.giveaway?.summary || {},
        };
      }
      if (result?.diagnostics) {
        state.diagnostics = result.diagnostics;
      }
      return result;
    },
    { success: "Bot process starting." },
  );
}

async function stopBot() {
  await runAction("botStop", () => api.botStop(), {
    success: "Bot process stopped.",
  });
}

async function runPreflight() {
  await runAction(
    "runPreflight",
    async () => {
      const result = await api.preflight();
      state.preflightResult = result;
      return { ok: true };
    },
    { success: "Preflight completed." },
  );
}

async function runLaunchPreparation() {
  await runAction(
    "launchPreparation",
    async () => {
      const result = await api.runLaunchPreparation();
      syncLaunchPreparation(result);
      return { ok: true };
    },
    { skipRefresh: true, success: "Launch checks completed." },
  );
  await refreshAll();
}

async function launchSuite() {
  await runAction(
    "launchSuite",
    async () => {
      const result = await api.launchSuite();
      if (!result.ok) {
        throw new Error(formatSuiteLaunchFailure(result.results || []));
      }
      return { ok: true };
    },
    {
      skipRefresh: true,
      success: "Launch requested for Studio, Pulse, and Console.",
    },
  );
  await refreshAll();
}

function formatSuiteLaunchFailure(results) {
  const appNames = results
    .filter((result) => !result.ok)
    .map((result) => result.appName)
    .join(", ");
  return appNames
    ? `Could not launch ${appNames}. Install the app bundles in Applications, then try again.`
    : "Unable to launch the vaexcore suite.";
}

function suiteStatusTone(app) {
  if (!app.installed) return "bad";
  if (!app.running) return "muted";
  if (app.stale || !app.reachable) return "warn";
  return "ok";
}

function suiteStatusLabel(app) {
  if (!app.installed) return "missing";
  if (!app.running) return "offline";
  if (app.stale) return "stale";
  if (!app.reachable) return "starting";
  return "ready";
}

function formatTimelineTimestamp(value) {
  if (/^\d+$/.test(String(value))) {
    return new Date(Number(value) * 1000).toLocaleTimeString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleTimeString();
}

function openSettingsWindow(fragment = "") {
  window.open(
    `/?window=settings${fragment}`,
    "vaexcore-settings",
    "width=980,height=760",
  );
}

function openSetupGuide() {
  if (!isSettingsWindow) {
    openSettingsWindow("#setupGuide");
    return;
  }

  state.activeTab = "settings";
  render();
  document.getElementById("setupGuide")?.scrollIntoView({ block: "start" });
}

function openLiveMode() {
  state.activeTab = "live-mode";
  render();
}

function openGiveaways() {
  state.activeTab = "giveaways";
  render();
}

function openDiagnostics() {
  state.activeTab = "diagnostics";
  render();
}

async function saveTemplates() {
  await runAction(
    "saveTemplates",
    async () => {
      const result = await api.saveTemplates(readTemplatePayload());
      state.templates = result.templates || [];
      state.templateDraft = {};
      return result;
    },
    { skipRefresh: true, success: "Templates saved." },
  );
}

async function resetTemplates() {
  if (!confirm("Reset giveaway message templates to defaults?")) {
    return;
  }

  await runAction(
    "resetTemplates",
    async () => {
      const result = await api.resetTemplates();
      state.templates = result.templates || [];
      state.templateDraft = {};
      return result;
    },
    { skipRefresh: true, success: "Templates reset." },
  );
}
