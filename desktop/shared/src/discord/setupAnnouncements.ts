import type { DiscordApiClient, DiscordCreateMessageInput } from "./client";
import {
  defaultAnnouncementDetail,
  defaultAnnouncementTitle,
  normalizeDiscordSnowflake,
  sanitizeOptionalLongText,
  sanitizeOptionalText,
  sanitizeOptionalUrl,
} from "./setupNormalization";
import type { DiscordAnnouncementInput } from "./setupTypes";

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
