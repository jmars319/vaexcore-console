import type { ChatMessage } from "../../core/chatMessage";
import { writeAuditLog } from "../../core/auditLog";
import { messagePreview, timestamp, userKey } from "./moderation.normalization";
import { sanitizeText } from "../../core/security";
import {
  moderationLimits,
  type ModerationEnforcementCapabilities,
  type ModerationEnforcementOutcome,
  type ModerationEnforcementPlan,
  type ModerationEvaluation,
  type ModerationServiceContext,
} from "./moderation.types";

export const planModerationEnforcement = (
  message: ChatMessage,
  hit: NonNullable<ModerationEvaluation["hit"]>,
  capabilities: ModerationEnforcementCapabilities,
): ModerationEnforcementPlan => {
  if (hit.action === "warn") {
    return {
      status: "skipped",
      action: "warn",
      reason: "Filter action is warn only.",
    };
  }

  if (message.source !== "eventsub") {
    return {
      status: "blocked",
      action: hit.action,
      reason: "Enforcement only runs for live Twitch chat messages.",
    };
  }

  if (message.isBroadcaster || message.isMod) {
    return {
      status: "blocked",
      action: hit.action,
      reason:
        "Broadcaster and moderator messages are never deleted or timed out by filters.",
    };
  }

  if (hit.action === "delete") {
    if (!message.id) {
      return {
        status: "blocked",
        action: "delete",
        reason: "Twitch message ID was missing.",
      };
    }

    if (!capabilities.canDeleteMessages) {
      return {
        status: "blocked",
        action: "delete",
        reason:
          capabilities.deleteUnavailableReason ??
          "Delete scope is unavailable.",
      };
    }

    return {
      status: "ready",
      action: "delete",
      reason: "Delete scope and message ID are available.",
    };
  }

  if (!message.userId) {
    return {
      status: "blocked",
      action: "timeout",
      reason: "Twitch user ID was missing.",
      durationSeconds: hit.timeoutSeconds,
    };
  }

  if (!capabilities.canTimeoutUsers) {
    return {
      status: "blocked",
      action: "timeout",
      reason:
        capabilities.timeoutUnavailableReason ??
        "Timeout scope is unavailable.",
      durationSeconds: hit.timeoutSeconds,
    };
  }

  return {
    status: "ready",
    action: "timeout",
    reason: "Timeout scope and user ID are available.",
    durationSeconds: hit.timeoutSeconds,
  };
};

export const recordModerationEnforcement = (
  context: ModerationServiceContext,
  message: ChatMessage,
  hit: NonNullable<ModerationEvaluation["hit"]>,
  outcome: ModerationEnforcementOutcome,
) => {
  const now = timestamp();
  writeAuditLog(
    context.db,
    message,
    `moderation.${outcome.action}_${outcome.status}`,
    `moderation:${outcome.action}`,
    {
      filterTypes: hit.filterTypes,
      action: outcome.action,
      status: outcome.status,
      reason: sanitizeText(outcome.reason, {
        field: "Moderation enforcement reason",
        maxLength: moderationLimits.detailLength,
      }),
      userLogin: message.userLogin,
      messageId: message.id ?? "",
      durationSeconds: outcome.durationSeconds,
      statusCode: outcome.statusCode,
      detail: hit.detail,
      messagePreview: messagePreview(message.text),
    },
    { createdAt: now },
  );
};

export const shouldSendModerationWarning = (
  context: ModerationServiceContext,
  message: ChatMessage,
  hit: NonNullable<ModerationEvaluation["hit"]>,
) => {
  if (hit.silent) {
    return false;
  }

  const key = `${userKey(message)}:${hit.filterTypes.join(",")}`;
  const now = Date.now();
  const last = context.lastWarningAt.get(key) ?? 0;

  if (now - last < moderationLimits.warningCooldownMs) {
    return false;
  }

  context.lastWarningAt.set(key, now);
  return true;
};
