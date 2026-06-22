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
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
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
import {
  giveawayOverlayHtml,
  redirect,
  sendHtml,
  sendPlatformHtml,
  sendStaticUiAsset,
  sendText,
  setupShellHtml,
  getSetupUiDir,
  resolveSetupUiAssetPath,
  securityHeaders,
} from "./staticUi";
import { URL } from "node:url";
import { basename, dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import {
  deriveTwitchTransportForSetupMode,
  getSafeConfig,
  getSetupMode,
  parseSetupMode,
} from "./serverConfig";
import { missingSafeConfigFields } from "./serverDiagnostics";
import { objectInput } from "./serverDiscordSetup";
import {
  clearTwitchAuthorization,
  consumeOauthState,
  sanitizeOptionalText,
  sanitizeRedirectUri,
  sanitizeRelayBaseUrl,
  valueOrExisting,
  valueOrExistingLogin,
} from "./serverInput";
import { queueLaunchPreparation } from "./serverLaunchPreparation";
import {
  logger,
  oauthStates,
  tokenRefreshLeadMs,
  tokenValidationMaxAgeMs,
} from "./serverState";
import type { SetupCheck } from "./serverLaunchPreparation";

/* Token readiness boundary */
export const getCachedTokenReadiness = (config = getSafeConfig()) => {
  const missing = missingSafeConfigFields(config);
  const requiredScopesPresent = requiredTwitchScopes.every((scope) =>
    (config.scopes || []).includes(scope),
  );
  const expiresAtMs = Date.parse(config.tokenExpiresAt || "");
  const expiresSoon =
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= Date.now() + tokenRefreshLeadMs;
  const validatedAtMs = Date.parse(config.tokenValidatedAt || "");
  const validationStale =
    !Number.isFinite(validatedAtMs) ||
    validatedAtMs <= Date.now() - tokenValidationMaxAgeMs;
  const identitiesResolved = config.hasBotUserId && config.hasBroadcasterUserId;
  const ready = Boolean(
    config.hasAccessToken &&
    identitiesResolved &&
    requiredScopesPresent &&
    !expiresSoon &&
    !validationStale,
  );
  const checks: SetupCheck[] = [
    {
      name: "Saved setup",
      ok: missing.length === 0,
      detail:
        missing.length === 0
          ? "Required saved Twitch setup fields are present."
          : `Missing setup fields: ${missing.join(", ")}.`,
    },
    {
      name: "Token valid",
      ok: Boolean(config.hasAccessToken && !expiresSoon && !validationStale),
      detail:
        config.hasAccessToken && !expiresSoon && !validationStale
          ? `Saved token is valid until ${config.tokenExpiresAt}.`
          : "Saved token is missing, expired, close to expiry, or due for validation.",
    },
    {
      name: "Required scopes",
      ok: requiredScopesPresent,
      detail: requiredScopesPresent
        ? requiredTwitchScopes.join(", ")
        : "Saved token scopes are missing required chat access.",
    },
    {
      name: "Twitch identities",
      ok: identitiesResolved,
      detail: identitiesResolved
        ? "Saved bot and broadcaster identities are resolved."
        : "Bot or broadcaster identity must be resolved.",
    },
  ];

  return {
    ready,
    requiredScopesPresent,
    expiresSoon,
    validationStale,
    identitiesResolved,
    checks,
  };
};

/* Broadcast readiness boundary */
export const getTwitchBroadcastReadiness = () => {
  const config = getSafeConfig();
  const tokenReadiness = getCachedTokenReadiness(config);
  const streamKeyScopeReady = (config.scopes || []).includes(
    "channel:read:stream_key",
  );
  const broadcasterReady = Boolean(
    config.broadcasterLogin && config.hasBroadcasterUserId,
  );
  const channelUrl = config.broadcasterLogin
    ? `https://www.twitch.tv/${config.broadcasterLogin}`
    : null;
  const checks = [
    ...tokenReadiness.checks,
    {
      name: "Broadcaster channel",
      ok: broadcasterReady,
      detail: broadcasterReady
        ? `${config.broadcasterLogin} is resolved as the broadcaster.`
        : "Set Broadcaster Login and validate Twitch setup.",
    },
    {
      name: "Stream-key scope",
      ok: streamKeyScopeReady,
      detail: streamKeyScopeReady
        ? "Saved OAuth scopes include channel:read:stream_key."
        : "Reconnect Twitch with the channel:read:stream_key scope before Studio can import a stream key.",
    },
  ];
  const ok = checks.every((check) => check.ok);
  const nextAction = ok
    ? "Studio can import the Twitch stream key and prepare an RTMP destination."
    : streamKeyScopeReady
      ? "Run launch checks and validate Twitch setup."
      : "Reconnect Twitch in Console with stream-key access, then import the key from Studio.";

  return {
    ok,
    status: ok ? "ready" : config.hasAccessToken ? "attention" : "blocked",
    summary: ok
      ? `Twitch broadcast path is ready for ${config.broadcasterLogin}.`
      : nextAction,
    nextAction,
    generatedAt: new Date().toISOString(),
    twitch: {
      broadcasterLogin: config.broadcasterLogin || null,
      channelUrl,
      streamKeyScopeReady,
    },
    checks,
  };
};

/* Setup config boundary */
export const saveConfig = (body: unknown) => {
  const input = body as Record<string, string>;
  const existing = readLocalSecrets();
  const setupMode = parseSetupMode(input.setupMode, getSetupMode(existing));
  const redirectUri = sanitizeRedirectUri(input.redirectUri);
  const clientId = valueOrExisting(
    sanitizeOptionalText(input.clientId, "Client ID", 120),
    existing.twitch.clientId,
  );
  const clientSecret = valueOrExisting(
    sanitizeOptionalText(input.clientSecret, "Client secret", 200),
    existing.twitch.clientSecret,
  );
  const broadcasterLogin = valueOrExistingLogin(
    input,
    "broadcasterLogin",
    existing.twitch.broadcasterLogin,
  );
  const botLogin = valueOrExistingLogin(
    input,
    "botLogin",
    existing.twitch.botLogin,
  );
  const appConfigChanged =
    clientId !== existing.twitch.clientId ||
    clientSecret !== existing.twitch.clientSecret ||
    redirectUri !== (existing.twitch.redirectUri ?? defaultRedirectUri);
  const broadcasterChanged =
    broadcasterLogin !== existing.twitch.broadcasterLogin;
  const botChanged = botLogin !== existing.twitch.botLogin;
  const relayBaseUrl = valueOrExisting(
    sanitizeRelayBaseUrl(input.relayBaseUrl),
    existing.relay.baseUrl,
  );
  const relayInstallationId = valueOrExisting(
    sanitizeOptionalText(
      input.relayInstallationId,
      "Relay installation ID",
      120,
    ),
    existing.relay.installationId,
  );
  const relayConsoleToken = valueOrExisting(
    sanitizeOptionalText(input.relayConsoleToken, "Relay console token", 240),
    existing.relay.consoleToken,
  );
  const twitchTransportMode =
    input.twitchTransportMode === "relay-chatbot"
      ? "relay-chatbot"
      : "local-user-token";
  const relayChanged =
    twitchTransportMode !== existing.relay.twitchTransportMode ||
    relayBaseUrl !== existing.relay.baseUrl ||
    relayInstallationId !== existing.relay.installationId ||
    relayConsoleToken !== existing.relay.consoleToken;
  const twitch: LocalSecrets["twitch"] = {
    ...existing.twitch,
    clientId,
    clientSecret,
    redirectUri,
    broadcasterLogin,
    botLogin,
  };

  if (appConfigChanged || botChanged) {
    Object.assign(twitch, clearTwitchAuthorization(twitch));
  }

  if (appConfigChanged || broadcasterChanged) {
    twitch.broadcasterUserId = undefined;
    twitch.tokenValidatedAt = undefined;
  }

  const next: LocalSecrets = {
    mode: input.mode === "local" ? "local" : "live",
    setupMode,
    twitch,
    discord: existing.discord,
    relay: {
      twitchTransportMode,
      baseUrl: relayBaseUrl,
      installationId: relayInstallationId,
      consoleToken: relayConsoleToken,
      chatbotIdentityValidatedAt: relayChanged
        ? undefined
        : existing.relay.chatbotIdentityValidatedAt,
      chatbotIdentityValidationNote: relayChanged
        ? undefined
        : existing.relay.chatbotIdentityValidationNote,
    },
    setupChecks: existing.setupChecks,
    botValidation: existing.botValidation,
  };

  writeLocalSecrets(next);
  return getSafeConfig();
};

export const saveSetupMode = (body: unknown) => {
  const input = objectInput(body);
  const existing = readLocalSecrets();
  const setupMode = parseSetupMode(input.setupMode, getSetupMode(existing));
  const twitchTransportMode = deriveTwitchTransportForSetupMode(
    setupMode,
    existing.relay.twitchTransportMode,
  );

  writeLocalSecrets({
    ...existing,
    setupMode,
    relay: {
      ...existing.relay,
      twitchTransportMode,
    },
  });

  return getSafeConfig();
};

export const disconnectTwitch = () => {
  const secrets = readLocalSecrets();
  writeLocalSecrets({
    ...secrets,
    twitch: clearTwitchAuthorization(secrets.twitch, {
      clearBroadcasterIdentity: true,
    }),
  });
  return getSafeConfig();
};

export const redirectToOAuthNotice = (
  response: ServerResponse,
  error: string,
) => {
  const params = new URLSearchParams({
    window: "settings",
    error,
  });
  redirect(response, `/?${params.toString()}`);
};

export const redirectToTwitch = (response: ServerResponse) => {
  const secrets = readLocalSecrets();
  const twitch = secrets.twitch;

  if (!twitch.clientId || !twitch.clientSecret) {
    redirectToOAuthNotice(response, "missing_client_credentials");
    return;
  }

  const state = randomBytes(16).toString("hex");
  oauthStates.set(state, Date.now() + 10 * 60 * 1000);

  const authorizeUrl = new URL("https://id.twitch.tv/oauth2/authorize");
  authorizeUrl.searchParams.set("client_id", twitch.clientId);
  authorizeUrl.searchParams.set(
    "redirect_uri",
    twitch.redirectUri ?? defaultRedirectUri,
  );
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set(
    "scope",
    [
      ...requiredTwitchScopes,
      ...optionalModerationScopes,
      ...optionalCreatorOpsScopes,
    ].join(" "),
  );
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("force_verify", "true");

  redirect(response, authorizeUrl.toString());
};

/* OAuth callback boundary */
export const handleTwitchCallback = async (
  url: URL,
  response: ServerResponse,
) => {
  const error = url.searchParams.get("error");

  if (error) {
    redirectToOAuthNotice(response, error);
    return;
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state || !consumeOauthState(state)) {
    redirectToOAuthNotice(response, "invalid_oauth_state");
    return;
  }

  const secrets = readLocalSecrets();
  const twitch = secrets.twitch;

  if (!twitch.clientId || !twitch.clientSecret) {
    redirectToOAuthNotice(response, "missing_client_credentials");
    return;
  }

  let tokens: TwitchOAuthTokenResponse & { refresh_token: string };

  try {
    tokens = await exchangeCode({
      code,
      clientId: twitch.clientId,
      clientSecret: twitch.clientSecret,
      redirectUri: twitch.redirectUri ?? defaultRedirectUri,
    });
  } catch (error) {
    logger.warn(
      { error: redactSecrets(error) },
      "Twitch OAuth token exchange failed",
    );
    redirectToOAuthNotice(response, classifyOAuthExchangeError(error));
    return;
  }

  let validation: Awaited<ReturnType<typeof validateToken>>;

  try {
    validation = await validateToken(tokens.access_token);
  } catch (error) {
    logger.warn(
      { error: redactSecrets(error) },
      "Twitch OAuth token validation failed after exchange",
    );
    redirectToOAuthNotice(response, "oauth_token_validation_failed");
    return;
  }
  const expiresAt = getTokenExpiresAt(tokens.expires_in);
  const tokenLogin = normalizeTwitchLogin(validation.login);
  const configuredBotLogin = twitch.botLogin
    ? normalizeTwitchLogin(twitch.botLogin)
    : undefined;
  const tokenMatchesConfiguredBot =
    !configuredBotLogin || configuredBotLogin === tokenLogin;

  if (!tokenMatchesConfiguredBot) {
    writeLocalSecrets({
      ...secrets,
      twitch: clearTwitchAuthorization(twitch),
    });
    const params = new URLSearchParams({
      error: "wrong_bot_account",
      connected_login: tokenLogin,
      expected_login: configuredBotLogin ?? "",
    });
    redirect(response, `/?window=settings&${params.toString()}`);
    return;
  }

  writeLocalSecrets({
    ...secrets,
    twitch: {
      ...twitch,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      scopes: validation.scopes,
      tokenExpiresAt: expiresAt,
      tokenValidatedAt: new Date().toISOString(),
      botLogin: configuredBotLogin || tokenLogin,
      botUserId: tokenMatchesConfiguredBot ? validation.user_id : undefined,
    },
  });

  void queueLaunchPreparation("oauth_connected");
  redirect(response, "/?window=settings&connected=1");
};

class TwitchOAuthExchangeError extends Error {
  constructor(
    readonly status: number,
    readonly twitchMessage: string,
    readonly body: string,
  ) {
    super(`Twitch OAuth exchange failed: ${status} ${twitchMessage}`);
    this.name = "TwitchOAuthExchangeError";
  }
}

export const classifyOAuthExchangeError = (error: unknown) => {
  if (error instanceof TwitchOAuthExchangeError) {
    if (
      error.status === 403 &&
      /invalid client secret/i.test(error.twitchMessage)
    ) {
      return "invalid_client_secret";
    }

    if (/invalid client/i.test(error.twitchMessage)) {
      return "invalid_client_credentials";
    }

    if (/redirect/i.test(error.twitchMessage)) {
      return "redirect_uri_mismatch";
    }
  }

  return "oauth_exchange_failed";
};

export const parseTwitchOAuthErrorMessage = (body: string) => {
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown };
    const message =
      typeof parsed.message === "string" ? parsed.message : parsed.error;
    return typeof message === "string" && message.trim()
      ? message.trim()
      : body;
  } catch {
    return body;
  }
};

/* OAuth exchange boundary */
export const exchangeCode = async (input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<TwitchOAuthTokenResponse & { refresh_token: string }> => {
  const params = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
  });
  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new TwitchOAuthExchangeError(
      response.status,
      parseTwitchOAuthErrorMessage(body),
      body,
    );
  }

  const tokens = (await response.json()) as Partial<TwitchOAuthTokenResponse>;

  if (!tokens.access_token || !tokens.refresh_token || !tokens.expires_in) {
    throw new Error(
      "Twitch OAuth exchange did not return usable access and refresh tokens.",
    );
  }

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in,
    scope: tokens.scope ?? [],
    token_type: tokens.token_type ?? "bearer",
  };
};
