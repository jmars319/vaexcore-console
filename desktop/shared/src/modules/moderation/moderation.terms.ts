import type { ChatMessage } from "../../core/chatMessage";
import { writeAuditLog } from "../../core/auditLog";
import { termFromRow } from "./moderation.mappers";
import { normalizeBlockedTerm, timestamp } from "./moderation.normalization";
import type {
  ModerationServiceContext,
  ModerationTerm,
  ModerationTermRow,
} from "./moderation.types";

export const listModerationTerms = (
  context: ModerationServiceContext,
): ModerationTerm[] =>
  (
    context.db
      .prepare(
        `
        SELECT *
        FROM moderation_blocked_terms
        ORDER BY term ASC
      `,
      )
      .all() as ModerationTermRow[]
  ).map(termFromRow);

export const saveModerationTerm = (
  context: ModerationServiceContext,
  input: unknown,
  actor: ChatMessage,
) => {
  const body = input as { id?: number; term?: unknown; enabled?: unknown };
  const existing = body.id
    ? requireModerationTermRow(context, Number(body.id))
    : undefined;
  const term = normalizeBlockedTerm(body.term ?? existing?.term);
  const enabled =
    body.enabled === undefined
      ? existing
        ? existing.enabled === 1
        : true
      : Boolean(body.enabled);
  const now = timestamp();
  const current = findModerationTerm(context, term);

  if (current && current.id !== existing?.id) {
    throw new Error(`Blocked term "${term}" already exists.`);
  }

  if (existing) {
    context.db
      .prepare(
        `
          UPDATE moderation_blocked_terms
          SET term = @term,
              enabled = @enabled,
              updated_at = @updatedAt
          WHERE id = @id
        `,
      )
      .run({
        id: existing.id,
        term,
        enabled: enabled ? 1 : 0,
        updatedAt: now,
      });
  } else {
    context.db
      .prepare(
        `
          INSERT INTO moderation_blocked_terms (term, enabled, created_at, updated_at)
          VALUES (@term, @enabled, @createdAt, @updatedAt)
        `,
      )
      .run({
        term,
        enabled: enabled ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      });
  }

  const saved = findModerationTerm(context, term);

  writeAuditLog(
    context.db,
    actor,
    existing ? "moderation.term_update" : "moderation.term_create",
    `moderation_term:${saved?.id ?? term}`,
    { term, enabled },
  );
};

export const setModerationTermEnabled = (
  context: ModerationServiceContext,
  id: number,
  enabled: boolean,
  actor: ChatMessage,
) => {
  const row = requireModerationTermRow(context, id);
  const now = timestamp();

  context.db
    .prepare(
      `
        UPDATE moderation_blocked_terms
        SET enabled = @enabled,
            updated_at = @updatedAt
        WHERE id = @id
      `,
    )
    .run({ id, enabled: enabled ? 1 : 0, updatedAt: now });

  writeAuditLog(
    context.db,
    actor,
    enabled ? "moderation.term_enable" : "moderation.term_disable",
    `moderation_term:${id}`,
    { term: row.term },
  );
};

export const deleteModerationTerm = (
  context: ModerationServiceContext,
  id: number,
  actor: ChatMessage,
) => {
  const row = requireModerationTermRow(context, id);

  context.db
    .prepare("DELETE FROM moderation_blocked_terms WHERE id = ?")
    .run(id);
  writeAuditLog(
    context.db,
    actor,
    "moderation.term_delete",
    `moderation_term:${id}`,
    { term: row.term },
  );
};

export const enabledModerationTerms = (context: ModerationServiceContext) =>
  listModerationTerms(context).filter((term) => term.enabled);

export const requireModerationTermRow = (
  context: ModerationServiceContext,
  id: number,
) => {
  const row = context.db
    .prepare("SELECT * FROM moderation_blocked_terms WHERE id = ?")
    .get(id) as ModerationTermRow | undefined;

  if (!row) {
    throw new Error(`Blocked term #${id} was not found.`);
  }

  return row;
};

const findModerationTerm = (
  context: ModerationServiceContext,
  term: string,
) => {
  const row = context.db
    .prepare("SELECT * FROM moderation_blocked_terms WHERE term = ?")
    .get(term) as ModerationTermRow | undefined;

  return row ? termFromRow(row) : undefined;
};
