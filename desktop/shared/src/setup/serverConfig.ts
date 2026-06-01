import {
  RelayChatClient,
  relayConfigReadiness,
  startRelayHostedInstall,
  type RelayBotReadinessReport,
} from "../twitch/relayTransport";
import {
  defaultRedirectUri,
  getLocalSecretsPath,
  readLocalSecrets,
  writeLocalSecrets,
  type LocalSecrets,
} from "../config/localSecrets";
import {
  discordAnnouncementKinds,
  discordSetupTemplates,
  getDiscordSetupTemplate,
  type DiscordSetupTemplate,
} from "../discord/templates";
import {
  getTwitchUserByLogin,
  optionalCreatorOpsScopes,
  optionalModerationScopes,
  requiredTwitchScopes,
  validateToken,
} from "../twitch/validate";
import { basename, dirname, join, resolve } from "node:path";
import {
  getDiscordAnnouncementChannelId,
  objectInput,
} from "./serverDiscordSetup";
import { maskToken } from "./serverInput";
import { getDiscordReadiness } from "./serverRelay";
import { botValidationKeys, botValidationLabels } from "./serverState";
import type { BotValidationKey } from "./serverState";

export const getSafeConfig = () => {
  const secrets = readLocalSecrets();
  const twitch = secrets.twitch;

  return {
    mode: secrets.mode,
    setupMode: getSetupMode(secrets),
    setupChecks: getSafeSetupChecks(secrets),
    hasClientId: Boolean(twitch.clientId),
    hasClientSecret: Boolean(twitch.clientSecret),
    hasAccessToken: Boolean(twitch.accessToken),
    hasRefreshToken: Boolean(twitch.refreshToken),
    hasBroadcasterUserId: Boolean(twitch.broadcasterUserId),
    hasBotUserId: Boolean(twitch.botUserId),
    broadcasterLogin: twitch.broadcasterLogin ?? "",
    botLogin: twitch.botLogin ?? "",
    redirectUri: twitch.redirectUri ?? defaultRedirectUri,
    requiredScopes: requiredTwitchScopes,
    optionalModerationScopes,
    optionalCreatorOpsScopes,
    scopes: twitch.scopes,
    tokenExpiresAt: twitch.tokenExpiresAt ?? "",
    tokenValidatedAt: twitch.tokenValidatedAt ?? "",
    token: twitch.accessToken ? maskToken(twitch.accessToken) : "",
    discord: getSafeDiscordConfig(secrets),
    relay: getSafeRelayConfig(secrets),
    botValidation: getSafeBotValidation(secrets),
  };
};

export type SetupMode = "local-only" | "relay-assisted" | "advanced";

export const setupModes: SetupMode[] = [
  "local-only",
  "relay-assisted",
  "advanced",
];

export const getSetupMode = (secrets = readLocalSecrets()): SetupMode => {
  if (setupModes.includes(secrets.setupMode as SetupMode)) {
    return secrets.setupMode as SetupMode;
  }

  return secrets.relay.twitchTransportMode === "relay-chatbot"
    ? "relay-assisted"
    : "local-only";
};

export const setupModeDisplayLabel = (mode: SetupMode) =>
  mode === "relay-assisted"
    ? "Hosted"
    : mode === "advanced"
      ? "Assisted"
      : "Local";

export const parseSetupMode = (
  value: unknown,
  fallback: SetupMode,
): SetupMode =>
  typeof value === "string" && setupModes.includes(value as SetupMode)
    ? (value as SetupMode)
    : fallback;

export const deriveTwitchTransportForSetupMode = (
  setupMode: SetupMode,
  existingTransport: LocalSecrets["relay"]["twitchTransportMode"],
) => {
  if (setupMode === "relay-assisted") {
    return "relay-chatbot";
  }

  if (setupMode === "local-only") {
    return "local-user-token";
  }

  return existingTransport;
};

export const getSafeSetupChecks = (secrets = readLocalSecrets()) => ({
  local: safeSetupCheck(secrets.setupChecks.local),
  relay: safeSetupCheck(secrets.setupChecks.relay),
});

export const safeSetupCheck = (
  check: LocalSecrets["setupChecks"]["local"] | undefined,
) => ({
  checkedAt: check?.checkedAt ?? "",
  status: check?.status ?? "",
  message: check?.message ?? "",
});

export const checkSetupModeRoute = (body: unknown) => {
  const input = objectInput(body);
  const existing = readLocalSecrets();
  const mode = parseSetupMode(input.mode, getSetupMode(existing));
  const key = mode === "relay-assisted" ? "relay" : "local";
  const check =
    key === "relay"
      ? buildRelaySetupCheck(existing)
      : buildLocalSetupCheck(existing);
  const record = {
    checkedAt: new Date().toISOString(),
    status: check.status,
    message: check.message,
  };

  writeLocalSecrets({
    ...existing,
    setupMode: mode,
    setupChecks: {
      ...existing.setupChecks,
      [key]: record,
    },
  });

  return {
    ok: true,
    mode,
    check: record,
    providerSetup: {
      mode,
      redacted: true,
      checkedAt: record.checkedAt,
      status: record.status,
      message: record.message,
    },
    setupChecks: getSafeSetupChecks(),
    config: getSafeConfig(),
  };
};

export const buildLocalSetupCheck = (secrets: LocalSecrets) => {
  const twitch = secrets.twitch;
  const missing = [
    twitch.clientId ? null : "Client ID",
    twitch.clientSecret ? null : "Client Secret",
    twitch.redirectUri ? null : "Redirect URI",
    twitch.broadcasterLogin ? null : "Broadcaster Login",
    twitch.botLogin ? null : "Bot Login",
    twitch.accessToken ? null : "OAuth token",
  ].filter(Boolean) as string[];
  const discordReady = getDiscordReadiness(secrets).ready;

  if (missing.length) {
    return {
      status: "blocked" as const,
      message: `Local setup needs ${missing.join(", ")} before local chat validation can pass.`,
    };
  }

  if (!discordReady) {
    return {
      status: "degraded" as const,
      message:
        "Local Twitch setup has required fields. Local Discord announcements/layout are not configured yet.",
    };
  }

  return {
    status: "ready" as const,
    message:
      "Local setup has Twitch OAuth fields and local Discord announcement/layout settings.",
  };
};

export const buildRelaySetupCheck = (secrets: LocalSecrets) => {
  const readiness = relayConfigReadiness({
    baseUrl: secrets.relay.baseUrl,
    installationId: secrets.relay.installationId,
    consoleToken: secrets.relay.consoleToken,
  });

  if (!readiness.ready) {
    return {
      status: "blocked" as const,
      message:
        readiness.checks
          .filter((check) => !check.ok)
          .map((check) => check.detail)
          .join(" ") || "Relay pairing is incomplete.",
    };
  }

  if (secrets.relay.twitchTransportMode !== "relay-chatbot") {
    return {
      status: "degraded" as const,
      message:
        "Relay pairing is saved, but Twitch transport is still set to Local.",
    };
  }

  return {
    status: "ready" as const,
    message:
      "Hosted setup has Relay pairing and Twitch Chat Bot transport selected.",
  };
};

export const getSafeBotValidation = (secrets = readLocalSecrets()) => {
  const records = Object.fromEntries(
    botValidationKeys.map((key) => [key, secrets.botValidation[key] ?? ""]),
  ) as Record<BotValidationKey, string>;
  return {
    records,
    checklist: botValidationKeys.map((key) => ({
      key,
      label: botValidationLabels[key],
      recordedAt: records[key],
      complete: Boolean(records[key]),
    })),
  };
};

export const getSafeRelayConfig = (secrets = readLocalSecrets()) => {
  const relay = secrets.relay;
  const readiness = relayConfigReadiness({
    baseUrl: relay.baseUrl,
    installationId: relay.installationId,
    consoleToken: relay.consoleToken,
  });
  const chatbotIdentityLiveValidated = Boolean(
    relay.chatbotIdentityValidatedAt,
  );
  const identityNotice =
    relay.twitchTransportMode === "relay-chatbot"
      ? chatbotIdentityLiveValidated
        ? "Relay chatbot mode is selected and Chat Bot identity has been manually live-validated."
        : "Relay chatbot mode is selected. Chat Bot identity is not live-tested yet; complete the live validation checklist before calling it complete."
      : "Local user-token mode is selected. Twitch will show outgoing bot chat as a normal Twitch user.";

  return {
    twitchTransportMode: relay.twitchTransportMode,
    baseUrl: relay.baseUrl ?? "",
    installationId: relay.installationId ?? "",
    hasConsoleToken: Boolean(relay.consoleToken),
    chatbotIdentityLiveValidated,
    chatbotIdentityValidatedAt: relay.chatbotIdentityValidatedAt ?? "",
    chatbotIdentityValidationNote: relay.chatbotIdentityValidationNote ?? "",
    readiness,
    identityNotice,
    setupUrls: getRelaySetupUrls(relay),
  };
};

export const getSafeDiscordConfig = (secrets = readLocalSecrets()) => {
  const discord = secrets.discord;
  const template = getDiscordSetupTemplate(discord.setupTemplateId);
  return {
    hasBotToken: Boolean(discord.botToken),
    guildId: discord.guildId ?? "",
    streamAnnouncementChannelId: getDiscordAnnouncementChannelId(discord) ?? "",
    generalAnnouncementChannelId:
      discord.generalAnnouncementChannelId ??
      discord.createdChannelIds?.[
        template.recommended.generalAnnouncementChannelId
      ] ??
      "",
    streamAlertsRoleId:
      discord.streamAlertsRoleId ??
      discord.createdRoleIds?.[template.recommended.streamAlertsRoleId] ??
      "",
    operatorRoleId:
      discord.operatorRoleId ??
      (template.recommended.operatorRoleId
        ? discord.createdRoleIds?.[template.recommended.operatorRoleId]
        : undefined) ??
      "",
    staffRoleId: discord.staffRoleId ?? "",
    lockStaffCategory: Boolean(discord.lockStaffCategory),
    setupTemplateId: template.id,
    setupTemplate: safeDiscordTemplateSummary(template),
    setupTemplates: discordSetupTemplates.map(safeDiscordTemplateSummary),
    setupAppliedAt: discord.setupAppliedAt ?? "",
    starterMessagesAppliedAt: discord.starterMessagesAppliedAt ?? "",
    createdChannelIds: discord.createdChannelIds ?? {},
    createdRoleIds: discord.createdRoleIds ?? {},
    createdMessageIds: discord.createdMessageIds ?? {},
    relay: getSafeDiscordRelayConfig(secrets),
  };
};

export const safeDiscordTemplateSummary = (template: DiscordSetupTemplate) => ({
  id: template.id,
  name: template.name,
  description: template.description,
  recommendedFor: template.recommendedFor ?? "",
  channelCount: template.channels.filter(
    (channel) => channel.kind !== "category",
  ).length,
  categoryCount: template.channels.filter(
    (channel) => channel.kind === "category",
  ).length,
  roleCount: template.roles.length,
  starterMessageCount: template.starterMessages?.length ?? 0,
  postStarterMessagesByDefault: Boolean(template.postStarterMessagesByDefault),
});

export const getSafeDiscordRelayConfig = (secrets = readLocalSecrets()) => {
  const relay = secrets.relay;
  const baseUrl = relay.baseUrl?.replace(/\/+$/, "") ?? "";
  const readiness = relayConfigReadiness({
    baseUrl: relay.baseUrl,
    installationId: relay.installationId,
    consoleToken: relay.consoleToken,
  });
  return {
    configured: readiness.ready,
    baseUrl,
    installationId: relay.installationId ?? "",
    hasConsoleToken: Boolean(relay.consoleToken),
    interactionUrl: getRelaySetupUrls(relay).discordInteractionUrl,
    suggestionStatuses: ["new", "reviewed", "accepted", "rejected", "archived"],
    localReadiness: readiness,
  };
};

export const getRelaySetupUrls = (relay: LocalSecrets["relay"]) => {
  const baseUrl = relay.baseUrl?.replace(/\/+$/, "") ?? "";
  const installationId = relay.installationId ?? "";
  const installationQuery = installationId
    ? `?installationId=${encodeURIComponent(installationId)}`
    : "";
  return {
    publicBaseUrl: baseUrl,
    twitchCallbackUrl: baseUrl ? `${baseUrl}/oauth/twitch/callback` : "",
    twitchBotOAuthUrl:
      baseUrl && installationId
        ? `${baseUrl}/oauth/twitch/start${installationQuery}&kind=bot`
        : "",
    twitchBroadcasterOAuthUrl:
      baseUrl && installationId
        ? `${baseUrl}/oauth/twitch/start${installationQuery}&kind=broadcaster`
        : "",
    twitchEventSubWebhookUrl: baseUrl
      ? `${baseUrl}/webhooks/twitch/eventsub`
      : "",
    discordInteractionUrl: baseUrl
      ? `${baseUrl}/webhooks/discord/interactions`
      : "",
  };
};
