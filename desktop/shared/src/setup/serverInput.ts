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
import { URL } from "node:url";
import { host, oauthStates } from "./serverState";

export const normalizeLogin = (value: string | undefined) => {
  const login = extractLoginInput(value);
  return login ? normalizeTwitchLogin(login) : undefined;
};

export const extractLoginInput = (value: string | undefined) => {
  const trimmed = value?.trim().replace(/^@/, "");

  if (!trimmed) {
    return undefined;
  }

  const maybeUrl = trimmed.match(/^https?:\/\//i)
    ? trimmed
    : trimmed.match(/^(www\.)?twitch\.tv\//i)
      ? `https://${trimmed}`
      : undefined;

  if (!maybeUrl) {
    return trimmed;
  }

  try {
    const parsed = new URL(maybeUrl);
    const host = parsed.hostname.toLowerCase();
    if (host === "twitch.tv" || host === "www.twitch.tv") {
      return parsed.pathname.split("/").filter(Boolean)[0];
    }
  } catch {
    return trimmed;
  }

  return trimmed;
};

export const sanitizeOptionalText = (
  value: string | undefined,
  field: string,
  maxLength: number,
) =>
  value?.trim()
    ? sanitizeText(value, { field, maxLength, required: true })
    : undefined;

export const sanitizeRedirectUri = (value: string | undefined) => {
  const redirectUri = sanitizeText(value || defaultRedirectUri, {
    field: "Redirect URI",
    maxLength: 200,
    required: true,
  });
  const parsed = new URL(redirectUri);

  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "localhost" ||
    parsed.port !== "3434" ||
    parsed.pathname !== "/auth/twitch/callback"
  ) {
    throw new Error(
      "Redirect URI must be http://localhost:3434/auth/twitch/callback.",
    );
  }

  return parsed.toString();
};

export const sanitizeRelayBaseUrl = (value: string | undefined) => {
  const baseUrl = sanitizeOptionalText(value, "Relay URL", 300);

  if (!baseUrl) {
    return undefined;
  }

  const parsed = new URL(baseUrl);

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Relay URL must start with http:// or https://.");
  }

  return parsed.toString().replace(/\/+$/, "");
};

export const consumeOauthState = (state: string) => {
  const expiresAt = oauthStates.get(state);
  oauthStates.delete(state);

  for (const [storedState, storedExpiresAt] of oauthStates.entries()) {
    if (storedExpiresAt < Date.now()) {
      oauthStates.delete(storedState);
    }
  }

  return Boolean(expiresAt && expiresAt >= Date.now());
};

export const valueOrExisting = (
  value: string | undefined,
  existing: string | undefined,
) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : existing;
};

export const valueOrExistingLogin = (
  input: Record<string, string>,
  field: "broadcasterLogin" | "botLogin",
  existing: string | undefined,
) =>
  hasSubmittedField(input, field) ? normalizeLogin(input[field]) : existing;

export const hasSubmittedField = (
  input: Record<string, string>,
  field: string,
) => Object.prototype.hasOwnProperty.call(input, field);

export const clearTwitchAuthorization = (
  twitch: LocalSecrets["twitch"],
  options: { clearBroadcasterIdentity?: boolean } = {},
): LocalSecrets["twitch"] => ({
  ...twitch,
  accessToken: undefined,
  refreshToken: undefined,
  scopes: [],
  tokenExpiresAt: undefined,
  tokenValidatedAt: undefined,
  botUserId: undefined,
  broadcasterUserId: options.clearBroadcasterIdentity
    ? undefined
    : twitch.broadcasterUserId,
});

export const maskToken = (token: string) =>
  token.length <= 8 ? "********" : `${token.slice(0, 4)}...${token.slice(-4)}`;
