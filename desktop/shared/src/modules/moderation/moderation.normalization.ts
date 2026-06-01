import type { ChatMessage } from "../../core/chatMessage";
import {
  assertNoSecretLikeContent,
  limits,
  normalizeLogin,
  parseSafeInteger,
  redactSecretText,
  sanitizeChatMessage,
  sanitizeText,
} from "../../core/security";
import {
  moderationLimits,
  type ModerationAction,
  type ModerationSettings,
} from "./moderation.types";

const moderationActions = new Set<ModerationAction>([
  "warn",
  "delete",
  "timeout",
]);

export { limits, normalizeLogin, parseSafeInteger };

export const normalizeBlockedTerm = (value: unknown) => {
  const term = sanitizeText(value, {
    field: "Blocked phrase",
    maxLength: moderationLimits.termLength,
    required: true,
  }).toLowerCase();
  assertNoSecretLikeContent(term, "Blocked phrase");
  return term;
};

export const normalizeAllowedDomain = (
  value: unknown,
  field = "Allowed domain",
) => {
  let domain = sanitizeText(value, {
    field,
    maxLength: moderationLimits.domainLength,
    required: true,
  }).toLowerCase();

  assertNoSecretLikeContent(domain, field);
  domain =
    domain
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/)[0] ?? "";
  domain = domain.replace(/:\d+$/, "").trim();

  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
      domain,
    )
  ) {
    throw new Error(`${field} must be a valid domain, such as example.com.`);
  }

  return domain;
};

export const normalizeWarningMessage = (value: unknown) => {
  const message = sanitizeChatMessage(value);
  assertNoSecretLikeContent(message, "Moderation warning");
  return message;
};

export const booleanValue = (value: unknown, fallback: boolean) =>
  value === undefined ? fallback : Boolean(value);

export const normalizeModerationAction = (
  value: unknown,
  fallback: ModerationAction,
) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (
    typeof value === "string" &&
    moderationActions.has(value as ModerationAction)
  ) {
    return value as ModerationAction;
  }

  throw new Error("Moderation action must be warn, delete, or timeout.");
};

export const normalizeStoredModerationAction = (
  value: unknown,
): ModerationAction => normalizeModerationAction(value, "warn");

export const clampTimeoutSeconds = (value: unknown) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 60;
  }

  return Math.min(
    moderationLimits.timeoutMaxSeconds,
    Math.max(moderationLimits.timeoutMinSeconds, Math.trunc(parsed)),
  );
};

export const clampEscalationWindowSeconds = (value: unknown) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 300;
  }

  return Math.min(
    moderationLimits.escalationMaxWindowSeconds,
    Math.max(moderationLimits.escalationMinWindowSeconds, Math.trunc(parsed)),
  );
};

export const clampEscalationHitCount = (value: unknown, fallback: number) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(
    moderationLimits.escalationMaxHitCount,
    Math.max(2, Math.trunc(parsed)),
  );
};

export const clampBotShieldScoreThreshold = (value: unknown) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 70;
  }

  return Math.min(
    moderationLimits.botShieldMaxScore,
    Math.max(moderationLimits.botShieldMinScore, Math.trunc(parsed)),
  );
};

export const ratioValue = (value: unknown, fallback: number, field: string) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0.1 || parsed > 1) {
    throw new Error(`${field} must be between 0.1 and 1.`);
  }

  return parsed;
};

export const findLinkDomains = (text: string) => {
  const matches = text.matchAll(
    /\b(?:https?:\/\/)?(?:www\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)(?:\/[^\s]*)?/gi,
  );

  return [...matches]
    .map((match) => normalizeMatchedDomain(match[1] ?? ""))
    .filter(Boolean);
};

export const normalizeMatchedDomain = (domain: string) =>
  domain.toLowerCase().replace(/^www\./, "");

export const unique = <T>(items: T[]) => [...new Set(items)];

export const domainMatchesAllowed = (domain: string, allowedDomain: string) =>
  domain === allowedDomain || domain.endsWith(`.${allowedDomain}`);

export const matchBlockedTerm = (text: string, term: string) => {
  const normalized = term.trim();

  if (!normalized) {
    return undefined;
  }

  const wildcard = normalized.includes("*");
  const escaped = escapeRegex(normalized).replace(/\\\*/g, "[\\p{L}\\p{N}_-]*");
  const flexibleSpaces = escaped.replace(/\s+/g, "\\s+");
  const regex = new RegExp(
    `(^|[^\\p{L}\\p{N}_])${flexibleSpaces}(?=$|[^\\p{L}\\p{N}_])`,
    "iu",
  );

  if (!regex.test(text)) {
    return undefined;
  }

  return {
    term: normalized,
    mode: wildcard
      ? "wildcard"
      : normalized.includes(" ")
        ? "phrase"
        : "whole-word",
  };
};

export const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const isExcessiveCaps = (text: string, settings: ModerationSettings) => {
  const letters = [...text].filter((char) => /[a-z]/i.test(char));

  if (letters.length < settings.capsMinLength) {
    return false;
  }

  const uppercase = letters.filter(
    (char) => char === char.toUpperCase(),
  ).length;
  return uppercase / letters.length >= settings.capsRatio;
};

export const isExcessiveSymbols = (
  text: string,
  settings: ModerationSettings,
) => {
  const visible = text.replace(/\s+/g, "");

  if (visible.length < settings.symbolMinLength) {
    return false;
  }

  const symbolCount = [...visible].filter((char) =>
    /[^\p{L}\p{N}_]/u.test(char),
  ).length;
  return (
    symbolCount / visible.length >= settings.symbolRatio ||
    /([^\p{L}\p{N}\s_])\1{7,}/u.test(text)
  );
};

export const normalizeRepeatText = (text: string) =>
  text
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .slice(0, limits.chatMessageLength);

export const renderWarning = (
  template: string,
  message: ChatMessage,
  reason: string,
) =>
  sanitizeChatMessage(
    template
      .replace(/\{user\}/g, message.userDisplayName || message.userLogin)
      .replace(/\{login\}/g, message.userLogin)
      .replace(/\{reason\}/g, reason),
  );

export const messagePreview = (message: string) =>
  redactSecretText(message).slice(0, 180);

export const userKey = (message: ChatMessage) =>
  message.userId || message.userLogin;

export const timestamp = () => new Date().toISOString();
