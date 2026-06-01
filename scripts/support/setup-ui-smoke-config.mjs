import { assertSafeConfig } from "./setup-ui-smoke-http.mjs";

export async function assertSetupConfigAndOperations({
  assert,
  baseUrl,
  json,
  waitForLaunchPreparation,
  writeLocalSecretsFixture,
  setMockInvalidClientSecretExchange,
}) {
  const initialConfig = await json("/api/config");
  assertSafeConfig(initialConfig, assert);
  const initialDiagnostics = await json("/api/diagnostics");
  assert(
    initialDiagnostics.setupUi.logoJpg === true,
    "diagnostics sees logo asset",
  );
  const initialStatus = await json("/api/status");
  assert(
    initialStatus.runtime.queueHealth.status === "clear",
    "queue health starts clear",
  );
  assert(
    initialStatus.runtime.outboundRecovery.needed === false,
    "outbound recovery starts clear",
  );
  const initialLaunch = await waitForLaunchPreparation();
  assert(
    initialLaunch.status === "setup_required",
    "launch preparation reports setup required on clean setup",
  );
  const launchRerun = await json("/api/launch-preparation", {
    method: "POST",
  });
  assert(
    launchRerun.status === "setup_required",
    "launch preparation route can rerun setup check",
  );

  const initialCommands = await json("/api/commands");
  assert(initialCommands.ok === true, "custom command route exists");
  assert(Array.isArray(initialCommands.commands), "commands array returns");
  assert(
    initialCommands.reservedNames.includes("ping"),
    "reserved command names are returned",
  );
  assert(
    initialCommands.featureGate.mode === "live",
    "custom command feature gate state returns",
  );
  assert(
    initialCommands.presets.some((preset) => preset.id === "discord"),
    "custom command starter presets return",
  );

  const initialFeatureGates = await json("/api/feature-gates");
  assert(initialFeatureGates.ok === true, "feature gate route exists");
  assert(
    initialFeatureGates.featureGates.some(
      (gate) => gate.key === "timers" && gate.mode === "off",
    ),
    "future timers default off",
  );

  const initialStreamPresets = await json("/api/stream-presets");
  assert(initialStreamPresets.ok === true, "stream presets route exists");
  assert(
    initialStreamPresets.presets.some(
      (preset) => preset.id === "local-bot-rehearsal",
    ),
    "stream presets include local bot rehearsal",
  );
  const initialTimers = await json("/api/timers");
  assert(initialTimers.ok === true, "timer route exists");
  assert(initialTimers.featureGate.mode === "off", "timer gate returns");
  const initialModeration = await json("/api/moderation");
  assert(initialModeration.ok === true, "moderation route exists");
  assert(
    initialModeration.summary.filtersEnabled === 0,
    "moderation filters default off",
  );
  assert(
    initialModeration.enforcement.deleteMessages.available === false,
    "moderation delete enforcement reports unavailable before setup",
  );

  const rehearsalPreset = await json("/api/stream-presets/apply", {
    method: "POST",
    body: { id: "local-bot-rehearsal" },
  });
  assert(
    rehearsalPreset.ok === true,
    "safe stream preset applies without live confirmation",
  );
  assert(
    rehearsalPreset.featureGates.some(
      (gate) => gate.key === "timers" && gate.mode === "test",
    ),
    "stream preset can move timers to test",
  );
  const unconfirmedLivePreset = await json("/api/stream-presets/apply", {
    method: "POST",
    body: { id: "bot-replacement" },
  });
  assert(
    unconfirmedLivePreset.ok === false,
    "live stream preset requires confirmation",
  );

  const invalidBotStart = await json("/api/bot/start", { method: "POST" });
  assert(
    invalidBotStart.ok === false,
    "bot start is blocked before validation",
  );
  const stoppedBot = await json("/api/bot/stop", { method: "POST" });
  assert(stoppedBot.ok === true, "bot stop is safe when already stopped");

  const partialSaved = await json("/api/config", {
    method: "POST",
    body: {
      mode: "live",
      redirectUri: "http://localhost:3434/auth/twitch/callback",
      clientId: "fake-client-id",
    },
  });
  assert(
    partialSaved.config.hasClientId === true,
    "settings save persists client ID without secret",
  );
  assert(
    partialSaved.config.hasClientSecret === false,
    "partial settings save reports missing secret",
  );
  assertSafeConfig(partialSaved.config, assert);

  const saved = await json("/api/config", {
    method: "POST",
    body: {
      mode: "live",
      redirectUri: "http://localhost:3434/auth/twitch/callback",
      clientId: "fake-client-id",
      clientSecret: "fake-client-secret",
      broadcasterLogin: "https://www.twitch.tv/BroadCaster",
      botLogin: "@Bot",
    },
  });
  assert(saved.ok === true, "settings save returns ok");
  assert(saved.config.hasClientSecret === true, "saved config reports secret");
  assert(saved.config.hasBotUserId === false, "bot ID unresolved pre-OAuth");
  assertSafeConfig(saved.config, assert);

  const reloadedConfig = await json("/api/config");
  assert(
    reloadedConfig.broadcasterLogin === "broadcaster",
    "settings reload normalized broadcaster login",
  );
  assert(reloadedConfig.botLogin === "bot", "settings reload bot login");
  assertSafeConfig(reloadedConfig, assert);

  writeLocalSecretsFixture({
    mode: "live",
    twitch: {
      clientId: "fake-client-id",
      clientSecret: "fake-client-secret",
      redirectUri: "http://localhost:3434/auth/twitch/callback",
      broadcasterLogin: "broadcaster",
      broadcasterUserId: "broadcaster-id",
      botLogin: "oldbot",
      botUserId: "oldbot-id",
      accessToken: "fake-access-token",
      refreshToken: "fake-refresh-token",
      scopes: ["user:read:chat", "user:write:chat", "channel:read:stream_key"],
      tokenExpiresAt: "2099-01-01T00:00:00.000Z",
      tokenValidatedAt: "2099-01-01T00:00:00.000Z",
    },
  });
  const changedBotLogin = await json("/api/config", {
    method: "POST",
    body: {
      mode: "live",
      redirectUri: "http://localhost:3434/auth/twitch/callback",
      broadcasterLogin: "broadcaster",
      botLogin: "newbot",
    },
  });
  assert(
    changedBotLogin.config.hasAccessToken === false,
    "changing bot login clears OAuth token",
  );
  assert(
    changedBotLogin.config.hasBroadcasterUserId === true,
    "changing bot login keeps unchanged broadcaster identity",
  );
  assertSafeConfig(changedBotLogin.config, assert);

  writeLocalSecretsFixture({
    mode: "live",
    twitch: {
      clientId: "fake-client-id",
      clientSecret: "fake-client-secret",
      redirectUri: "http://localhost:3434/auth/twitch/callback",
      broadcasterLogin: "broadcaster",
      broadcasterUserId: "broadcaster-id",
      botLogin: "newbot",
      botUserId: "newbot-id",
      accessToken: "fake-access-token",
      refreshToken: "fake-refresh-token",
      scopes: ["user:read:chat", "user:write:chat", "channel:read:stream_key"],
      tokenExpiresAt: "2099-01-01T00:00:00.000Z",
      tokenValidatedAt: "2099-01-01T00:00:00.000Z",
    },
  });
  const disconnected = await json("/api/auth/twitch/disconnect", {
    method: "POST",
  });
  assert(
    disconnected.config.hasAccessToken === false,
    "disconnect clears OAuth token",
  );
  assertSafeConfig(disconnected.config, assert);

  const authStart = await fetch(`${baseUrl}/auth/twitch/start`, {
    redirect: "manual",
  });
  assert(authStart.status === 302, "OAuth start route exists");
  assert(
    authStart.headers.get("location")?.startsWith("https://id.twitch.tv/"),
    "OAuth start redirects to Twitch",
  );
  assert(
    authStart.headers.get("location")?.includes("force_verify=true"),
    "OAuth start forces account verification",
  );
  const authState = new URL(authStart.headers.get("location")).searchParams.get(
    "state",
  );
  assert(Boolean(authState), "OAuth start stores callback state");

  setMockInvalidClientSecretExchange(true);
  const invalidSecretCallback = await fetch(
    `${baseUrl}/auth/twitch/callback?code=smoke-code&state=${authState}`,
    { redirect: "manual" },
  );
  setMockInvalidClientSecretExchange(false);
  assert(
    invalidSecretCallback.status === 302,
    "OAuth exchange failures redirect",
  );
  const invalidSecretLocation =
    invalidSecretCallback.headers.get("location") || "";
  assert(
    invalidSecretLocation.includes("error=invalid_client_secret"),
    "OAuth exchange failure classifies invalid client secret",
  );

  const validation = await json("/api/validate", { method: "POST" });
  assert(validation.ok === false, "validation fails without OAuth token");
  const chatSend = await json("/api/chat/send", {
    method: "POST",
    body: { message: "hello chat" },
  });
  assert(chatSend.ok === false, "chat send rejects until validation passes");

  const operatorMessages = await json("/api/operator-messages");
  assert(operatorMessages.ok === true, "operator message route exists");
  assert(
    operatorMessages.templates.some((template) => template.id === "brb"),
    "operator macros include BRB preset",
  );
  const savedOperatorMessages = await json("/api/operator-messages", {
    method: "POST",
    body: { templates: { thanks: "Appreciate you hanging out tonight." } },
  });
  assert(
    savedOperatorMessages.templates.some(
      (template) => template.id === "thanks" && template.customized,
    ),
    "operator message presets can be customized",
  );
  const unconfirmedOperatorSend = await json("/api/operator-messages/send", {
    method: "POST",
    body: { id: "technical-pause" },
  });
  assert(
    unconfirmedOperatorSend.ok === false,
    "high-impact operator message requires confirmation",
  );
  const resetOperatorMessages = await json("/api/operator-messages/reset", {
    method: "POST",
  });
  assert(
    resetOperatorMessages.templates.every((template) => !template.customized),
    "operator message presets reset to defaults",
  );

  const safeBotConfig = await json("/api/bot-config/export");
  assert(safeBotConfig.ok === true, "safe bot config export route returns ok");
  assert(
    safeBotConfig.includesSecrets === false,
    "safe bot config export excludes secrets",
  );
  assert(
    !JSON.stringify(safeBotConfig).includes("fake-client-secret"),
    "safe bot config export does not leak saved client secret",
  );
  const importedBotConfig = await json("/api/bot-config/import", {
    method: "POST",
    body: {
      timers: [
        {
          name: "Bundle reminder",
          message: "Safe imported reminder.",
          intervalMinutes: 10,
          minChatMessages: 2,
          enabled: false,
        },
      ],
      operatorMacros: [{ id: "thanks", template: "Imported thanks macro." }],
    },
  });
  assert(
    importedBotConfig.ok === true,
    "safe bot config import route returns ok",
  );

  const preflight = await json("/api/preflight", { method: "POST" });
  assert(Array.isArray(preflight.checks), "preflight returns check list");
  assert(
    preflight.ok === false,
    "preflight reports not ready before bot runtime starts",
  );
}
