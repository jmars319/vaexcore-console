const windowParams = new URLSearchParams(window.location.search);
const isSettingsWindow = windowParams.get("window") === "settings";
const isWindowsSetupPrompt =
  isSettingsWindow && windowParams.get("setupPrompt") === "windows";
const requestedTab = windowParams.get("tab");

document.body.classList.toggle("settings-window", isSettingsWindow);

const mainTabs = [
  ["dashboard", "Live Ops"],
  ["live-mode", "Stream Control"],
  ["commands", "Commands"],
  ["timers", "Timers"],
  ["moderation", "Moderation"],
  ["giveaways", "Giveaways"],
  ["chat-tools", "Operator Tools"],
  ["twitch-ops", "Twitch Ops"],
  ["discord", "Discord"],
  ["suite", "Suite"],
  ["testing", "Testing"],
  ["diagnostics", "Diagnostics"],
  ["audit-log", "Post-Stream Log"],
];

const tabs = isSettingsWindow ? [["settings", "Settings"]] : mainTabs;

const state = {
  activeTab: isSettingsWindow
    ? "settings"
    : mainTabs.some(([id]) => id === requestedTab)
      ? requestedTab
      : "dashboard",
  config: null,
  status: null,
  giveaway: null,
  commands: [],
  commandHistory: [],
  commandSummary: { total: 0, enabled: 0, disabled: 0, aliases: 0, uses: 0 },
  commandReservedNames: [],
  commandPresets: [],
  commandPresetPacks: [],
  commandFeatureGate: null,
  timers: [],
  timerSummary: {
    total: 0,
    enabled: 0,
    disabled: 0,
    sent: 0,
    waitingForActivity: 0,
  },
  timerFeatureGate: null,
  timerReadiness: { ok: false, reason: "" },
  timerPresets: [],
  moderation: null,
  moderationTerms: [],
  moderationAllowedLinks: [],
  moderationBlockedLinks: [],
  moderationLinkPermits: [],
  moderationHits: [],
  moderationSummary: {
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
  },
  moderationEnforcement: null,
  moderationFeatureGate: null,
  streamPresets: [],
  suiteStatus: null,
  twitchOps: null,
  twitchOpsDraft: {},
  relayStatus: null,
  relayEvents: [],
  relayEventSubResult: null,
  relayTestSendResult: null,
  botCompletion: null,
  botRehearsal: null,
  localRehearsal: null,
  botSupportBundle: null,
  discord: null,
  discordRoles: [],
  discordRolesStatus: null,
  discordSetupPreview: null,
  discordRelaySuggestions: [],
  discordRelayEvents: [],
  discordRelayActions: [],
  discordRelayActionFilter: "active",
  featureGates: [],
  templates: [],
  operatorMessages: [],
  reminder: null,
  launchPreparation: null,
  preflightResult: null,
  diagnostics: null,
  auditLogs: [],
  outboundMessages: [],
  outboundSummary: {
    total: 0,
    queued: 0,
    failed: 0,
    criticalFailed: 0,
    sent: 0,
  },
  validSetup: false,
  busy: new Set(),
  entrantFilter: "",
  winnerFilter: "all",
  commandFilter: "",
  selectedCommandId: null,
  selectedTimerId: null,
  message: { text: "", tone: "muted" },
  testResult: null,
  commandPreview: null,
  validationChecks: [],
  testMessageSent: false,
  settingsDraft: {},
  commandDraft: {},
  timerDraft: {},
  moderationDraft: {},
  moderationTermDraft: {},
  moderationAllowedLinkDraft: {},
  moderationBlockedLinkDraft: {},
  moderationPermitDraft: {},
  moderationTestResult: null,
  giveawayDraft: {},
  templateDraft: {},
  operatorTemplateDraft: {},
  discordDraft: {},
  reminderDraft: {},
  oauthNotice: readOAuthNotice(),
  operatorRole: readOperatorRole(),
};

const defaultRedirectUri = "http://localhost:3434/auth/twitch/callback";
const savedCredentialMask = "saved and masked";

const timerSuggestions = [
  {
    id: "schedule",
    useCase: "Schedule reminder",
    name: "Schedule reminder",
    intervalMinutes: 30,
    minChatMessages: 10,
    message: "Follow the channel for schedule updates and stream notices.",
  },
  {
    id: "discord",
    useCase: "Community link",
    name: "Discord reminder",
    intervalMinutes: 45,
    minChatMessages: 12,
    message:
      "Join the Discord for stream alerts and support: https://example.com",
  },
  {
    id: "giveaway",
    useCase: "Giveaway pacing",
    name: "Giveaway reminder",
    intervalMinutes: 20,
    minChatMessages: 8,
    message:
      "Giveaway reminders appear here first. Keep chat open and watch for the next entry keyword.",
  },
  {
    id: "help",
    useCase: "Support prompt",
    name: "Help reminder",
    intervalMinutes: 60,
    minChatMessages: 15,
    message:
      "Need help? Mods can answer setup questions, and channel rules are in the panels below.",
  },
];

const moderationSuggestions = [
  {
    id: "warning-copy",
    useCase: "General warning copy",
    target: "Warning message",
    type: "warning",
    value: "@{user}, please keep chat readable and within channel guidelines.",
  },
  {
    id: "spam-phrase",
    useCase: "Common spam phrase",
    target: "Blocked phrase",
    type: "blockedPhrase",
    value: "buy followers",
  },
  {
    id: "giveaway-scam",
    useCase: "Fake giveaway wording",
    target: "Blocked phrase",
    type: "blockedPhrase",
    value: "claim prize now",
  },
  {
    id: "shortener-domain",
    useCase: "Shortener review",
    target: "Blocked domain",
    type: "blockedDomain",
    value: "bit.ly",
  },
  {
    id: "official-domain",
    useCase: "Known safe link",
    target: "Allowed domain",
    type: "allowedDomain",
    value: "discord.gg",
  },
];

function readOAuthNotice() {
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");

  if (error) {
    if (error === "wrong_bot_account") {
      const connected =
        params.get("connected_login") || "the current Twitch account";
      const expected =
        params.get("expected_login") || "the configured Bot Login";
      return {
        tone: "bad",
        text: `Twitch authorized ${connected}, but Bot Login is ${expected}. Log into Twitch as the Bot Login account (${expected}), then click Connect Twitch as Bot Login again.`,
      };
    }

    return { tone: "bad", text: oauthErrorMessage(error) };
  }

  if (params.get("connected") === "1") {
    return {
      tone: "ok",
      text: "Twitch authorization completed. Launch checks will validate it automatically.",
    };
  }

  return undefined;
}

function readOperatorRole() {
  try {
    const stored = window.localStorage?.getItem("vaexcore.operatorRole");
    return ["owner", "admin", "moderator", "viewer"].includes(stored)
      ? stored
      : "owner";
  } catch {
    return "owner";
  }
}

function oauthErrorMessage(error) {
  const messages = {
    access_denied:
      "Twitch authorization was cancelled before vaexcore console was connected.",
    invalid_client_secret:
      "Twitch rejected the saved Client Secret. Generate or copy a fresh Client Secret in the Twitch Developer Console, paste it here, save settings, then click Connect Twitch as Bot Login again.",
    invalid_client_credentials:
      "Twitch rejected the saved Client ID or Client Secret. Check both app credentials, save settings, then click Connect Twitch as Bot Login again.",
    missing_client_credentials:
      "Save the Twitch Client ID and Client Secret before connecting Twitch.",
    invalid_oauth_state:
      "Twitch authorization expired or did not match this session. Click Connect Twitch as Bot Login again.",
    oauth_exchange_failed:
      "Twitch did not complete the authorization exchange. Check the saved Twitch app credentials and try Connect Twitch as Bot Login again.",
    oauth_token_validation_failed:
      "Twitch returned a token, but vaexcore console could not validate it. Disconnect Twitch and connect again.",
    redirect_uri_mismatch: `Twitch rejected the redirect URL. In the Twitch Developer Console, set the OAuth Redirect URL to ${defaultRedirectUri}.`,
  };

  return messages[error] || `Twitch authorization failed: ${error}`;
}

const api = {
  get: (url) => request(url),
  post: (url, body = {}) =>
    request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  config: () => api.get("/api/config"),
  saveConfig: (body) => api.post("/api/config", body),
  saveSetupMode: (setupMode) => api.post("/api/setup-mode", { setupMode }),
  checkSetupMode: (mode) => api.post("/api/setup-mode/check", { mode }),
  disconnectTwitch: () => api.post("/api/auth/twitch/disconnect"),
  validate: () => api.post("/api/validate"),
  testSend: () => api.post("/api/test-send"),
  status: () => api.get("/api/status"),
  launchPreparation: () => api.get("/api/launch-preparation"),
  runLaunchPreparation: () => api.post("/api/launch-preparation"),
  launchSuite: () => api.post("/api/launch-suite"),
  suiteStatus: () => api.get("/api/suite/status"),
  twitchCreatorOps: () => api.get("/api/twitch/creator-ops"),
  runTwitchCreatorOp: (action, body) =>
    api.post(`/api/twitch/creator-ops/${action}`, body),
  relayStatus: () => api.get("/api/relay/status"),
  relayEvents: (limit = 25) =>
    api.get(`/api/relay/events?limit=${encodeURIComponent(String(limit))}`),
  connectHostedRelay: (body = {}) =>
    api.post("/api/relay/hosted/connect", body),
  registerRelayEventSub: () => api.post("/api/relay/eventsub/register"),
  relayTestSend: () => api.post("/api/relay/test-send"),
  discordStatus: (validate = false) =>
    api.get(`/api/discord/status${validate ? "?validate=1" : ""}`),
  saveDiscordConfig: (body) => api.post("/api/discord/config", body),
  discordRoles: () => api.get("/api/discord/roles"),
  previewDiscordSetup: (body) => api.post("/api/discord/setup/preview", body),
  applyDiscordSetup: (body) => api.post("/api/discord/setup/apply", body),
  sendDiscordAnnouncement: (body) => api.post("/api/discord/announce", body),
  discordRelayStatus: () => api.get("/api/discord/relay/status"),
  discordRelayInstallStart: () =>
    api.post("/api/discord/relay/install/start", {}),
  previewDiscordRelaySetup: (body) =>
    api.post("/api/discord/relay/setup/preview", body),
  applyDiscordRelaySetup: (body) =>
    api.post("/api/discord/relay/setup/apply", body),
  registerDiscordRelayCommands: () =>
    api.post("/api/discord/relay/commands/register"),
  discordRelaySuggestions: (status = "") =>
    api.get(
      `/api/discord/relay/suggestions${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ),
  updateDiscordRelaySuggestion: (id, status) =>
    api.post("/api/discord/relay/suggestions/status", { id, status }),
  discordRelayEvents: () => api.get("/api/discord/relay/events"),
  discordRelayActions: (status = "active") =>
    api.get(`/api/discord/relay/actions?status=${encodeURIComponent(status)}`),
  updateDiscordRelayAction: (id, status) =>
    api.post("/api/discord/relay/actions/status", { id, status }),
  markRelayChatbotIdentityValidated: (body) =>
    api.post("/api/relay/chatbot-identity/validation", body),
  botCompletion: () => api.get("/api/bot/completion"),
  recordBotValidation: (key, confirmed = true) =>
    api.post("/api/bot/validation-record", { key, confirmed }),
  botSupportBundle: () => api.get("/api/bot/support-bundle"),
  runBotRehearsal: () => api.post("/api/bot/rehearsal/run"),
  runFullLocalRehearsal: () => api.post("/api/local-rehearsal/run"),
  diagnostics: () => api.get("/api/diagnostics"),
  supportBundle: () => api.get("/api/support-bundle"),
  featureGates: () => api.get("/api/feature-gates"),
  setFeatureGate: (key, mode) => api.post("/api/feature-gates", { key, mode }),
  streamPresets: () => api.get("/api/stream-presets"),
  applyStreamPreset: (id, confirmed = false) =>
    api.post("/api/stream-presets/apply", { id, confirmed }),
  preflight: () => api.post("/api/preflight"),
  botStart: () => api.post("/api/bot/start"),
  botStop: () => api.post("/api/bot/stop"),
  giveaway: () => api.get("/api/giveaway"),
  giveawayExport: () => api.get("/api/giveaway/export"),
  templates: () => api.get("/api/giveaway/templates"),
  saveTemplates: (templates) =>
    api.post("/api/giveaway/templates", { templates }),
  resetTemplates: () => api.post("/api/giveaway/templates/reset"),
  reminder: () => api.get("/api/giveaway/reminder"),
  saveReminder: (body) => api.post("/api/giveaway/reminder", body),
  sendReminder: () => api.post("/api/giveaway/reminder/send"),
  auditLogs: () => api.get("/api/audit-logs"),
  outboundMessages: () => api.get("/api/outbound-messages"),
  resendOutboundMessage: (id) =>
    api.post("/api/outbound-messages/resend", id ? { id } : {}),
  resendGiveawayAnnouncement: (action) =>
    api.post("/api/giveaway/announcement/resend", { action }),
  resendCriticalGiveaway: () => api.post("/api/giveaway/critical/resend"),
  sendGiveawayStatus: () => api.post("/api/giveaway/status/send"),
  chatSend: (message) => api.post("/api/chat/send", { message }),
  operatorMessages: () => api.get("/api/operator-messages"),
  saveOperatorMessages: (templates) =>
    api.post("/api/operator-messages", { templates }),
  resetOperatorMessages: () => api.post("/api/operator-messages/reset"),
  sendOperatorMessage: (id, confirmed = false) =>
    api.post("/api/operator-messages/send", { id, confirmed }),
  exportBotConfig: () => api.get("/api/bot-config/export"),
  importBotConfig: (body) => api.post("/api/bot-config/import", body),
  commands: () => api.get("/api/commands"),
  saveCommand: (body) => api.post("/api/commands", body),
  enableCommand: (id, enabled) =>
    api.post("/api/commands/enable", { id, enabled }),
  duplicateCommand: (id) => api.post("/api/commands/duplicate", { id }),
  deleteCommand: (id) => api.post("/api/commands/delete", { id }),
  exportCommands: () => api.get("/api/commands/export"),
  importCommands: (body) => api.post("/api/commands/import", body),
  applyCommandPreset: (id) => api.post("/api/commands/preset", { id }),
  applyCommandPresetPack: (id) => api.post("/api/commands/preset-pack", { id }),
  previewCommand: (body) => api.post("/api/commands/preview", body),
  timers: () => api.get("/api/timers"),
  exportTimers: () => api.get("/api/timers/export"),
  saveTimer: (body) => api.post("/api/timers", body),
  importTimers: (body) => api.post("/api/timers/import", body),
  applyTimerPreset: (id) => api.post("/api/timers/preset", { id }),
  enableTimer: (id, enabled) => api.post("/api/timers/enable", { id, enabled }),
  deleteTimer: (id) => api.post("/api/timers/delete", { id }),
  sendTimerNow: (id) => api.post("/api/timers/send-now", { id }),
  moderation: () => api.get("/api/moderation"),
  saveModerationSettings: (body) => api.post("/api/moderation/settings", body),
  saveModerationTerm: (body) => api.post("/api/moderation/terms", body),
  enableModerationTerm: (id, enabled) =>
    api.post("/api/moderation/terms/enable", { id, enabled }),
  deleteModerationTerm: (id) =>
    api.post("/api/moderation/terms/delete", { id }),
  saveModerationAllowedLink: (body) =>
    api.post("/api/moderation/allowed-links", body),
  enableModerationAllowedLink: (id, enabled) =>
    api.post("/api/moderation/allowed-links/enable", { id, enabled }),
  deleteModerationAllowedLink: (id) =>
    api.post("/api/moderation/allowed-links/delete", { id }),
  saveModerationBlockedLink: (body) =>
    api.post("/api/moderation/blocked-links", body),
  enableModerationBlockedLink: (id, enabled) =>
    api.post("/api/moderation/blocked-links/enable", { id, enabled }),
  deleteModerationBlockedLink: (id) =>
    api.post("/api/moderation/blocked-links/delete", { id }),
  grantModerationLinkPermit: (body) =>
    api.post("/api/moderation/link-permits", body),
  simulateModeration: (body) => api.post("/api/moderation/simulate", body),
  giveawayAction: (name, body = {}) =>
    api.post(`/api/giveaway/${name}`, withEcho(body)),
  simulateCommand: (body) => api.post("/api/command/simulate", withEcho(body)),
};

async function request(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || `Request failed: ${response.status}`);
  }

  return body;
}

function withEcho(body = {}) {
  return { ...body, echoToChat: Boolean(field("echoToChat")?.checked) };
}

const app = document.getElementById("app");
const backgroundRefreshMs = 5000;
const renderIdleDelayMs = 900;
const interactionQuietMs = 1400;
const scrollPositions = {};
const keyedScrollPositions = {};
const disclosureStates = {};
let deferredRenderTimer = null;
let lastUserInteractionAt = 0;
let backgroundRefreshPromise = null;
let foregroundRefreshGeneration = 0;
let lastBackgroundError = "";
function h(tag, attributes = {}, children = []) {
  const element = document.createElement(tag);

  for (const [key, value] of Object.entries(attributes)) {
    if (value === false || value === undefined || value === null) {
      continue;
    }

    if (key === "className") {
      element.className = value;
    } else if (key === "text") {
      element.textContent = value;
    } else if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      element.setAttribute(key, String(value));
    }
  }

  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === undefined || child === null) {
      continue;
    }
    element.append(
      child.nodeType ? child : document.createTextNode(String(child)),
    );
  }

  return element;
}
