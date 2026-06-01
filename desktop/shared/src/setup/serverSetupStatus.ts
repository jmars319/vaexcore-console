import type {
  Giveaway,
  GiveawayWinner,
} from "../modules/giveaways/giveaways.types";
import {
  SafeInputError,
  limits,
  normalizeCommandName,
  normalizeKeyword,
  normalizeLogin as normalizeTwitchLogin,
  parseSafeInteger,
  redactSecrets,
  redactSecretText,
  safeErrorMessage,
  sanitizeChatMessage,
  sanitizeCommandText,
  sanitizeDisplayName,
  sanitizeGiveawayTitle,
  sanitizeText,
} from "../core/security";
import {
  defaultRedirectUri,
  getLocalSecretsPath,
  readLocalSecrets,
  writeLocalSecrets,
  type LocalSecrets,
} from "../config/localSecrets";
import {
  getTokenExpiresAt,
  refreshStoredTwitchToken,
  type TwitchOAuthTokenResponse,
  validateStoredTwitchToken,
} from "../twitch/tokenManager";
import {
  getTwitchUserByLogin,
  optionalCreatorOpsScopes,
  optionalModerationScopes,
  requiredTwitchScopes,
  validateToken,
} from "../twitch/validate";
import { basename, dirname, join, resolve } from "node:path";
import { getBotProcessSnapshot } from "./serverBotProcess";
import { getSafeConfig } from "./serverConfig";
import {
  isSafeConfigComplete,
  summarizeOutboundRecovery,
  summarizeQueueHealth,
  summarizeTimers,
} from "./serverDiagnostics";
import {
  getGiveawayState,
  summarizeGiveawayState,
} from "./serverGiveawayState";
import {
  getLaunchPreparationSnapshot,
  launchPreparation,
} from "./serverLaunchPreparation";
import { sendConfiguredChatMessage } from "./serverOutbound";
import { sendRelayTestMessageRoute } from "./serverRelay";
import {
  botProcess,
  chatQueue,
  featureGates,
  giveawaysService,
  logger,
  moderationService,
  outboundHistory,
  timersService,
} from "./serverState";
import { buildConsoleLocalRuntime } from "./serverSuite";
import { getCachedTokenReadiness } from "./serverTwitchAuth";

export const validateSetup = async () => {
  const secrets = readLocalSecrets();
  const twitch = secrets.twitch;
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  const fail = (name: string, detail: string) =>
    checks.push({ name, ok: false, detail });
  const pass = (name: string, detail: string) =>
    checks.push({ name, ok: true, detail });

  if (!twitch.clientId || !twitch.clientSecret) {
    fail("Twitch app credentials", "Client ID and client secret are required.");
    return { ok: false, checks };
  }

  if (!twitch.accessToken) {
    fail("OAuth token", "Click Connect Twitch first.");
    return { ok: false, checks };
  }

  let validated: Awaited<ReturnType<typeof validateStoredTwitchToken>>;

  try {
    validated = await validateStoredTwitchToken({ secrets, logger });
  } catch (error) {
    const detail = safeErrorMessage(
      error,
      "Twitch token validation failed. Reconnect Twitch and try again.",
    );
    fail("OAuth token", detail);
    return { ok: false, checks, error: detail };
  }

  const activeSecrets = validated.secrets;
  const activeTwitch = validated.twitch;
  const token = validated.token;
  const activeAccessToken = activeTwitch.accessToken;
  const activeClientId = activeTwitch.clientId ?? twitch.clientId;

  if (!activeClientId || !activeAccessToken) {
    fail(
      "OAuth token",
      "Validated Twitch token was not available after refresh.",
    );
    return { ok: false, checks };
  }

  pass(
    validated.refreshed ? "Token refreshed" : "Token valid",
    validated.refreshed
      ? `Access token refreshed for ${token.login}.`
      : `Token belongs to ${token.login}.`,
  );

  if (token.client_id !== activeClientId) {
    fail(
      "Twitch app",
      "OAuth token belongs to a different Twitch application.",
    );
  } else {
    pass("Twitch app", "OAuth token matches the saved Client ID.");
  }

  const missingScopes = requiredTwitchScopes.filter(
    (scope) => !token.scopes.includes(scope),
  );

  if (missingScopes.length > 0) {
    fail("Required scopes", `Missing: ${missingScopes.join(", ")}.`);
  } else {
    pass("Required scopes", token.scopes.join(", "));
  }

  const missingModerationScopes = optionalModerationScopes.filter(
    (scope) => !token.scopes.includes(scope),
  );

  pass(
    "Moderation enforcement scopes",
    missingModerationScopes.length
      ? `Warn-only moderation works. Reconnect Twitch to grant optional scope(s): ${missingModerationScopes.join(", ")}.`
      : "Delete and timeout enforcement scopes are present.",
  );

  const missingCreatorOpsScopes = optionalCreatorOpsScopes.filter(
    (scope) => !token.scopes.includes(scope),
  );

  pass(
    "Creator ops scopes",
    missingCreatorOpsScopes.length
      ? `Core chat works. Reconnect Twitch to grant creator ops scope(s): ${missingCreatorOpsScopes.join(", ")}.`
      : "Poll, prediction, raid, announcement, and shoutout scopes are present.",
  );

  const botLogin = activeTwitch.botLogin ?? twitch.botLogin;
  const broadcasterLogin =
    activeTwitch.broadcasterLogin ?? twitch.broadcasterLogin;
  const botUser = botLogin
    ? await getTwitchUserByLogin(
        { clientId: activeClientId, accessToken: activeAccessToken },
        botLogin,
      )
    : undefined;
  const broadcasterUser = broadcasterLogin
    ? await getTwitchUserByLogin(
        { clientId: activeClientId, accessToken: activeAccessToken },
        broadcasterLogin,
      )
    : undefined;

  if (!botUser) {
    fail("Bot identity", "Bot login was not found.");
  } else if (botUser.id !== token.user_id) {
    fail(
      "Bot identity",
      `OAuth token belongs to ${token.login}, but bot login resolves to ${botUser.login}.`,
    );
  } else {
    pass("Bot identity", `${botUser.login} (${botUser.id})`);
  }

  if (!broadcasterUser) {
    fail("Broadcaster identity", "Broadcaster login was not found.");
  } else {
    pass(
      "Broadcaster identity",
      `${broadcasterUser.login} (${broadcasterUser.id})`,
    );
  }

  const setupOk = checks.every((check) => check.ok);
  const nextTwitch: LocalSecrets["twitch"] = {
    ...activeTwitch,
    scopes: token.scopes,
    tokenExpiresAt: token.expires_in
      ? getTokenExpiresAt(token.expires_in)
      : activeTwitch.tokenExpiresAt,
    tokenValidatedAt: setupOk ? new Date().toISOString() : undefined,
    botUserId: undefined,
    broadcasterUserId: undefined,
  };

  if (botUser && botUser.id === token.user_id) {
    nextTwitch.botLogin = botUser.login;
    nextTwitch.botUserId = botUser.id;
  }

  if (broadcasterUser) {
    nextTwitch.broadcasterLogin = broadcasterUser.login;
    nextTwitch.broadcasterUserId = broadcasterUser.id;
  }

  writeLocalSecrets({
    ...activeSecrets,
    twitch: nextTwitch,
  });

  return { ok: setupOk, checks };
};

export const sendTestMessage = async () => {
  if (readLocalSecrets().relay.twitchTransportMode === "relay-chatbot") {
    return sendRelayTestMessageRoute();
  }

  const validation = await validateSetup();

  if (!validation.ok) {
    return {
      ok: false,
      checks: validation.checks,
      error: "Validation must pass before sending a test message.",
    };
  }

  const secrets = readLocalSecrets();
  const twitch = secrets.twitch;

  if (
    !twitch.clientId ||
    !twitch.accessToken ||
    !twitch.broadcasterUserId ||
    !twitch.botUserId
  ) {
    return { ok: false, error: "Setup is missing resolved Twitch IDs." };
  }

  const result = await sendConfiguredChatMessage(
    "vaexcore console setup test.",
  );
  const structured = typeof result === "string" ? { status: result } : result;
  return {
    ok: structured.status === "sent",
    error:
      structured.status === "sent"
        ? undefined
        : structured.reason || "Test chat message was not sent.",
    failureCategory: structured.failureCategory,
  };
};

export const getOperatorStatus = async () => {
  let config = getSafeConfig();
  let tokenValid = false;
  let requiredScopesPresent = false;
  let tokenRefreshed = false;
  const cachedReadiness = getCachedTokenReadiness(config);

  if (cachedReadiness.ready) {
    tokenValid = true;
    requiredScopesPresent = true;
  } else {
    try {
      const secrets = readLocalSecrets();
      const validation = secrets.twitch.accessToken
        ? await validateStoredTwitchToken({ secrets, logger })
        : undefined;
      const token = validation?.token;
      tokenRefreshed = Boolean(validation?.refreshed);
      tokenValid = Boolean(token);
      requiredScopesPresent = token
        ? requiredTwitchScopes.every((scope) => token.scopes.includes(scope))
        : false;
      if (tokenRefreshed) {
        config = getSafeConfig();
      }
    } catch {
      tokenValid = false;
      requiredScopesPresent = false;
    }
  }

  const giveaway = giveawaysService.getOperatorState();
  const queue = chatQueue.snapshot();
  const outbound = outboundHistory.summary();
  const featureGateStates = featureGates.list();
  const timers = timersService.listTimers();
  const moderation = moderationService.getState();

  return {
    ok: true,
    launchPreparation: getLaunchPreparationSnapshot(),
    config,
    runtime: {
      mode: config.mode,
      botLogin: config.botLogin,
      broadcasterLogin: config.broadcasterLogin,
      tokenValid,
      tokenRefreshed,
      requiredScopesPresent,
      botProcess: getBotProcessSnapshot(),
      eventSubConnected: botProcess.eventSubConnected,
      chatSubscriptionActive: botProcess.chatSubscriptionActive,
      queueReady: chatQueue.isReady(),
      queue,
      queueHealth: summarizeQueueHealth(queue, outbound),
      outboundChat: outbound,
      outboundRecovery: summarizeOutboundRecovery(),
      liveChatConfirmed: botProcess.liveChatConfirmed,
      note: botProcess.child
        ? "Live bot runtime is managed by this setup console."
        : "Start the live bot runtime from Dashboard or Settings to receive chat commands.",
    },
    featureGates: featureGateStates,
    timers: summarizeTimers(timers),
    moderation: moderation.summary,
    localRuntime: buildConsoleLocalRuntime(),
    giveaway: summarizeGiveawayState(giveaway),
  };
};

export const runPreflightCheck = async () => {
  const status = await getOperatorStatus();
  const runtime = status.runtime;
  const giveawayState = getGiveawayState();
  const assurance = giveawayState.assurance;
  const outbound = outboundHistory.summary();
  const checks = [
    {
      name: "Twitch setup",
      ok: isSafeConfigComplete(),
      detail: isSafeConfigComplete()
        ? "Required local Twitch fields are present."
        : "Open Settings -> Setup Guide and complete credentials, usernames, OAuth, and validation.",
    },
    {
      name: "Token and scopes",
      ok: runtime.tokenValid && runtime.requiredScopesPresent,
      detail:
        runtime.tokenValid && runtime.requiredScopesPresent
          ? "OAuth token is valid and required chat scopes are present."
          : "Reconnect Twitch if automatic launch validation cannot confirm the saved token.",
    },
    {
      name: "Setup queue",
      ok: runtime.queueReady,
      detail: runtime.queueReady
        ? "Outbound setup queue is ready."
        : "Restart the setup console if queue readiness does not recover.",
    },
    {
      name: "Bot runtime",
      ok: Boolean(runtime.botProcess.running),
      detail: runtime.botProcess.running
        ? `Bot process is ${runtime.botProcess.status}.`
        : "Start bot process from Dashboard.",
    },
    {
      name: "EventSub chat listener",
      ok: runtime.eventSubConnected && runtime.chatSubscriptionActive,
      detail:
        runtime.eventSubConnected && runtime.chatSubscriptionActive
          ? "Chat subscription is active."
          : "Wait for the bot process to connect to EventSub and create the chat subscription.",
    },
    {
      name: "Live chat confirmation",
      ok: runtime.liveChatConfirmed,
      detail: runtime.liveChatConfirmed
        ? "Live chat has responded to !ping."
        : "Type !ping in Twitch chat after the bot starts.",
    },
    {
      name: "Critical outbound failures",
      ok: outbound.criticalFailed === 0 && !assurance.blockContinue,
      detail:
        outbound.criticalFailed === 0 && !assurance.blockContinue
          ? "No critical giveaway chat failures are currently tracked."
          : assurance.nextAction ||
            "Resend failed critical giveaway messages before continuing.",
    },
    {
      name: "Giveaway controls",
      ok:
        giveawayState.summary.status === "none" ||
        giveawayState.summary.status === "open" ||
        giveawayState.summary.status === "closed",
      detail:
        giveawayState.summary.status === "none"
          ? "No active giveaway; start controls are ready."
          : `Giveaway is ${giveawayState.summary.status}; next action: ${giveawayState.summary.status === "open" ? "close entries before drawing" : "draw or finish delivery"}.`,
    },
  ];
  const failed = checks.find((check) => !check.ok);

  return {
    ok: checks.every((check) => check.ok),
    checks,
    nextAction: failed?.detail ?? "Giveaway controls ready.",
    summary: giveawayState.summary,
  };
};
