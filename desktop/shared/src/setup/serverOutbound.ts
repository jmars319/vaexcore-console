import {
  RelayChatClient,
  relayConfigReadiness,
  startRelayHostedInstall,
  type RelayBotReadinessReport,
} from "../twitch/relayTransport";
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
import { TwitchChatSender } from "../twitch/sendMessage";
import {
  buildGiveawayAnnouncementForPhase,
  buildGiveawayStatusMessage,
} from "./serverGiveawayActions";
import {
  getGiveawayState,
  latestOutboundForActions,
} from "./serverGiveawayState";
import { getGiveawayAnnouncementPhase } from "./serverGiveawayTemplates";
import { enqueueChatMessage } from "./serverOperatorConfig";
import {
  giveawayTemplates,
  giveawaysService,
  logger,
  outboundHistory,
} from "./serverState";

export const getOutboundMessages = () => ({
  ok: true,
  summary: outboundHistory.summary(),
  messages: outboundHistory.list(),
});

export const resendOutboundMessage = async (id: string | undefined) => {
  const record = outboundHistory.find(id) ?? outboundHistory.latestFailed();

  if (!record) {
    const outbound = getOutboundMessages();
    return {
      ...outbound,
      ok: false,
      error: "No failed outbound message is available to resend.",
    };
  }

  const result = await enqueueChatMessage(record.message, {
    category: record.category,
    action: record.action,
    importance: record.importance,
    giveawayId: record.giveawayId,
    resentFrom: record.id,
  });

  if (result.ok && typeof result.outboundMessageId === "string") {
    outboundHistory.markResent(record.id, result.outboundMessageId);
  }

  const outbound = getOutboundMessages();

  return {
    ...outbound,
    ...result,
    resentFrom: record.id,
  };
};

export const resendGiveawayAnnouncement = async (
  action: string | undefined,
) => {
  const phase = getGiveawayAnnouncementPhase(action);

  if (!phase) {
    return {
      ...getGiveawayState(),
      ok: false,
      error: "Unknown giveaway announcement phase.",
    };
  }

  const state = giveawaysService.getLatestGiveawayState();

  if (!state.giveaway) {
    return {
      ...getGiveawayState(),
      ok: false,
      error: "No giveaway is available for announcement resend.",
    };
  }

  const existing = latestOutboundForActions(state.giveaway.id, phase.actions);
  const announcement = existing
    ? {
        message: existing.message,
        metadata: {
          category: "giveaway" as const,
          action: existing.action || phase.actions[0],
          importance: existing.importance,
          giveawayId: state.giveaway.id,
          resentFrom: existing.id,
        },
        resentFrom: existing.id,
      }
    : buildGiveawayAnnouncementForPhase(phase, state);

  if (!announcement) {
    return {
      ...getGiveawayState(),
      ok: false,
      error: `Cannot reconstruct the ${phase.label} announcement from current giveaway state.`,
    };
  }

  const result = await enqueueChatMessage(
    announcement.message,
    announcement.metadata,
  );
  const resentFrom =
    "resentFrom" in announcement ? announcement.resentFrom : undefined;

  if (result.ok && resentFrom && typeof result.outboundMessageId === "string") {
    outboundHistory.markResent(resentFrom, result.outboundMessageId);
  }

  return {
    ...getGiveawayState(),
    ...result,
    action: phase.actions[0],
    resentFrom,
  };
};

export const resendCriticalGiveawayMessage = async () => {
  const record = latestFailedCriticalGiveawayMessage();

  if (!record) {
    return {
      ...getGiveawayState(),
      ok: false,
      error:
        "No failed critical giveaway message is available for panic resend.",
    };
  }

  const result = await resendOutboundMessage(record.id);

  return {
    ...getGiveawayState(),
    ...result,
    resentAction: record.action,
    resentFrom: record.id,
  };
};

export const latestFailedCriticalGiveawayMessage = () => {
  const state = giveawaysService.getLatestGiveawayState();
  const currentGiveawayId = state.giveaway?.id;
  const failedCritical = outboundHistory
    .list()
    .filter(
      (message) =>
        message.category === "giveaway" &&
        message.importance === "critical" &&
        message.status === "failed",
    );

  if (currentGiveawayId !== undefined) {
    const currentFailure = failedCritical.find(
      (message) => Number(message.giveawayId) === Number(currentGiveawayId),
    );

    if (currentFailure) {
      return currentFailure;
    }
  }

  return failedCritical[0];
};

export const sendCurrentGiveawayStatus = async () => {
  const state = giveawaysService.getLatestGiveawayState();
  const message = buildGiveawayStatusMessage(state);

  if (!state.giveaway || !message) {
    return {
      ...getGiveawayState(),
      ok: false,
      error: "No giveaway is available for a status message.",
    };
  }

  const result = await enqueueChatMessage(message, {
    category: "giveaway",
    action: "status",
    importance: "normal",
    giveawayId: state.giveaway.id,
  });

  return {
    ...getGiveawayState(),
    ...result,
    message,
  };
};

export const sendConfiguredChatMessage = async (message: string) => {
  const secrets = readLocalSecrets();
  const twitch = secrets.twitch;
  const relay = secrets.relay;

  if (relay.twitchTransportMode === "relay-chatbot") {
    return new RelayChatClient({
      baseUrl: relay.baseUrl,
      installationId: relay.installationId,
      consoleToken: relay.consoleToken,
    }).send(message);
  }

  if (
    !twitch.clientId ||
    !twitch.accessToken ||
    !twitch.broadcasterUserId ||
    !twitch.botUserId
  ) {
    return {
      status: "failed" as const,
      failureCategory: "config" as const,
      reason: "Setup is missing resolved Twitch IDs.",
    };
  }

  const result = await createSetupChatSender(twitch).send(message);
  const structured = typeof result === "string" ? { status: result } : result;

  if (structured.status !== "failed" || structured.failureCategory !== "auth") {
    return result;
  }

  try {
    const refreshed = await refreshStoredTwitchToken({
      secrets,
      expectedClientId: twitch.clientId,
      expectedBotUserId: twitch.botUserId,
      expectedBotLogin: twitch.botLogin,
      logger,
    });

    logger.warn(
      { failureCategory: structured.failureCategory },
      "Outbound chat auth failed; token refreshed and message will be retried once",
    );

    return createSetupChatSender(refreshed.twitch).send(message);
  } catch (error) {
    return {
      status: "failed" as const,
      failureCategory: "auth" as const,
      reason: safeErrorMessage(
        error,
        "Twitch token refresh failed. Reconnect Twitch.",
      ),
    };
  }
};

export const createSetupChatSender = (twitch: LocalSecrets["twitch"]) => {
  if (
    !twitch.clientId ||
    !twitch.accessToken ||
    !twitch.broadcasterUserId ||
    !twitch.botUserId
  ) {
    throw new Error("Setup is missing resolved Twitch IDs.");
  }

  return new TwitchChatSender({
    clientId: twitch.clientId,
    accessToken: twitch.accessToken,
    broadcasterId: twitch.broadcasterUserId,
    senderId: twitch.botUserId,
    logger,
  });
};

export const getGiveawayTemplates = () => ({
  ok: true,
  templates: giveawayTemplates.list(),
  placeholders: [
    "title",
    "keyword",
    "winnerCount",
    "entryCount",
    "displayName",
    "winners",
    "winnerPlural",
    "drawnCount",
    "requestedCount",
    "partial",
    "rerolled",
    "replacement",
  ],
});
