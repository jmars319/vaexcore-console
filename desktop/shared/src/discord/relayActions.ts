import type { DbClient } from "../db/client";
import {
  parseSafeInteger,
  redactSecrets,
  safeJsonStringify,
} from "../core/security";
import type { DiscordRelayEvent } from "./relay";

export const discordRelayActionStatuses = [
  "queued",
  "approved",
  "rejected",
  "sent",
] as const;

export type DiscordRelayActionStatus =
  (typeof discordRelayActionStatuses)[number];

export type DiscordRelayActionRecord = {
  relayEventId: string;
  id: string;
  commandName: string;
  kind: string;
  userId: string;
  username: string;
  guildId: string;
  channelId: string;
  options: Record<string, string | number | boolean>;
  allowed: boolean;
  receivedAt: string;
  loadedAt: string;
  updatedAt: string;
  status: DiscordRelayActionStatus;
  approvedAt: string | null;
  rejectedAt: string | null;
  sentAt: string | null;
};

export type DiscordRelayActionRow = {
  relay_event_id: string;
  interaction_id: string;
  command_name: string;
  kind: string;
  user_id: string;
  username: string;
  guild_id: string;
  channel_id: string;
  payload_json: string;
  status: DiscordRelayActionStatus;
  received_at: string;
  loaded_at: string;
  updated_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  sent_at: string | null;
};

const announcementCommands = new Set([
  "live",
  "late",
  "cancelled",
  "scheduled",
]);

export const persistDiscordRelayActions = (
  db: DbClient,
  events: DiscordRelayEvent[],
  now = timestamp(),
) => {
  const actions = events.filter(isDiscordRelayAnnouncementAction);

  for (const event of actions) {
    db.prepare(
      `
        INSERT INTO discord_relay_actions (
          relay_event_id, interaction_id, command_name, kind, user_id, username,
          guild_id, channel_id, payload_json, status, received_at, loaded_at, updated_at
        ) VALUES (
          @relayEventId, @interactionId, @commandName, @kind, @userId, @username,
          @guildId, @channelId, @payloadJson, 'queued', @receivedAt, @loadedAt, @updatedAt
        )
        ON CONFLICT(relay_event_id) DO UPDATE SET
          interaction_id = excluded.interaction_id,
          command_name = excluded.command_name,
          kind = excluded.kind,
          user_id = excluded.user_id,
          username = excluded.username,
          guild_id = excluded.guild_id,
          channel_id = excluded.channel_id,
          payload_json = excluded.payload_json,
          received_at = excluded.received_at,
          updated_at = excluded.updated_at
      `,
    ).run({
      relayEventId: event.relayEventId,
      interactionId: event.id ?? "",
      commandName: event.commandName,
      kind: event.kind,
      userId: event.userId ?? "",
      username: event.username ?? "",
      guildId: event.guildId ?? "",
      channelId: event.channelId ?? "",
      payloadJson: safeJsonStringify(
        redactSecrets(event) as Record<string, unknown>,
      ),
      receivedAt: event.receivedAt || now,
      loadedAt: now,
      updatedAt: now,
    });
  }

  return actions.length;
};

export const listDiscordRelayActions = (
  db: DbClient,
  options: {
    status?: DiscordRelayActionStatus | "active";
    limit?: unknown;
  } = {},
) => {
  const limit = parseSafeInteger(options.limit, {
    field: "Discord Relay action limit",
    fallback: 50,
    min: 1,
    max: 200,
  });
  const status = options.status;
  const query =
    status === "active"
      ? `
        SELECT *
        FROM discord_relay_actions
        WHERE status IN ('queued', 'approved')
        ORDER BY received_at DESC, updated_at DESC
        LIMIT ?
      `
      : status
        ? `
          SELECT *
          FROM discord_relay_actions
          WHERE status = ?
          ORDER BY received_at DESC, updated_at DESC
          LIMIT ?
        `
        : `
          SELECT *
          FROM discord_relay_actions
          ORDER BY received_at DESC, updated_at DESC
          LIMIT ?
        `;
  const rows =
    status && status !== "active"
      ? (db.prepare(query).all(status, limit) as DiscordRelayActionRow[])
      : (db.prepare(query).all(limit) as DiscordRelayActionRow[]);
  return rows.map(safeDiscordRelayActionRecord);
};

export const updateDiscordRelayActionStatus = (
  db: DbClient,
  relayEventId: string,
  status: DiscordRelayActionStatus,
  now = timestamp(),
) => {
  const timestampColumn = status === "queued" ? null : `${status}_at`;
  const result = timestampColumn
    ? db
        .prepare(
          `
            UPDATE discord_relay_actions
            SET status = ?, updated_at = ?, ${timestampColumn} = ?
            WHERE relay_event_id = ?
          `,
        )
        .run(status, now, now, relayEventId)
    : db
        .prepare(
          `
            UPDATE discord_relay_actions
            SET status = ?, updated_at = ?
            WHERE relay_event_id = ?
          `,
        )
        .run(status, now, relayEventId);

  if (!result.changes) {
    return null;
  }

  return getDiscordRelayAction(db, relayEventId);
};

export const getDiscordRelayAction = (db: DbClient, relayEventId: string) => {
  const row = db
    .prepare("SELECT * FROM discord_relay_actions WHERE relay_event_id = ?")
    .get(relayEventId) as DiscordRelayActionRow | undefined;
  return row ? safeDiscordRelayActionRecord(row) : null;
};

export const parseDiscordRelayActionStatus = (
  value: unknown,
): DiscordRelayActionStatus => {
  if (
    typeof value === "string" &&
    discordRelayActionStatuses.includes(value as DiscordRelayActionStatus)
  ) {
    return value as DiscordRelayActionStatus;
  }
  throw new Error(
    "Discord Relay action status must be queued, approved, rejected, or sent.",
  );
};

export const parseDiscordRelayActionFilter = (
  value: unknown,
): DiscordRelayActionStatus | "active" | undefined => {
  if (value === undefined || value === null || value === "") return "active";
  if (value === "active") return "active";
  return parseDiscordRelayActionStatus(value);
};

export const isDiscordRelayAnnouncementAction = (event: DiscordRelayEvent) =>
  event.kind === "announcement" && announcementCommands.has(event.commandName);

const safeDiscordRelayActionRecord = (
  row: DiscordRelayActionRow,
): DiscordRelayActionRecord => {
  const payload = parsePayload(row.payload_json);
  return {
    relayEventId: row.relay_event_id,
    id: row.interaction_id,
    commandName: row.command_name,
    kind: row.kind,
    userId: row.user_id,
    username: row.username,
    guildId: row.guild_id,
    channelId: row.channel_id,
    options: optionRecord(payload.options),
    allowed: payload.allowed !== false,
    receivedAt: row.received_at,
    loadedAt: row.loaded_at,
    updatedAt: row.updated_at,
    status: row.status,
    approvedAt: row.approved_at,
    rejectedAt: row.rejected_at,
    sentAt: row.sent_at,
  };
};

const parsePayload = (raw: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const optionRecord = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, item]) =>
      ["string", "number", "boolean"].includes(typeof item),
    ),
  ) as Record<string, string | number | boolean>;
};

const timestamp = () => new Date().toISOString();
