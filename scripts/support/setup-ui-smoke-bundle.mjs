const requiredUiNeedles = [
  ["Dashboard", "browser UI has dashboard tab"],
  ["Giveaways", "browser UI has giveaways tab"],
  ["Setup Mode", "settings UI has setup mode selector"],
  ["setup-mode-selector", "setup mode selector is segmented"],
  ["header-mode-selector", "main header includes compact mode selector"],
  ["Hosted", "settings UI includes Hosted mode"],
  ["Assisted", "settings UI includes Assisted mode"],
  ["Local", "settings UI includes Local mode"],
  ["api.saveSetupMode", "mode-only route persists setup mode"],
  [
    "Hosted uses Relay-managed Twitch and Discord service credentials.",
    "Hosted mode explanation is available as compact tooltip copy",
  ],
  ["Advanced Relay Transport Details", "Assisted mode has relay controls"],
  ["Local OAuth Fallback", "Assisted mode has local OAuth fallback controls"],
  ["Twitch Configuration", "Local mode has Twitch configuration controls"],
  ["Twitch Creator Ops", "browser UI exposes Twitch creator ops"],
  ["Start raid", "browser UI exposes raid controls"],
  ["Command Library", "browser UI exposes command library"],
  ["Response variants", "custom command editor supports response variants"],
  ["Utility Packs", "custom command UI exposes utility packs"],
  ["Starter Commands", "custom command UI exposes starter presets"],
  ["Export commands JSON", "custom command UI can export commands"],
  ["Import commands JSON", "custom command UI can import commands"],
  ["Preview response", "custom command UI can preview responses"],
  ["Feature Gate", "browser UI exposes feature gates"],
  ["setFeatureGate", "browser UI can update feature gates"],
  ["Schedule local stream messages", "browser UI exposes timers"],
  ["Save timer", "browser UI can save timers"],
  ["Preset Starters", "browser UI exposes timer presets"],
  ["Timer Suggestions", "timer UI exposes optional starter suggestions"],
  ["Export timers JSON", "browser UI can export timers"],
  [
    "scoped warn, delete, and timeout actions",
    "browser UI exposes moderation filters",
  ],
  ["Moderation Suggestions", "moderation UI exposes optional examples"],
  ["Run moderation test", "browser UI can test moderation filters"],
  ["Allowed Link Domains", "browser UI exposes link allowlist"],
  ["Blocked Link Domains", "browser UI exposes link blocklist"],
  ["Temporary Link Permits", "browser UI exposes moderation permits"],
  ["Escalation", "browser UI exposes escalation settings"],
  ["Bot Shield", "browser UI exposes bot shield settings"],
  ["Setup Guide", "setup guide renders from UI bundle"],
  ["Open Twitch Developer Console", "setup guide includes Twitch link"],
  ["settingsActionButton", "main UI exposes compact settings launcher"],
  ["openSettingsWindow", "settings launcher opens settings window"],
  ["width=980,height=760", "settings launcher requests expected size"],
  ["Run setup health checks", "dashboard exposes setup health checks"],
  ["Run Operations Check", "dashboard exposes operations check"],
  ["Check provider setup", "dashboard exposes provider setup check"],
  ["Staff role picker", "Discord setup exposes role picker"],
  ["Load roles", "Discord setup can load roles"],
  ["Twitch authorization failed", "setup guide surfaces OAuth errors"],
  ["invalid_client_secret", "setup guide explains invalid client secret"],
  ["const savedCredentialMask", "settings UI masks credentials"],
  ["missingCredentialLabels", "setup guide names missing credentials"],
  ["normalizeLoginInput", "settings UI normalizes Twitch logins"],
  [
    "Bot Login must be the account that grants OAuth",
    "setup guide explains bot OAuth identity",
  ],
  ["Connect Twitch as Bot Login", "connect action names OAuth account type"],
  ["not the Broadcaster Login", "connect guidance distinguishes accounts"],
  ['"data-action": "connect-twitch"', "connect action has stable marker"],
  ["Disconnect Twitch", "settings UI can clear Twitch OAuth token"],
  ["Start Bot", "setup UI exposes bot start control"],
  ["Stop Bot", "setup UI exposes bot stop control"],
  ["refreshAll({ background: true })", "setup UI polls in background"],
  ["backgroundRefreshPromise", "background refresh is separated"],
  ["fetchFreshState", "background refresh can fetch state"],
  ["applyFreshState", "background refresh can apply state"],
  ["foregroundRefreshGeneration", "refresh results are generation guarded"],
  ["hasActiveTextSelection", "selected text defers render"],
  ["restoreScrollPosition", "setup UI restores scroll position"],
  ["keyedScrollPositions", "setup UI tracks nested scroll positions"],
  ['data-scroll-key": "discord-plan"', "Discord plan scroll key is stable"],
  [
    "Saved Client ID and Client Secret are intentionally not shown",
    "settings UI explains masked credentials",
  ],
  ["Refresh Token", "settings UI reports refresh-token availability"],
  ["giveawayDraft", "giveaway form uses draft state"],
  ["updateGiveawayDraft", "giveaway edits survive polling"],
  ["Outbound Chat History", "setup UI exposes outbound history"],
  ["Resend last failed", "setup UI exposes failed resend"],
  ["Send last call", "setup UI exposes last-call action"],
  ["Giveaway Chat Assurance", "giveaway tab exposes assurance state"],
  ["Critical Failed", "giveaway tab highlights critical failures"],
  ["Critical Confirmed", "giveaway tab distinguishes confirmations"],
  ["Queue ID", "giveaway tab exposes queue IDs"],
  ["pendingCritical", "giveaway tab blocks on pending critical sends"],
  ["Message Templates", "giveaway tab exposes message templates"],
  ["Reminder Controls", "giveaway tab exposes reminder controls"],
  ["Post-Giveaway Recap", "giveaway tab exposes recap"],
  ["Run preflight", "dashboard exposes preflight rehearsal"],
  ["Automatic Launch Preparation", "dashboard exposes launch preparation"],
  ["Rerun launch checks", "dashboard can rerun launch checks"],
  ["Start Here", "dashboard leads with startup flow"],
  ["dashboard-steps", "dashboard uses condensed step layout"],
  ["Giveaway Snapshot", "dashboard summarizes giveaway state"],
  ["visibleValidationChecks", "settings renders launch validation failures"],
  ["api.launchPreparation()", "settings refreshes launch preparation"],
  ["renderSettingsLaunchNotice", "settings surfaces launch notice"],
  ["desktopDistributionLabel", "diagnostics copy adapts to platform"],
  ["desktopUpdateMethod", "diagnostics update method adapts to platform"],
  ["Copy winners", "winner workflow can copy winners"],
  ["Mark all delivered", "winner workflow can bulk mark delivery"],
  ["phase-resend", "giveaway tab exposes phase resend controls"],
  [
    "shouldWarnBeforeGiveawayAction",
    "giveaway actions warn after critical gaps",
  ],
  ["Live Mode", "setup UI exposes compact live mode tab"],
  ["Stream Night Presets", "setup UI exposes stream-night presets"],
  ["Live Runbook", "dashboard and live mode expose runbook guidance"],
  ["Copy incident note", "runbook can copy incident note"],
  ["liveRunbookSteps", "runbook derives next actions"],
  ["Post-Stream Review", "audit log exposes post-stream review"],
  ["Export review JSON", "post-stream review can export JSON"],
  ["postStreamReviewData", "post-stream review derives local runtime data"],
  ["Send status to chat", "live mode can send giveaway status"],
  ["Panic Resend", "live mode exposes panic resend area"],
  ["Post-Stream Recap", "live mode exposes post-stream recap"],
  ["Outbound Failure Logs", "runtime highlights outbound failures"],
  ["Queue Health", "live mode exposes outbound queue health"],
  ["Recovery Checklist", "live mode exposes recovery checklist"],
  ["Oldest Age", "queue health shows pending message age"],
  ["Retry Delay", "queue health shows retry delay"],
  ["Send Throttle", "queue health shows send throttle"],
  ["Safe To Resend", "recovery checklist explains resend safety"],
  ["Operator Macros", "chat tools expose operator macros"],
  ["Requires confirmation", "operator presets identify high-impact sends"],
  ["Bot Config Backup", "chat tools expose safe bot config backup"],
  ["Export safe bot config", "chat tools can export safe bot config"],
  ["Import safe bot config", "chat tools can import safe bot config"],
  ["Diagnostics", "setup UI exposes diagnostics tab"],
  ["Copy diagnostic report", "diagnostics report can be copied"],
  ["Copy support bundle", "diagnostics tab can copy support bundle"],
  ["First Run And Recovery", "diagnostics tab exposes first-run recovery"],
];

const forbiddenUiNeedles = [
  [
    "Hosted setup keeps Twitch and Discord service secrets",
    "main dashboard no longer carries long Hosted copy",
  ],
  [
    "Hosted Relay setup connects Discord without exposing",
    "Discord tab no longer carries long Hosted copy",
  ],
  [
    "await backgroundRefreshPromise",
    "foreground actions do not wait on heartbeat",
  ],
];

const requiredSetupServerNeedles = [
  ["/api/diagnostics", "setup server exposes diagnostics route"],
  ["/api/launch-preparation", "setup server exposes launch preparation route"],
  ["/api/support-bundle", "setup server exposes support bundle route"],
  ["/api/discord/roles", "setup server exposes Discord role loading route"],
  ["getDiagnosticsReport", "setup server builds diagnostics reports"],
  ["getBotStartReadiness", "setup server gates bot start"],
  ["outbound_messages", "setup server persists outbound history"],
  ["outboundImportance", "setup server tracks outbound importance"],
  ["giveaway_message_templates", "setup server stores giveaway templates"],
  ["/api/giveaway/status/send", "setup server sends giveaway status"],
  ["/api/giveaway/critical/resend", "setup server exposes panic resend"],
  ["queueHealth", "setup server returns queue health"],
  ["outboundRecovery", "setup server returns outbound recovery"],
  ["safeToResend", "setup server reports resend safety"],
  ["failureCategory", "setup server returns failure categories"],
  ["blockingCritical", "setup server reports critical guardrails"],
  ["queueStatus", "setup server exposes phase queue status"],
  ["rate_limit", "setup server preserves Twitch rate-limit classification"],
  ["retryDelayMs", "setup server reports retry timing"],
  ["operator_message_templates", "setup server stores operator presets"],
  ["/api/operator-messages/send", "setup server exposes operator sends"],
  ["/api/bot-config/export", "setup server exposes safe config export"],
  ["includesSecrets: false", "safe bot config explicitly excludes secrets"],
  ["/api/commands", "setup server exposes custom command routes"],
  ["/api/feature-gates", "setup server exposes feature gate routes"],
  ["feature_gates", "setup server persists feature gates"],
  ["/api/timers", "setup server exposes timer routes"],
  ["timers", "setup server persists timers"],
  ["/api/moderation", "setup server exposes moderation routes"],
  ["moderation_hits", "setup server persists moderation hits"],
  ["custom_commands", "setup server persists command definitions"],
  ["custom_command_invocations", "setup server persists command history"],
  ["Token refreshed", "setup server reports automatic token refresh"],
  [
    "Twitch rejected the saved Client Secret",
    "setup server reports invalid refresh secrets",
  ],
];

const requiredLiveBotNeedles = [
  ["giveaway_message_templates", "standalone bot reads giveaway templates"],
  ["outbound_messages", "standalone bot persists outbound history"],
  ["custom_commands", "standalone bot reads custom commands"],
  ["custom_command_invocations", "standalone bot writes command history"],
  ["failureCategory", "standalone bot logs outbound failure categories"],
  [
    "Twitch OAuth token refreshed for live bot runtime",
    "standalone bot can refresh expired access tokens",
  ],
];

const requiredStyleNeedles = [
  [".tab-panel", "styles asset loaded"],
  [".setup-step", "setup guide styles loaded"],
  [".runtime-log", "bot runtime log styles loaded"],
  [".state-banner", "live mode state styles loaded"],
  [".failure-log", "outbound failure log styles loaded"],
  [".brand-logo", "logo header styles loaded"],
];

export function assertSetupUiBundle({
  appJs,
  styles,
  logo,
  setupServerJs,
  liveBotJs,
  assert,
}) {
  assert(logo.contentType === "image/jpeg", "logo asset is served as JPEG");
  assert(logo.byteLength > 1000, "logo asset is not empty");
  assert(appJs.includes("/ui/logo.jpg"), "header renders logo asset");
  assert(
    appJs.includes("CommandRouter") === false,
    "browser UI does not duplicate router logic",
  );

  for (const [needle, message] of requiredUiNeedles) {
    assert(appJs.includes(needle), message);
  }

  for (const [needle, message] of forbiddenUiNeedles) {
    assert(!appJs.includes(needle), message);
  }

  const saveSettingsIndex = appJs.indexOf("async function saveSettings()");
  const settingsPayloadIndex = appJs.indexOf(
    "const payload = readSettingsPayload();",
    saveSettingsIndex,
  );
  const saveActionIndex = appJs.indexOf(
    "await runAction(",
    settingsPayloadIndex,
  );
  assert(
    saveSettingsIndex >= 0 &&
      settingsPayloadIndex > saveSettingsIndex &&
      saveActionIndex > settingsPayloadIndex,
    "settings save snapshots fields before rerender",
  );

  const refreshAllIndex = appJs.indexOf("async function refreshAll");
  const refreshAfterActionIndex = appJs.indexOf(
    "async function refreshAfterAction",
    refreshAllIndex,
  );
  const refreshAllBody = appJs.slice(refreshAllIndex, refreshAfterActionIndex);
  assert(
    !refreshAllBody.includes("renderWhenIdle"),
    "heartbeat does not schedule a UI rebuild",
  );
  assert(
    !refreshAllBody.includes("state.message ="),
    "heartbeat errors do not overwrite visible messages",
  );

  for (const [needle, message] of requiredSetupServerNeedles) {
    assert(setupServerJs.includes(needle), message);
  }

  for (const [needle, message] of requiredLiveBotNeedles) {
    assert(liveBotJs.includes(needle), message);
  }
  assert(
    liveBotJs.includes('source: "bot"') || liveBotJs.includes("source:'bot'"),
    "standalone bot writes bot-sourced outbound history",
  );

  for (const [needle, message] of requiredStyleNeedles) {
    assert(styles.includes(needle), message);
  }
}
