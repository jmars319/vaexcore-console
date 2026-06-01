import type { ChatMessage } from "../../core/chatMessage";
import { PermissionLevel } from "../../core/permissions";
import {
  assertNoSecretLikeContent,
  limits,
  normalizeCommandName,
  parseSafeInteger,
  sanitizeChatMessage,
} from "../../core/security";

const permissionValues = new Set(Object.values(PermissionLevel));

export const normalizePermission = (value: unknown) => {
  const permission = typeof value === "string" ? value : PermissionLevel.Viewer;

  if (!permissionValues.has(permission as PermissionLevel)) {
    throw new Error(
      "Permission must be viewer, moderator, broadcaster, or admin.",
    );
  }

  return permission as PermissionLevel;
};

export const normalizeCooldown = (
  value: unknown,
  fallback: number,
  field: string,
) =>
  parseSafeInteger(value, {
    field,
    fallback,
    min: 0,
    max: limits.customCommandCooldownMaxSeconds,
  });

export const normalizeAliasList = (value: unknown) => {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\n]/)
      : [];
  const aliases = raw
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .map((item) => normalizeCommandName(item, "Alias"))
    .filter(Boolean);
  const unique = [...new Set(aliases)];

  if (unique.length > limits.customCommandAliasesMax) {
    throw new Error(`Use ${limits.customCommandAliasesMax} aliases or fewer.`);
  }

  return unique;
};

export const normalizeResponseList = (value: unknown) => {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\n+/)
      : [];
  const responses = raw
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .map((item) => {
      const response = sanitizeChatMessage(item);
      assertNoSecretLikeContent(response, "Custom command response");
      return response;
    })
    .filter(Boolean);

  if (responses.length === 0) {
    throw new Error("At least one response is required.");
  }

  if (responses.length > limits.customCommandResponsesMax) {
    throw new Error(
      `Use ${limits.customCommandResponsesMax} response variants or fewer.`,
    );
  }

  return responses;
};

export const sanitizePreviewArgs = (value: unknown) =>
  typeof value === "string"
    ? value
        .trim()
        .replace(/[\r\n]+/g, " ")
        .slice(0, 200)
    : "";

export const userKey = (message: ChatMessage) =>
  message.userId || message.userLogin;

export const timestamp = () => new Date().toISOString();

export const previewActor: ChatMessage = {
  id: "preview",
  text: "",
  userId: "preview",
  userLogin: "viewer",
  userDisplayName: "Viewer",
  broadcasterUserId: "preview-broadcaster",
  badges: [],
  isBroadcaster: false,
  isMod: false,
  isVip: false,
  isSubscriber: false,
  source: "local",
  receivedAt: new Date(),
};
