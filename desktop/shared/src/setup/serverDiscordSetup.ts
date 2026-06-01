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
  applyDiscordServerSetup,
  normalizeDiscordConfigInput,
  planDiscordServerSetup,
  sendDiscordAnnouncement,
  type DiscordAnnouncementInput,
} from "../discord/setup";
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
import { DiscordApiClient } from "../discord/client";
import { getSafeDiscordConfig } from "./serverConfig";
import { syncDiscordOperatorRoleToRelay } from "./serverDiscordRelay";
import { appendSuiteTimelineEvent } from "./serverSuite";

export const saveDiscordConfig = (body: unknown) => {
  const input = objectInput(body);
  const existing = readLocalSecrets();
  const lockStaffCategory =
    input.lockStaffCategory === undefined
      ? Boolean(existing.discord.lockStaffCategory)
      : Boolean(input.lockStaffCategory);
  const setupTemplateId =
    normalizeDiscordSetupTemplateId(
      optionalInputString(input.setupTemplateId),
    ) ?? existing.discord.setupTemplateId;
  const normalized = normalizeDiscordConfigInput({
    botToken: optionalInputString(input.botToken),
    guildId: optionalInputString(input.guildId),
    streamAnnouncementChannelId: optionalInputString(
      input.streamAnnouncementChannelId,
    ),
    generalAnnouncementChannelId: optionalInputString(
      input.generalAnnouncementChannelId,
    ),
    streamAlertsRoleId: optionalInputString(input.streamAlertsRoleId),
    operatorRoleId: optionalInputString(input.operatorRoleId),
    staffRoleId: optionalInputString(input.staffRoleId),
    lockStaffCategory,
  });
  const guildChanged = Boolean(
    normalized.guildId && normalized.guildId !== existing.discord.guildId,
  );
  const nextDiscord: LocalSecrets["discord"] = {
    ...existing.discord,
    botToken: normalized.botToken || existing.discord.botToken,
    guildId: normalized.guildId || existing.discord.guildId,
    streamAnnouncementChannelId:
      normalized.streamAnnouncementChannelId ||
      (guildChanged ? undefined : existing.discord.streamAnnouncementChannelId),
    generalAnnouncementChannelId:
      normalized.generalAnnouncementChannelId ||
      (guildChanged
        ? undefined
        : existing.discord.generalAnnouncementChannelId),
    streamAlertsRoleId:
      normalized.streamAlertsRoleId ||
      (guildChanged ? undefined : existing.discord.streamAlertsRoleId),
    operatorRoleId:
      normalized.operatorRoleId ||
      (guildChanged ? undefined : existing.discord.operatorRoleId),
    staffRoleId:
      normalized.staffRoleId ||
      (guildChanged ? undefined : existing.discord.staffRoleId),
    lockStaffCategory: Boolean(normalized.lockStaffCategory),
    setupTemplateId,
    setupAppliedAt: guildChanged ? undefined : existing.discord.setupAppliedAt,
    createdChannelIds: guildChanged
      ? {}
      : (existing.discord.createdChannelIds ?? {}),
    createdRoleIds: guildChanged ? {} : (existing.discord.createdRoleIds ?? {}),
    createdMessageIds: guildChanged
      ? {}
      : (existing.discord.createdMessageIds ?? {}),
    starterMessagesAppliedAt: guildChanged
      ? undefined
      : existing.discord.starterMessagesAppliedAt,
  };

  writeLocalSecrets({
    ...existing,
    discord: nextDiscord,
  });

  return getSafeDiscordConfig();
};

export const previewDiscordSetup = async (body: unknown) => {
  const input = objectInput(body);
  const includeRoles = Boolean(input.includeRoles);
  const secrets = readLocalSecrets();
  const template = getDiscordSetupTemplate(
    normalizeDiscordSetupTemplateId(optionalInputString(input.templateId)) ??
      secrets.discord.setupTemplateId,
  );
  const applyPermissions =
    input.applyPermissions === undefined
      ? true
      : Boolean(input.applyPermissions);
  const postStarterMessages =
    input.postStarterMessages === undefined
      ? Boolean(template.postStarterMessagesByDefault)
      : Boolean(input.postStarterMessages);
  const lockStaffCategory =
    input.lockStaffCategory === undefined
      ? Boolean(secrets.discord.lockStaffCategory)
      : Boolean(input.lockStaffCategory);
  const staffRoleId =
    optionalInputString(input.staffRoleId) ?? secrets.discord.staffRoleId;
  const connectionError = discordConnectionError({
    requireAnnouncementChannel: false,
  });

  if (connectionError) {
    return {
      ok: true,
      connected: false,
      message: connectionError,
      config: getSafeDiscordConfig(secrets),
      plan: planDiscordServerSetup({
        existingChannels: [],
        existingRoles: [],
        template,
        includeRoles,
        applyPermissions,
        postStarterMessages,
        existingMessageIds: secrets.discord.createdMessageIds ?? {},
        guildId: secrets.discord.guildId,
        lockStaffCategory,
        staffRoleId,
      }),
      template,
    };
  }

  const client = createDiscordClient(secrets.discord.botToken ?? "");
  const guildId = secrets.discord.guildId ?? "";
  const [existingChannels, existingRoles] = await Promise.all([
    client.listGuildChannels(guildId),
    client.listGuildRoles(guildId),
  ]);

  return {
    ok: true,
    connected: true,
    config: getSafeDiscordConfig(secrets),
    plan: planDiscordServerSetup({
      existingChannels,
      existingRoles,
      template,
      includeRoles,
      applyPermissions,
      postStarterMessages,
      existingMessageIds: secrets.discord.createdMessageIds ?? {},
      guildId,
      lockStaffCategory,
      staffRoleId,
    }),
    template,
  };
};

export const applyDiscordSetup = async (body: unknown) => {
  const input = objectInput(body);
  const includeRoles = Boolean(input.includeRoles);
  const secrets = readLocalSecrets();
  const botToken = secrets.discord.botToken;
  const guildId = secrets.discord.guildId;
  const template = getDiscordSetupTemplate(
    normalizeDiscordSetupTemplateId(optionalInputString(input.templateId)) ??
      secrets.discord.setupTemplateId,
  );
  const applyPermissions =
    input.applyPermissions === undefined
      ? true
      : Boolean(input.applyPermissions);
  const postStarterMessages =
    input.postStarterMessages === undefined
      ? Boolean(template.postStarterMessagesByDefault)
      : Boolean(input.postStarterMessages);
  const lockStaffCategory =
    input.lockStaffCategory === undefined
      ? Boolean(secrets.discord.lockStaffCategory)
      : Boolean(input.lockStaffCategory);
  const staffRoleId =
    optionalInputString(input.staffRoleId) ?? secrets.discord.staffRoleId;

  if (!botToken || !guildId) {
    throw new SafeInputError("Discord bot token and server ID are required.");
  }

  const client = createDiscordClient(botToken);
  const bot = await client.getCurrentUser();
  const result = await applyDiscordServerSetup({
    client,
    guildId,
    template,
    includeRoles,
    applyPermissions,
    postStarterMessages,
    existingMessageIds: secrets.discord.createdMessageIds ?? {},
    lockStaffCategory,
    staffRoleId,
    botUserId: bot.id,
  });
  const latest = readLocalSecrets();
  const operatorRoleId =
    result.recommended.operatorRoleId || latest.discord.operatorRoleId;
  const createdMessageIds = {
    ...(latest.discord.createdMessageIds ?? {}),
    ...result.createdMessageIds,
  };
  const starterMessagesAppliedAt =
    result.starterMessagesPosted > 0
      ? result.appliedAt
      : latest.discord.starterMessagesAppliedAt;
  writeLocalSecrets({
    ...latest,
    discord: {
      ...latest.discord,
      setupAppliedAt: result.appliedAt,
      createdChannelIds: result.channelIds,
      createdRoleIds: result.roleIds,
      streamAnnouncementChannelId:
        result.recommended.streamAnnouncementChannelId ||
        latest.discord.streamAnnouncementChannelId,
      generalAnnouncementChannelId:
        result.recommended.generalAnnouncementChannelId ||
        latest.discord.generalAnnouncementChannelId,
      streamAlertsRoleId:
        result.recommended.streamAlertsRoleId ||
        latest.discord.streamAlertsRoleId,
      operatorRoleId,
      staffRoleId: staffRoleId || latest.discord.staffRoleId,
      lockStaffCategory,
      setupTemplateId: template.id,
      createdMessageIds,
      starterMessagesAppliedAt,
    },
  });

  const relayOperatorRoleSync = operatorRoleId
    ? await syncDiscordOperatorRoleToRelay(operatorRoleId)
    : {
        ok: false,
        skipped: true,
        error: "No Discord operator role was resolved.",
      };

  appendSuiteTimelineEvent({
    sourceApp: "vaexcore-console",
    sourceAppName: "vaexcore console",
    kind: "discord.setup",
    title: "Discord setup applied",
    detail: `Console prepared ${result.createdChannels.length} Discord channels and ${result.createdRoles.length} roles.`,
    metadata: {
      guildId,
      includeRoles,
      applyPermissions,
      postStarterMessages,
      lockStaffCategory,
      createdChannelIds: Object.keys(result.channelIds),
      createdRoleIds: Object.keys(result.roleIds),
      createdMessageIds: Object.keys(createdMessageIds),
      permissionOverwritesApplied: result.permissionOverwritesApplied,
      starterMessagesPosted: result.starterMessagesPosted,
      operatorRoleId,
      relayOperatorRoleSynced: relayOperatorRoleSync.ok,
    },
  });

  return {
    ...result,
    relayOperatorRoleSync,
    config: getSafeDiscordConfig(),
  };
};

export const sendDiscordAnnouncementRoute = async (body: unknown) => {
  const input = objectInput(body);
  const secrets = readLocalSecrets();
  const botToken = secrets.discord.botToken;
  const channelId =
    optionalInputString(input.channelId) ??
    getDiscordAnnouncementChannelId(secrets.discord);

  if (!botToken || !channelId) {
    throw new SafeInputError(
      "Discord bot token and announcement channel ID are required.",
    );
  }

  const announcement = discordAnnouncementInput(input, secrets);
  const sent = await sendDiscordAnnouncement({
    client: createDiscordClient(botToken),
    channelId,
    input: announcement,
  });

  appendSuiteTimelineEvent({
    sourceApp: "vaexcore-console",
    sourceAppName: "vaexcore console",
    kind: `discord.announcement.${announcement.kind}`,
    title: `Discord ${announcement.kind} announcement sent`,
    detail: announcement.title || "Discord stream announcement sent.",
    metadata: {
      channelId,
      messageId: sent.result.id,
      kind: announcement.kind,
    },
  });

  return {
    ok: true,
    channelId,
    messageId: sent.result.id,
    announcement,
  };
};

export const discordAnnouncementInput = (
  input: Record<string, unknown>,
  secrets: LocalSecrets,
): DiscordAnnouncementInput => {
  const kind = optionalInputString(input.kind) || "live";
  if (
    !discordAnnouncementKinds.includes(kind as DiscordAnnouncementInput["kind"])
  ) {
    throw new SafeInputError("Discord announcement kind is not supported.");
  }

  const broadcasterName =
    optionalInputString(input.broadcasterName) ||
    secrets.twitch.broadcasterLogin ||
    "the channel";
  const defaultStreamUrl = secrets.twitch.broadcasterLogin
    ? `https://www.twitch.tv/${secrets.twitch.broadcasterLogin}`
    : undefined;
  const mentionRole = input.mentionRole !== false;

  return {
    kind: kind as DiscordAnnouncementInput["kind"],
    title: optionalInputString(input.title),
    detail: optionalInputString(input.detail),
    streamUrl: optionalInputString(input.streamUrl) || defaultStreamUrl,
    scheduledFor: optionalInputString(input.scheduledFor),
    broadcasterName,
    roleId: mentionRole
      ? optionalInputString(input.roleId) ||
        getDiscordStreamAlertsRoleId(secrets.discord)
      : undefined,
  };
};

export const discordConnectionError = (
  options: { requireAnnouncementChannel?: boolean } = {},
) => {
  const discord = readLocalSecrets().discord;
  if (!discord.botToken) {
    return "Save a Discord bot token before using Discord setup.";
  }
  if (!discord.guildId) {
    return "Save the Discord server ID before using Discord setup.";
  }
  if (
    options.requireAnnouncementChannel &&
    !getDiscordAnnouncementChannelId(discord)
  ) {
    return "Apply Discord setup or save a stream announcement channel ID before sending announcements.";
  }

  return "";
};

export const createDiscordClient = (botToken: string) =>
  new DiscordApiClient({
    botToken,
    apiBaseUrl: process.env.DISCORD_API_BASE_URL,
  });

export const getDiscordAnnouncementChannelId = (
  discord: LocalSecrets["discord"],
): string | undefined => {
  const template = getDiscordSetupTemplate(discord.setupTemplateId);
  return (
    discord.streamAnnouncementChannelId ||
    discord.createdChannelIds?.[
      template.recommended.streamAnnouncementChannelId
    ]
  );
};

export const getDiscordStreamAlertsRoleId = (
  discord: LocalSecrets["discord"],
): string | undefined => {
  const template = getDiscordSetupTemplate(discord.setupTemplateId);
  return (
    discord.streamAlertsRoleId ||
    discord.createdRoleIds?.[template.recommended.streamAlertsRoleId]
  );
};

export const objectInput = (body: unknown): Record<string, unknown> =>
  body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};

export const optionalInputString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

export const normalizeDiscordSetupTemplateId = (
  value?: string,
): string | undefined => {
  if (!value) return undefined;
  const template = discordSetupTemplates.find((item) => item.id === value);
  if (!template) {
    throw new SafeInputError("Select a valid Discord server layout preset.");
  }
  return template.id;
};
