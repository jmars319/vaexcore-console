import type { DiscordGuildChannel, DiscordGuildRole } from "./client";
import type {
  DiscordSetupChannelTemplate,
  DiscordSetupPermissionOverwriteTemplate,
  DiscordSetupRoleTemplate,
  DiscordSetupTemplate,
} from "./templates";
import { discordChannelTypeCodes } from "./templates";
import type { DiscordSetupAction } from "./setupTypes";

export const planTemplatePermissionOverwrites = (options: {
  template: DiscordSetupTemplate;
  roleIds: Map<string, string>;
  channelIds: Map<string, string>;
  includeRoles: boolean;
  guildId?: string | undefined;
}): DiscordSetupAction[] => {
  const channelTemplates = new Set(
    options.template.channels.map((channel) => channel.id),
  );
  const roleTemplates = new Set(options.template.roles.map((role) => role.id));

  return (options.template.permissionOverwrites ?? []).map((overwrite) => {
    const channelResolvable =
      options.channelIds.has(overwrite.channelId) ||
      channelTemplates.has(overwrite.channelId);
    const roleResolvable =
      overwrite.roleId === "@everyone"
        ? Boolean(options.guildId)
        : options.roleIds.has(overwrite.roleId) ||
          (options.includeRoles && roleTemplates.has(overwrite.roleId));

    if (!channelResolvable || !roleResolvable) {
      return {
        type: "blocked_permission",
        templateId: overwrite.id,
        name: overwrite.id,
        detail: !channelResolvable
          ? `Permission target channel ${overwrite.channelId} is not part of this setup.`
          : `Permission target role ${overwrite.roleId} is not available. Enable preset role creation or save/select an existing role.`,
      };
    }

    return {
      type: "apply_permission_overwrite",
      templateId: overwrite.id,
      name: overwrite.id,
      detail:
        overwrite.detail ??
        `Applies Discord permission overwrite ${overwrite.id}.`,
    };
  });
};

export const planStarterMessages = (options: {
  template: DiscordSetupTemplate;
  channelIds: Map<string, string>;
  existingMessageIds: Record<string, string>;
}): DiscordSetupAction[] => {
  const channelTemplates = new Set(
    options.template.channels.map((channel) => channel.id),
  );

  return (options.template.starterMessages ?? []).map((message) => {
    if (options.existingMessageIds[message.id]) {
      return {
        type: "skip_starter_message",
        templateId: message.id,
        name: message.id,
        detail: `Starter message ${message.id} has already been posted.`,
      };
    }
    if (
      !options.channelIds.has(message.channelId) &&
      !channelTemplates.has(message.channelId)
    ) {
      return {
        type: "blocked_starter_message",
        templateId: message.id,
        name: message.id,
        detail: `Starter message target channel ${message.channelId} is not part of this setup.`,
      };
    }
    return {
      type: "post_starter_message",
      templateId: message.id,
      name: message.id,
      detail: `Posts to ${message.channelId}: ${message.content}`,
    };
  });
};

export const findExistingRole = (
  roles: DiscordGuildRole[],
  template: DiscordSetupRoleTemplate,
) =>
  roles.find(
    (role) => normalizeRoleName(role.name) === normalizeRoleName(template.name),
  );

export const findExistingChannel = (
  channels: DiscordGuildChannel[],
  template: DiscordSetupChannelTemplate,
  parentDiscordId?: string | null,
) => {
  const expectedType = discordChannelTypeCodes[template.kind];
  const expectedName = normalizeChannelName(template.name);
  const matches = channels.filter(
    (channel) =>
      discordChannelMatchesTemplateType(channel.type, expectedType, template) &&
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

export const permissionOverwriteChannelName = (
  template: DiscordSetupTemplate,
  overwrite: DiscordSetupPermissionOverwriteTemplate,
) =>
  template.channels.find((channel) => channel.id === overwrite.channelId)
    ?.name ?? overwrite.channelId;

export const permissionOverwriteRoleName = (
  template: DiscordSetupTemplate,
  overwrite: DiscordSetupPermissionOverwriteTemplate,
) =>
  overwrite.roleId === "@everyone"
    ? "@everyone"
    : (template.roles.find((role) => role.id === overwrite.roleId)?.name ??
      overwrite.roleId);

const discordChannelMatchesTemplateType = (
  actualType: number,
  expectedType: number,
  template: DiscordSetupChannelTemplate,
) =>
  actualType === expectedType ||
  (template.id === "announcements" &&
    template.kind === "text" &&
    actualType === 5);

const normalizeRoleName = (name: string) =>
  name.trim().replace(/\s+/g, " ").toLowerCase();

const normalizeChannelName = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
