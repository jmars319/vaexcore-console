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
  TwitchCreatorOpsClient,
  TwitchCreatorOpsError,
  type AnnouncementInput,
  type EndPredictionInput,
  type PollInput,
  type PredictionInput,
} from "../twitch/creatorOps";
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
import { getRecentAuditLogs, writeAuditLog } from "../core/auditLog";
import { localUiActor } from "./serverCommandSimulation";
import { objectInput, optionalInputString } from "./serverDiscordSetup";
import { db, logger } from "./serverState";

export const getTwitchCreatorOpsState = () => {
  const secrets = readLocalSecrets();
  const twitch = secrets.twitch;
  const hasScope = (scope: string) => (twitch.scopes ?? []).includes(scope);
  const identityReady = Boolean(
    twitch.clientId &&
    twitch.accessToken &&
    twitch.broadcasterUserId &&
    twitch.botUserId,
  );
  const scopeChecks = optionalCreatorOpsScopes.map((scope) => ({
    scope,
    ok: hasScope(scope),
  }));
  const logs = getRecentAuditLogs(db, 100).filter((log) =>
    log.action.startsWith("twitch.creator_ops."),
  );

  return {
    ok: true,
    readiness: {
      ready: identityReady && scopeChecks.every((scope) => scope.ok),
      identityReady,
      broadcasterLogin: twitch.broadcasterLogin ?? "",
      botLogin: twitch.botLogin ?? "",
      missingScopes: scopeChecks
        .filter((scope) => !scope.ok)
        .map((scope) => scope.scope),
      checks: [
        {
          name: "Twitch identity",
          ok: identityReady,
          detail: identityReady
            ? "Twitch bot and broadcaster IDs are saved."
            : "Complete Twitch setup before using creator ops.",
        },
        ...scopeChecks.map((scope) => ({
          name: scope.scope,
          ok: scope.ok,
          detail: scope.ok
            ? `${scope.scope} is granted.`
            : `Reconnect Twitch with ${scope.scope}.`,
        })),
      ],
    },
    logs,
  };
};

export const runTwitchCreatorOpsRoute = async (path: string, body: unknown) => {
  const input = objectInput(body);

  if (input.confirmed !== true) {
    return {
      ok: false,
      confirmationRequired: true,
      error: "Guarded Live confirmation is required for Twitch creator ops.",
      state: getTwitchCreatorOpsState(),
    };
  }

  try {
    const action = path.replace("/api/twitch/creator-ops/", "");
    const result = await runTwitchCreatorOpsAction(action, input);
    return {
      ok: true,
      action,
      result,
      state: getTwitchCreatorOpsState(),
    };
  } catch (error) {
    logger.warn(
      { error: redactSecrets(error), path },
      "Twitch creator ops action failed",
    );
    return {
      ok: false,
      error: safeErrorMessage(error, "Twitch creator ops action failed."),
      state: getTwitchCreatorOpsState(),
    };
  }
};

export const runTwitchCreatorOpsAction = async (
  action: string,
  input: Record<string, unknown>,
) => {
  const client = createTwitchCreatorOpsClient();
  const execute = async (activeClient: TwitchCreatorOpsClient) => {
    switch (action) {
      case "poll":
        return activeClient.createPoll(normalizePollInput(input));
      case "poll/end":
        return activeClient.endPoll({
          id: creatorOpsId(input.id, "Poll ID"),
          status:
            optionalInputString(input.status) === "ARCHIVED"
              ? "ARCHIVED"
              : "TERMINATED",
        });
      case "prediction":
        return activeClient.createPrediction(normalizePredictionInput(input));
      case "prediction/end":
        return activeClient.endPrediction(normalizeEndPredictionInput(input));
      case "announcement":
        return activeClient.sendAnnouncement(normalizeAnnouncementInput(input));
      case "shoutout":
        return activeClient.sendShoutout({
          targetLogin: creatorOpsLogin(input.targetLogin, "Shoutout target"),
        });
      case "raid":
        return activeClient.startRaid({
          targetLogin: creatorOpsLogin(input.targetLogin, "Raid target"),
        });
      case "raid/cancel":
        return activeClient.cancelRaid();
      default:
        throw new SafeInputError(
          `Unsupported Twitch creator ops action: ${action}`,
        );
    }
  };

  try {
    const result = await execute(client);
    auditTwitchCreatorOps(action, input, result);
    return result;
  } catch (error) {
    if (!(error instanceof TwitchCreatorOpsError) || error.status !== 401) {
      throw error;
    }

    const refreshed = await refreshStoredTwitchToken({
      expectedClientId: readLocalSecrets().twitch.clientId,
      expectedBotUserId: readLocalSecrets().twitch.botUserId,
      expectedBotLogin: readLocalSecrets().twitch.botLogin,
      logger,
    });
    const retryClient = createTwitchCreatorOpsClient(refreshed.secrets);
    const result = await execute(retryClient);
    auditTwitchCreatorOps(action, input, result, { refreshed: true });
    return result;
  }
};

export const createTwitchCreatorOpsClient = (secrets = readLocalSecrets()) => {
  const twitch = secrets.twitch;

  if (
    !twitch.clientId ||
    !twitch.accessToken ||
    !twitch.broadcasterUserId ||
    !twitch.botUserId
  ) {
    throw new SafeInputError("Complete Twitch setup before using creator ops.");
  }

  return new TwitchCreatorOpsClient({
    clientId: twitch.clientId,
    accessToken: twitch.accessToken,
    broadcasterId: twitch.broadcasterUserId,
    moderatorId: twitch.botUserId,
    logger,
    apiBaseUrl: process.env.TWITCH_API_BASE_URL,
  });
};

export const normalizePollInput = (
  input: Record<string, unknown>,
): PollInput => ({
  title: creatorOpsText(input.title, "Poll title", 60),
  choices: creatorOpsList(input.choices, "Poll choices", 2, 5, 60),
  durationSeconds: parseSafeInteger(input.durationSeconds, {
    field: "Poll duration",
    fallback: 120,
    min: 15,
    max: 1800,
  }),
  channelPointsVotingEnabled: Boolean(input.channelPointsVotingEnabled),
  channelPointsPerVote: parseSafeInteger(input.channelPointsPerVote ?? "0", {
    field: "Channel points per vote",
    fallback: 0,
    min: 0,
    max: 1_000_000,
  }),
});

export const normalizePredictionInput = (
  input: Record<string, unknown>,
): PredictionInput => ({
  title: creatorOpsText(input.title, "Prediction title", 60),
  outcomes: creatorOpsList(input.outcomes, "Prediction outcomes", 2, 10, 60),
  predictionWindowSeconds: parseSafeInteger(input.predictionWindowSeconds, {
    field: "Prediction window",
    fallback: 120,
    min: 30,
    max: 1800,
  }),
});

export const normalizeEndPredictionInput = (
  input: Record<string, unknown>,
): EndPredictionInput => {
  const statusInput = optionalInputString(input.status);
  const status =
    statusInput === "RESOLVED" ||
    statusInput === "CANCELED" ||
    statusInput === "LOCKED"
      ? statusInput
      : "LOCKED";

  return {
    id: creatorOpsId(input.id, "Prediction ID"),
    status,
    winningOutcomeId:
      status === "RESOLVED"
        ? creatorOpsId(input.winningOutcomeId, "Winning outcome ID")
        : undefined,
  };
};

export const normalizeAnnouncementInput = (
  input: Record<string, unknown>,
): AnnouncementInput => {
  const color = optionalInputString(input.color);
  const allowedColors = ["blue", "green", "orange", "purple", "primary"];

  return {
    message: creatorOpsText(input.message, "Announcement message", 500),
    color: allowedColors.includes(color ?? "")
      ? (color as AnnouncementInput["color"])
      : "primary",
  };
};

export const creatorOpsText = (
  value: unknown,
  field: string,
  maxLength: number,
) =>
  sanitizeText(typeof value === "string" ? value : "", {
    field,
    maxLength,
    required: true,
  });

export const creatorOpsId = (value: unknown, field: string) =>
  sanitizeText(typeof value === "string" ? value : "", {
    field,
    maxLength: 120,
    required: true,
  });

export const creatorOpsLogin = (value: unknown, field: string) =>
  normalizeTwitchLogin(creatorOpsText(value, field, 40), field);

export const creatorOpsList = (
  value: unknown,
  field: string,
  min: number,
  max: number,
  maxItemLength: number,
) => {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(/\r?\n|,/)
        .map((item) => item.trim());
  const items = raw
    .map((item) =>
      sanitizeText(String(item), {
        field,
        maxLength: maxItemLength,
        required: false,
      }),
    )
    .filter(Boolean);

  if (items.length < min || items.length > max) {
    throw new SafeInputError(`${field} must include ${min}-${max} items.`);
  }

  return items;
};

export const auditTwitchCreatorOps = (
  action: string,
  input: Record<string, unknown>,
  result: unknown,
  metadata: Record<string, unknown> = {},
) => {
  writeAuditLog(db, localUiActor, `twitch.creator_ops.${action}`, action, {
    ...metadata,
    input: redactSecrets(input),
    result: summarizeCreatorOpsResult(result),
  });
};

export const summarizeCreatorOpsResult = (result: unknown) => {
  if (!result || typeof result !== "object") {
    return result;
  }

  const data =
    "data" in result && Array.isArray(result.data) ? result.data[0] : result;

  if (!data || typeof data !== "object") {
    return {};
  }

  const summary = data as Record<string, unknown>;
  return {
    id: summary.id,
    status: summary.status,
    title: summary.title,
    target:
      "target" in summary &&
      summary.target &&
      typeof summary.target === "object"
        ? (summary.target as { login?: unknown }).login
        : undefined,
  };
};
