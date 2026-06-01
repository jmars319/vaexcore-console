import type { ChatMessage } from "../../core/chatMessage";
import { writeAuditLog } from "../../core/auditLog";
import { hitFromRow } from "./moderation.mappers";
import {
  messagePreview,
  parseSafeInteger,
  timestamp,
  userKey,
} from "./moderation.normalization";
import {
  moderationLimits,
  type ModerationAction,
  type ModerationFilterType,
  type ModerationHit,
  type ModerationHitRow,
  type ModerationServiceContext,
} from "./moderation.types";

export const listModerationRecentHits = (
  context: ModerationServiceContext,
  limit = 50,
): ModerationHit[] => {
  const safeLimit = parseSafeInteger(limit, {
    field: "Moderation hit limit",
    fallback: 50,
    min: 1,
    max: moderationLimits.hitLimit,
  });

  return (
    context.db
      .prepare(
        `
        SELECT *
        FROM moderation_hits
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `,
      )
      .all(safeLimit) as ModerationHitRow[]
  ).map(hitFromRow);
};

export const recordModerationHit = (
  context: ModerationServiceContext,
  message: ChatMessage,
  filterTypes: ModerationFilterType[],
  action: ModerationAction,
  detail: string,
  warningMessage: string,
) => {
  const now = timestamp();
  const preview = messagePreview(message.text);

  context.db
    .prepare(
      `
        INSERT INTO moderation_hits (
          filter_type,
          action,
          user_key,
          user_login,
          message_preview,
          detail,
          created_at
        ) VALUES (
          @filterType,
          @action,
          @userKey,
          @userLogin,
          @messagePreview,
          @detail,
          @createdAt
        )
      `,
    )
    .run({
      filterType: filterTypes.join(","),
      action,
      userKey: userKey(message),
      userLogin: message.userLogin,
      messagePreview: preview,
      detail,
      createdAt: now,
    });

  writeAuditLog(
    context.db,
    message,
    "moderation.hit",
    `moderation:${filterTypes.join(",")}`,
    {
      filterTypes,
      action,
      userLogin: message.userLogin,
      detail,
      messagePreview: preview,
      warningPreview: messagePreview(warningMessage),
    },
    { createdAt: now },
  );
};

export const countRecentModerationHitsForUser = (
  context: ModerationServiceContext,
  message: ChatMessage,
  windowSeconds: number,
) => {
  const cutoff = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const row = context.db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM moderation_hits
        WHERE user_key = ?
          AND created_at >= ?
      `,
    )
    .get(userKey(message), cutoff) as { count?: number } | undefined;

  return Number(row?.count ?? 0);
};
