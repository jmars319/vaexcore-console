import type {
  DiscordGuildChannel,
  DiscordPermissionOverwriteInput,
} from "./client";
import type { DiscordPermissionName } from "./templates";

export const viewChannelPermissionBit = "1024";

const discordPermissionBits: Record<DiscordPermissionName, bigint> = {
  view_channel: 1n << 10n,
  send_messages: 1n << 11n,
  send_messages_in_threads: 1n << 38n,
  read_message_history: 1n << 16n,
  add_reactions: 1n << 6n,
  embed_links: 1n << 14n,
  attach_files: 1n << 15n,
  manage_messages: 1n << 13n,
  connect: 1n << 20n,
  speak: 1n << 21n,
};

export const permissionBitfield = (permissions: DiscordPermissionName[]) =>
  permissions
    .reduce((bits, permission) => bits | discordPermissionBits[permission], 0n)
    .toString();

export const channelPermissionOverwriteMatches = (
  channels: DiscordGuildChannel[],
  channelId: string,
  overwriteId: string,
  input: DiscordPermissionOverwriteInput,
) => {
  const existing = channels
    .find((channel) => channel.id === channelId)
    ?.permission_overwrites?.find((overwrite) => overwrite.id === overwriteId);
  return (
    existing?.type === input.type &&
    bitfieldsEqual(existing.allow, input.allow) &&
    bitfieldsEqual(existing.deny, input.deny)
  );
};

export const recordChannelPermissionOverwrite = (
  channels: DiscordGuildChannel[],
  channelId: string,
  overwriteId: string,
  input: DiscordPermissionOverwriteInput,
) => {
  const channel = channels.find((item) => item.id === channelId);
  if (!channel) return;
  const overwrites = channel.permission_overwrites ?? [];
  const next = {
    id: overwriteId,
    type: input.type,
    allow: input.allow,
    deny: input.deny,
  };
  const index = overwrites.findIndex(
    (overwrite) => overwrite.id === overwriteId,
  );
  if (index >= 0) {
    overwrites[index] = next;
  } else {
    overwrites.push(next);
  }
  channel.permission_overwrites = overwrites;
};

const bitfieldsEqual = (left: string | undefined, right: string | undefined) =>
  BigInt(left ?? "0") === BigInt(right ?? "0");
