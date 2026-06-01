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
  getTwitchUserByLogin,
  optionalCreatorOpsScopes,
  optionalModerationScopes,
  requiredTwitchScopes,
  validateToken,
} from "../twitch/validate";
import { basename, dirname, join, resolve } from "node:path";
import { getBotProcessSnapshot } from "./serverBotProcess";
import {
  createLocalChatMessage,
  localUiActor,
} from "./serverCommandSimulation";
import { summarizeQueueHealth } from "./serverDiagnostics";
import { wait } from "./serverDiscordRelay";
import {
  botProcess,
  chatQueue,
  featureGates,
  moderationService,
  outboundHistory,
} from "./serverState";
import type { LocalChatRole } from "./serverCommandSimulation";

export const getModerationState = () => ({
  ...moderationService.getState(),
  enforcement: getModerationEnforcementStatus(),
});

export const getModerationEnforcementStatus = () => {
  const twitch = readLocalSecrets().twitch;
  const hasScope = (scope: string) => (twitch.scopes ?? []).includes(scope);
  const deleteScope = optionalModerationScopes[0];
  const timeoutScope = optionalModerationScopes[1];
  const identityReady = Boolean(
    twitch.accessToken &&
    twitch.clientId &&
    twitch.broadcasterUserId &&
    twitch.botUserId,
  );
  const deleteReady = identityReady && hasScope(deleteScope);
  const timeoutReady = identityReady && hasScope(timeoutScope);
  const missingScopes = optionalModerationScopes.filter(
    (scope) => !hasScope(scope),
  );

  return {
    ok: true,
    mode: featureGates.get("moderation_filters").mode,
    deleteMessages: {
      available: deleteReady,
      scope: deleteScope,
      reason: deleteReady
        ? "Message deletion is available for live moderation hits."
        : identityReady
          ? `Reconnect Twitch with ${deleteScope} to enable message deletion.`
          : "Complete Twitch setup and validation before message deletion can run.",
    },
    timeoutUsers: {
      available: timeoutReady,
      scope: timeoutScope,
      reason: timeoutReady
        ? "Timeouts are available for live moderation hits."
        : identityReady
          ? `Reconnect Twitch with ${timeoutScope} to enable timeouts.`
          : "Complete Twitch setup and validation before timeouts can run.",
    },
    missingScopes,
    nextAction: missingScopes.length
      ? `Reconnect Twitch to grant optional moderation scope(s): ${missingScopes.join(", ")}.`
      : "Choose delete or timeout actions per filter, test locally, then enable moderation live.",
  };
};

export const saveModerationSettings = (body: unknown) => {
  try {
    return moderationService.saveSettings(body, localUiActor);
  } catch (error) {
    return {
      ...getModerationState(),
      ok: false,
      error: safeErrorMessage(error, "Moderation settings save failed"),
    };
  }
};

export const saveModerationTerm = (body: unknown) => {
  try {
    return moderationService.saveTerm(body, localUiActor);
  } catch (error) {
    return {
      ...getModerationState(),
      ok: false,
      error: safeErrorMessage(error, "Blocked phrase save failed"),
    };
  }
};

export const setModerationTermEnabled = (body: {
  id?: number;
  enabled?: boolean;
}) => {
  try {
    return moderationService.setTermEnabled(
      parseSafeInteger(body.id, {
        field: "Blocked phrase ID",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
      Boolean(body.enabled),
      localUiActor,
    );
  } catch (error) {
    return {
      ...getModerationState(),
      ok: false,
      error: safeErrorMessage(error, "Blocked phrase update failed"),
    };
  }
};

export const deleteModerationTerm = (id: number | undefined) => {
  try {
    return moderationService.deleteTerm(
      parseSafeInteger(id, {
        field: "Blocked phrase ID",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
      localUiActor,
    );
  } catch (error) {
    return {
      ...getModerationState(),
      ok: false,
      error: safeErrorMessage(error, "Blocked phrase delete failed"),
    };
  }
};

export const saveModerationAllowedLink = (body: unknown) => {
  try {
    return moderationService.saveAllowedLink(body, localUiActor);
  } catch (error) {
    return {
      ...getModerationState(),
      ok: false,
      error: safeErrorMessage(error, "Allowed domain save failed"),
    };
  }
};

export const setModerationAllowedLinkEnabled = (body: {
  id?: number;
  enabled?: boolean;
}) => {
  try {
    return moderationService.setAllowedLinkEnabled(
      parseSafeInteger(body.id, {
        field: "Allowed domain ID",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
      Boolean(body.enabled),
      localUiActor,
    );
  } catch (error) {
    return {
      ...getModerationState(),
      ok: false,
      error: safeErrorMessage(error, "Allowed domain update failed"),
    };
  }
};

export const deleteModerationAllowedLink = (id: number | undefined) => {
  try {
    return moderationService.deleteAllowedLink(
      parseSafeInteger(id, {
        field: "Allowed domain ID",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
      localUiActor,
    );
  } catch (error) {
    return {
      ...getModerationState(),
      ok: false,
      error: safeErrorMessage(error, "Allowed domain delete failed"),
    };
  }
};

export const saveModerationBlockedLink = (body: unknown) => {
  try {
    return moderationService.saveBlockedLink(body, localUiActor);
  } catch (error) {
    return {
      ...getModerationState(),
      ok: false,
      error: safeErrorMessage(error, "Blocked domain save failed"),
    };
  }
};

export const setModerationBlockedLinkEnabled = (body: {
  id?: number;
  enabled?: boolean;
}) => {
  try {
    return moderationService.setBlockedLinkEnabled(
      parseSafeInteger(body.id, {
        field: "Blocked domain ID",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
      Boolean(body.enabled),
      localUiActor,
    );
  } catch (error) {
    return {
      ...getModerationState(),
      ok: false,
      error: safeErrorMessage(error, "Blocked domain update failed"),
    };
  }
};

export const deleteModerationBlockedLink = (id: number | undefined) => {
  try {
    return moderationService.deleteBlockedLink(
      parseSafeInteger(id, {
        field: "Blocked domain ID",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
      localUiActor,
    );
  } catch (error) {
    return {
      ...getModerationState(),
      ok: false,
      error: safeErrorMessage(error, "Blocked domain delete failed"),
    };
  }
};

export const grantModerationLinkPermit = (body: unknown) => {
  try {
    return moderationService.grantLinkPermit(body, localUiActor);
  } catch (error) {
    return {
      ...getModerationState(),
      ok: false,
      error: safeErrorMessage(error, "Link permit grant failed"),
    };
  }
};

export const simulateModeration = (body: {
  actor?: string;
  role?: LocalChatRole;
  text?: string;
}) => {
  try {
    const actor = createLocalChatMessage({
      login: body.actor || "viewer",
      role: body.role ?? "viewer",
      text: body.text || "",
    });
    const result = moderationService.evaluate(actor, { consumePermits: false });
    const enforcement = getModerationEnforcementStatus();
    const enforcementPlan = result.hit
      ? moderationService.planEnforcement(actor, result.hit, {
          canDeleteMessages: enforcement.deleteMessages.available,
          canTimeoutUsers: enforcement.timeoutUsers.available,
          deleteUnavailableReason: enforcement.deleteMessages.reason,
          timeoutUnavailableReason: enforcement.timeoutUsers.reason,
        })
      : undefined;

    return {
      ...getModerationState(),
      ok: true,
      result,
      enforcementPlan,
    };
  } catch (error) {
    return {
      ...getModerationState(),
      ok: false,
      error: safeErrorMessage(error, "Moderation simulation failed"),
    };
  }
};

export const getTimerSendReadiness = () => {
  const gate = featureGates.get("timers");
  const queue = chatQueue.snapshot();
  const queueHealth = summarizeQueueHealth(queue, outboundHistory.summary());
  const checks = [
    {
      name: "Feature gate",
      ok: gate.mode === "live",
      detail:
        gate.mode === "live"
          ? "Timers are live."
          : gate.mode === "test"
            ? "Timers are in test mode and will not send to Twitch chat."
            : "Timers are off.",
    },
    {
      name: "Live bot",
      ok: Boolean(botProcess.child && getBotProcessSnapshot().running),
      detail:
        botProcess.child && getBotProcessSnapshot().running
          ? "Live bot is running."
          : "Start the live bot before timers can send.",
    },
    {
      name: "EventSub chat",
      ok: botProcess.eventSubConnected && botProcess.chatSubscriptionActive,
      detail:
        botProcess.eventSubConnected && botProcess.chatSubscriptionActive
          ? "EventSub chat is connected."
          : "Timers wait for EventSub chat to be connected.",
    },
    {
      name: "Live chat confirmation",
      ok: botProcess.liveChatConfirmed,
      detail: botProcess.liveChatConfirmed
        ? "Live chat was confirmed with !ping."
        : "Timers wait for live chat confirmation. Type !ping in chat.",
    },
    {
      name: "Outbound queue",
      ok: queueHealth.status === "clear",
      detail:
        queueHealth.status === "clear"
          ? "Outbound queue is clear."
          : queueHealth.nextAction,
    },
  ];

  if (gate.mode !== "live") {
    return {
      ok: false,
      reason:
        gate.mode === "test"
          ? "Timers are in test mode and will not send to Twitch chat."
          : "Timers are off. Move the Timers feature gate to Live before sending.",
      nextAction:
        gate.mode === "test"
          ? "Move Timers to Live when you are ready for Twitch delivery."
          : "Use the Timers feature gate card to switch to Live.",
      gateMode: gate.mode,
      checks,
    };
  }

  if (!botProcess.child || !getBotProcessSnapshot().running) {
    return {
      ok: false,
      reason: "Start the live bot before timers can send.",
      nextAction: "Start Bot from the setup console.",
      gateMode: gate.mode,
      checks,
    };
  }

  if (!botProcess.eventSubConnected || !botProcess.chatSubscriptionActive) {
    return {
      ok: false,
      reason: "Timers wait for EventSub chat to be connected.",
      nextAction:
        "Wait for EventSub chat subscription to connect or restart the bot.",
      gateMode: gate.mode,
      checks,
    };
  }

  if (!botProcess.liveChatConfirmed) {
    return {
      ok: false,
      reason: "Timers wait for live chat confirmation. Type !ping in chat.",
      nextAction: "Type !ping in Twitch chat and wait for pong.",
      gateMode: gate.mode,
      checks,
    };
  }

  if (queueHealth.status !== "clear") {
    return {
      ok: false,
      reason: queueHealth.nextAction,
      nextAction: queueHealth.nextAction,
      gateMode: gate.mode,
      checks,
    };
  }

  return {
    ok: true,
    reason: "Timers can queue.",
    nextAction: "No action needed.",
    gateMode: gate.mode,
    checks,
  };
};
