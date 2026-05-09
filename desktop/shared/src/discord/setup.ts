import {
  SafeInputError,
  parseSafeInteger,
  sanitizeText,
} from "../core/security";
import {
  type DiscordApiClient,
  type DiscordCreateMessageInput,
  type DiscordGuildChannel,
  type DiscordGuildRole,
} from "./client";
import {
  type DiscordAnnouncementKind,
  type DiscordChannelKind,
  type DiscordSetupChannelTemplate,
  type DiscordSetupRoleTemplate,
  type DiscordSetupTemplate,
  discordChannelTypeCodes,
  minimalStreamerDiscordTemplate,
} from "./templates";

export type DiscordSetupActionType =
  | "create_channel"
  | "use_existing_channel"
  | "create_role"
  | "use_existing_role"
  | "skip_role";

export type DiscordSetupAction = {
  type: DiscordSetupActionType;
  templateId: string;
  name: string;
  kind?: DiscordChannelKind;
  discordId?: string;
  detail: string;
};

export type DiscordSetupPlan = {
  ok: true;
  template: Pick<DiscordSetupTemplate, "id" | "name" | "description">;
  includeRoles: boolean;
  actions: DiscordSetupAction[];
  summary: {
    channelsToCreate: number;
    existingChannels: number;
    rolesToCreate: number;
    existingRoles: number;
    skippedRoles: number;
  };
};

export type DiscordSetupApplyResult = {
  ok: true;
  appliedAt: string;
  plan: DiscordSetupPlan;
  createdChannels: DiscordGuildChannel[];
  createdRoles: DiscordGuildRole[];
  channelIds: Record<string, string>;
  roleIds: Record<string, string>;
  recommended: {
    streamAnnouncementChannelId?: string;
    generalAnnouncementChannelId?: string;
    suggestionChannelId?: string;
    streamAlertsRoleId?: string;
  };
};

export type DiscordAnnouncementInput = {
  kind: DiscordAnnouncementKind;
  title?: string;
  detail?: string;
  streamUrl?: string;
  scheduledFor?: string;
  broadcasterName?: string;
  roleId?: string;
};

export type DiscordConfigInput = {
  botToken?: string;
  guildId?: string;
  streamAnnouncementChannelId?: string;
  generalAnnouncementChannelId?: string;
  streamAlertsRoleId?: string;
};

export const planDiscordServerSetup = (options: {
  existingChannels: DiscordGuildChannel[];
  existingRoles: DiscordGuildRole[];
  template?: DiscordSetupTemplate;
  includeRoles?: boolean;
}): DiscordSetupPlan => {
  const template = options.template ?? minimalStreamerDiscordTemplate;
  const includeRoles = options.includeRoles ?? false;
  const actions: DiscordSetupAction[] = [];
  const roleIds = new Map<string, string>();
  const channelIds = new Map<string, string>();

  for (const role of template.roles) {
    const existing = findExistingRole(options.existingRoles, role);
    if (existing) {
      roleIds.set(role.id, existing.id);
      actions.push({
        type: "use_existing_role",
        templateId: role.id,
        name: role.name,
        discordId: existing.id,
        detail: `Uses existing Discord role ${role.name}.`,
      });
    } else if (includeRoles) {
      actions.push({
        type: "create_role",
        templateId: role.id,
        name: role.name,
        detail: `Creates Discord role ${role.name}.`,
      });
    } else {
      actions.push({
        type: "skip_role",
        templateId: role.id,
        name: role.name,
        detail:
          "Role creation is optional and skipped unless Stream Alerts role setup is enabled.",
      });
    }
  }

  for (const channel of template.channels) {
    const parentId = channel.parentId ? channelIds.get(channel.parentId) : null;
    const existing = findExistingChannel(
      options.existingChannels,
      channel,
      parentId,
    );

    if (existing) {
      channelIds.set(channel.id, existing.id);
      actions.push({
        type: "use_existing_channel",
        templateId: channel.id,
        name: channel.name,
        kind: channel.kind,
        discordId: existing.id,
        detail: `Uses existing ${channel.kind} channel ${channel.name}.`,
      });
      continue;
    }

    actions.push({
      type: "create_channel",
      templateId: channel.id,
      name: channel.name,
      kind: channel.kind,
      detail: `Creates ${channel.kind} channel ${channel.name}.`,
    });
  }

  return {
    ok: true,
    template: {
      id: template.id,
      name: template.name,
      description: template.description,
    },
    includeRoles,
    actions,
    summary: {
      channelsToCreate: actions.filter(
        (action) => action.type === "create_channel",
      ).length,
      existingChannels: actions.filter(
        (action) => action.type === "use_existing_channel",
      ).length,
      rolesToCreate: actions.filter((action) => action.type === "create_role")
        .length,
      existingRoles: actions.filter(
        (action) => action.type === "use_existing_role",
      ).length,
      skippedRoles: actions.filter((action) => action.type === "skip_role")
        .length,
    },
  };
};

export const previewDiscordSetupTemplate = (
  template = minimalStreamerDiscordTemplate,
) =>
  planDiscordServerSetup({
    existingChannels: [],
    existingRoles: [],
    template,
  });

export const applyDiscordServerSetup = async (options: {
  client: DiscordApiClient;
  guildId: string;
  template?: DiscordSetupTemplate;
  includeRoles?: boolean;
}): Promise<DiscordSetupApplyResult> => {
  const template = options.template ?? minimalStreamerDiscordTemplate;
  const guildId = normalizeDiscordSnowflake(options.guildId, "Discord guild ID");
  const existingChannels = await options.client.listGuildChannels(guildId);
  const existingRoles = await options.client.listGuildRoles(guildId);
  const includeRoles = options.includeRoles ?? false;
  const workingChannels = [...existingChannels];
  const workingRoles = [...existingRoles];
  const createdChannels: DiscordGuildChannel[] = [];
  const createdRoles: DiscordGuildRole[] = [];
  const channelIds: Record<string, string> = {};
  const roleIds: Record<string, string> = {};

  if (includeRoles) {
    for (const role of template.roles) {
      const existing = findExistingRole(workingRoles, role);
      if (existing) {
        roleIds[role.id] = existing.id;
        continue;
      }

      const created = await options.client.createGuildRole(guildId, {
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        mentionable: role.mentionable,
      });
      workingRoles.push(created);
      createdRoles.push(created);
      roleIds[role.id] = created.id;
    }
  } else {
    for (const role of template.roles) {
      const existing = findExistingRole(workingRoles, role);
      if (existing) {
        roleIds[role.id] = existing.id;
      }
    }
  }

  for (const channel of template.channels) {
    const parentDiscordId = channel.parentId
      ? channelIds[channel.parentId]
      : undefined;
    const existing = findExistingChannel(
      workingChannels,
      channel,
      parentDiscordId,
    );
    if (existing) {
      channelIds[channel.id] = existing.id;
      continue;
    }

    const created = await options.client.createGuildChannel(guildId, {
      name: channel.name,
      type: discordChannelTypeCodes[channel.kind],
      parent_id: parentDiscordId,
      topic: channel.kind === "text" ? channel.topic : undefined,
      bitrate: channel.kind === "voice" ? channel.bitrate : undefined,
      user_limit: channel.kind === "voice" ? channel.userLimit : undefined,
      nsfw: channel.kind === "text" ? channel.nsfw : undefined,
    });
    workingChannels.push(created);
    createdChannels.push(created);
    channelIds[channel.id] = created.id;
  }

  const plan = planDiscordServerSetup({
    existingChannels: workingChannels,
    existingRoles: workingRoles,
    template,
    includeRoles,
  });

  return {
    ok: true,
    appliedAt: new Date().toISOString(),
    plan,
    createdChannels,
    createdRoles,
    channelIds,
    roleIds,
    recommended: {
      streamAnnouncementChannelId:
        channelIds[template.recommended.streamAnnouncementChannelId],
      generalAnnouncementChannelId:
        channelIds[template.recommended.generalAnnouncementChannelId],
      suggestionChannelId: channelIds[template.recommended.suggestionChannelId],
      streamAlertsRoleId: roleIds[template.recommended.streamAlertsRoleId],
    },
  };
};

export const buildDiscordAnnouncementMessage = (
  input: DiscordAnnouncementInput,
): DiscordCreateMessageInput => {
  const kind = input.kind;
  const roleId = input.roleId
    ? normalizeDiscordSnowflake(input.roleId, "Discord role ID")
    : "";
  const streamUrl = sanitizeOptionalUrl(input.streamUrl, "Stream URL");
  const broadcasterName = sanitizeOptionalText(
    input.broadcasterName,
    "Broadcaster name",
    80,
  );
  const title =
    sanitizeOptionalText(input.title, "Announcement title", 120) ||
    defaultAnnouncementTitle(kind);
  const detail =
    sanitizeOptionalLongText(input.detail, "Announcement detail", 1200) ||
    defaultAnnouncementDetail(kind, broadcasterName, streamUrl);
  const scheduledFor = sanitizeOptionalText(
    input.scheduledFor,
    "Scheduled time",
    120,
  );
  const contentPrefix = roleId && kind === "live" ? `<@&${roleId}> ` : "";
  const content = `${contentPrefix}${title}`.slice(0, 2000);
  const color = {
    live: 0x39d9ff,
    late: 0xf5c542,
    cancelled: 0xf05f66,
    scheduled: 0x8bd17c,
  }[kind];

  const fields = scheduledFor
    ? [{ name: "Time", value: scheduledFor, inline: true }]
    : [];

  return {
    content,
    embeds: [
      {
        title,
        description: detail,
        color,
        url: streamUrl || undefined,
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: "VaexCore Console" },
      },
    ],
    allowed_mentions: roleId ? { parse: [], roles: [roleId] } : { parse: [] },
  };
};

export const sendDiscordAnnouncement = async (options: {
  client: DiscordApiClient;
  channelId: string;
  input: DiscordAnnouncementInput;
}) => {
  const channelId = normalizeDiscordSnowflake(
    options.channelId,
    "Discord announcement channel ID",
  );
  const message = buildDiscordAnnouncementMessage(options.input);
  const result = await options.client.createMessage(channelId, message);
  return { ok: true, message, result };
};

export const normalizeDiscordConfigInput = (
  input: DiscordConfigInput,
): DiscordConfigInput => ({
  botToken: sanitizeOptionalText(input.botToken, "Discord bot token", 240),
  guildId: normalizeOptionalDiscordSnowflake(
    input.guildId,
    "Discord server ID",
  ),
  streamAnnouncementChannelId: normalizeOptionalDiscordSnowflake(
    input.streamAnnouncementChannelId,
    "Discord stream announcement channel ID",
  ),
  generalAnnouncementChannelId: normalizeOptionalDiscordSnowflake(
    input.generalAnnouncementChannelId,
    "Discord general announcement channel ID",
  ),
  streamAlertsRoleId: normalizeOptionalDiscordSnowflake(
    input.streamAlertsRoleId,
    "Discord Stream Alerts role ID",
  ),
});

export const normalizeDiscordSnowflake = (value: unknown, field: string) => {
  const id = sanitizeText(value, {
    field,
    maxLength: 32,
    required: true,
  });

  if (!/^\d{5,30}$/.test(id)) {
    throw new SafeInputError(`${field} must be a Discord numeric ID.`);
  }

  return id;
};

const normalizeOptionalDiscordSnowflake = (
  value: unknown,
  field: string,
): string | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return normalizeDiscordSnowflake(value, field);
};

const findExistingRole = (
  roles: DiscordGuildRole[],
  template: DiscordSetupRoleTemplate,
) =>
  roles.find(
    (role) => normalizeRoleName(role.name) === normalizeRoleName(template.name),
  );

const findExistingChannel = (
  channels: DiscordGuildChannel[],
  template: DiscordSetupChannelTemplate,
  parentDiscordId?: string | null,
) => {
  const expectedType = discordChannelTypeCodes[template.kind];
  const expectedName = normalizeChannelName(template.name);
  const matches = channels.filter(
    (channel) =>
      channel.type === expectedType &&
      normalizeChannelName(channel.name) === expectedName,
  );

  if (!parentDiscordId) {
    return matches[0];
  }

  return (
    matches.find((channel) => channel.parent_id === parentDiscordId) ??
    matches[0]
  );
};

const normalizeRoleName = (name: string) =>
  name.trim().replace(/\s+/g, " ").toLowerCase();

const normalizeChannelName = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const defaultAnnouncementTitle = (kind: DiscordAnnouncementKind) => {
  if (kind === "live") return "Stream is live";
  if (kind === "late") return "Stream is running late";
  if (kind === "cancelled") return "Stream cancelled";
  return "Stream scheduled";
};

const defaultAnnouncementDetail = (
  kind: DiscordAnnouncementKind,
  broadcasterName?: string,
  streamUrl?: string,
) => {
  const channel = broadcasterName || "the channel";
  if (kind === "live") {
    return streamUrl
      ? `${channel} is live now: ${streamUrl}`
      : `${channel} is live now.`;
  }
  if (kind === "late") {
    return `${channel} is running late. A new start notice will be posted when the stream is ready.`;
  }
  if (kind === "cancelled") {
    return `${channel}'s planned stream has been cancelled.`;
  }
  return `${channel} has a stream scheduled.`;
};

const sanitizeOptionalText = (
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return sanitizeText(value, {
    field,
    maxLength,
    required: true,
  });
};

const sanitizeOptionalLongText = (
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return sanitizeText(value, {
    field,
    maxLength,
    allowNewlines: true,
    required: true,
  });
};

const sanitizeOptionalUrl = (value: unknown, field: string) => {
  const text = sanitizeOptionalText(value, field, 300);
  if (!text) {
    return undefined;
  }

  const url = new URL(text);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new SafeInputError(`${field} must be an http or https URL.`);
  }

  return url.toString();
};

export const normalizeOptionalPositiveInteger = (
  value: unknown,
  field: string,
  max: number,
) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return parseSafeInteger(value, { field, min: 1, max });
};
