import type { ChatMessage } from "../../core/chatMessage";
import { writeAuditLog } from "../../core/auditLog";
import {
  allowedLinkFromRow,
  blockedLinkFromRow,
  linkPermitFromRow,
} from "./moderation.mappers";
import {
  domainMatchesAllowed,
  findLinkDomains,
  messagePreview,
  normalizeAllowedDomain,
  normalizeLogin,
  parseSafeInteger,
  timestamp,
  unique,
} from "./moderation.normalization";
import {
  moderationLimits,
  type ModerationAllowedLink,
  type ModerationAllowedLinkRow,
  type ModerationBlockedLink,
  type ModerationBlockedLinkRow,
  type ModerationEvaluation,
  type ModerationLinkPermit,
  type ModerationLinkPermitRow,
  type ModerationServiceContext,
} from "./moderation.types";

export const listModerationAllowedLinks = (
  context: ModerationServiceContext,
): ModerationAllowedLink[] =>
  (
    context.db
      .prepare(
        `
        SELECT *
        FROM moderation_allowed_links
        ORDER BY domain ASC
      `,
      )
      .all() as ModerationAllowedLinkRow[]
  ).map(allowedLinkFromRow);

export const saveModerationAllowedLink = (
  context: ModerationServiceContext,
  input: unknown,
  actor: ChatMessage,
) => {
  const body = input as { id?: number; domain?: unknown; enabled?: unknown };
  const existing = body.id
    ? requireModerationAllowedLinkRow(context, Number(body.id))
    : undefined;
  const domain = normalizeAllowedDomain(body.domain ?? existing?.domain);
  const enabled =
    body.enabled === undefined
      ? existing
        ? existing.enabled === 1
        : true
      : Boolean(body.enabled);
  const now = timestamp();
  const current = findModerationAllowedLink(context, domain);

  if (current && current.id !== existing?.id) {
    throw new Error(`Allowed domain "${domain}" already exists.`);
  }

  if (existing) {
    context.db
      .prepare(
        `
          UPDATE moderation_allowed_links
          SET domain = @domain,
              enabled = @enabled,
              updated_at = @updatedAt
          WHERE id = @id
        `,
      )
      .run({
        id: existing.id,
        domain,
        enabled: enabled ? 1 : 0,
        updatedAt: now,
      });
  } else {
    context.db
      .prepare(
        `
          INSERT INTO moderation_allowed_links (domain, enabled, created_at, updated_at)
          VALUES (@domain, @enabled, @createdAt, @updatedAt)
        `,
      )
      .run({
        domain,
        enabled: enabled ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      });
  }

  const saved = findModerationAllowedLink(context, domain);

  writeAuditLog(
    context.db,
    actor,
    existing
      ? "moderation.allowed_link_update"
      : "moderation.allowed_link_create",
    `moderation_allowed_link:${saved?.id ?? domain}`,
    { domain, enabled },
  );
};

export const setModerationAllowedLinkEnabled = (
  context: ModerationServiceContext,
  id: number,
  enabled: boolean,
  actor: ChatMessage,
) => {
  const row = requireModerationAllowedLinkRow(context, id);
  const now = timestamp();

  context.db
    .prepare(
      `
        UPDATE moderation_allowed_links
        SET enabled = @enabled,
            updated_at = @updatedAt
        WHERE id = @id
      `,
    )
    .run({ id, enabled: enabled ? 1 : 0, updatedAt: now });

  writeAuditLog(
    context.db,
    actor,
    enabled
      ? "moderation.allowed_link_enable"
      : "moderation.allowed_link_disable",
    `moderation_allowed_link:${id}`,
    { domain: row.domain },
  );
};

export const deleteModerationAllowedLink = (
  context: ModerationServiceContext,
  id: number,
  actor: ChatMessage,
) => {
  const row = requireModerationAllowedLinkRow(context, id);

  context.db
    .prepare("DELETE FROM moderation_allowed_links WHERE id = ?")
    .run(id);
  writeAuditLog(
    context.db,
    actor,
    "moderation.allowed_link_delete",
    `moderation_allowed_link:${id}`,
    { domain: row.domain },
  );
};

export const listModerationBlockedLinks = (
  context: ModerationServiceContext,
): ModerationBlockedLink[] =>
  (
    context.db
      .prepare(
        `
        SELECT *
        FROM moderation_blocked_links
        ORDER BY domain ASC
      `,
      )
      .all() as ModerationBlockedLinkRow[]
  ).map(blockedLinkFromRow);

export const saveModerationBlockedLink = (
  context: ModerationServiceContext,
  input: unknown,
  actor: ChatMessage,
) => {
  const body = input as { id?: number; domain?: unknown; enabled?: unknown };
  const existing = body.id
    ? requireModerationBlockedLinkRow(context, Number(body.id))
    : undefined;
  const domain = normalizeAllowedDomain(
    body.domain ?? existing?.domain,
    "Blocked domain",
  );
  const enabled =
    body.enabled === undefined
      ? existing
        ? existing.enabled === 1
        : true
      : Boolean(body.enabled);
  const now = timestamp();
  const current = findModerationBlockedLink(context, domain);

  if (current && current.id !== existing?.id) {
    throw new Error(`Blocked domain "${domain}" already exists.`);
  }

  if (existing) {
    context.db
      .prepare(
        `
          UPDATE moderation_blocked_links
          SET domain = @domain,
              enabled = @enabled,
              updated_at = @updatedAt
          WHERE id = @id
        `,
      )
      .run({
        id: existing.id,
        domain,
        enabled: enabled ? 1 : 0,
        updatedAt: now,
      });
  } else {
    context.db
      .prepare(
        `
          INSERT INTO moderation_blocked_links (domain, enabled, created_at, updated_at)
          VALUES (@domain, @enabled, @createdAt, @updatedAt)
        `,
      )
      .run({
        domain,
        enabled: enabled ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      });
  }

  const saved = findModerationBlockedLink(context, domain);

  writeAuditLog(
    context.db,
    actor,
    existing
      ? "moderation.blocked_link_update"
      : "moderation.blocked_link_create",
    `moderation_blocked_link:${saved?.id ?? domain}`,
    { domain, enabled },
  );
};

export const setModerationBlockedLinkEnabled = (
  context: ModerationServiceContext,
  id: number,
  enabled: boolean,
  actor: ChatMessage,
) => {
  const row = requireModerationBlockedLinkRow(context, id);
  const now = timestamp();

  context.db
    .prepare(
      `
        UPDATE moderation_blocked_links
        SET enabled = @enabled,
            updated_at = @updatedAt
        WHERE id = @id
      `,
    )
    .run({ id, enabled: enabled ? 1 : 0, updatedAt: now });

  writeAuditLog(
    context.db,
    actor,
    enabled
      ? "moderation.blocked_link_enable"
      : "moderation.blocked_link_disable",
    `moderation_blocked_link:${id}`,
    { domain: row.domain },
  );
};

export const deleteModerationBlockedLink = (
  context: ModerationServiceContext,
  id: number,
  actor: ChatMessage,
) => {
  const row = requireModerationBlockedLinkRow(context, id);

  context.db
    .prepare("DELETE FROM moderation_blocked_links WHERE id = ?")
    .run(id);
  writeAuditLog(
    context.db,
    actor,
    "moderation.blocked_link_delete",
    `moderation_blocked_link:${id}`,
    { domain: row.domain },
  );
};

export const listModerationLinkPermits = (
  context: ModerationServiceContext,
  limit = 25,
): ModerationLinkPermit[] => {
  const safeLimit = parseSafeInteger(limit, {
    field: "Moderation link permit limit",
    fallback: 25,
    min: 1,
    max: moderationLimits.linkPermitLimit,
  });

  return (
    context.db
      .prepare(
        `
        SELECT *
        FROM moderation_link_permits
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `,
      )
      .all(safeLimit) as ModerationLinkPermitRow[]
  ).map(linkPermitFromRow);
};

export const grantModerationLinkPermit = (
  context: ModerationServiceContext,
  input: unknown,
  actor: ChatMessage,
) => {
  const body = input as { userLogin?: unknown; minutes?: unknown };
  const userLogin = normalizeLogin(body.userLogin, "Permitted username");
  const minutes = parseSafeInteger(body.minutes, {
    field: "Permit minutes",
    fallback: 5,
    min: 1,
    max: 120,
  });
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + minutes * 60_000).toISOString();

  context.db
    .prepare(
      `
        INSERT INTO moderation_link_permits (
          user_login,
          expires_at,
          used_at,
          created_at,
          created_by
        ) VALUES (
          @userLogin,
          @expiresAt,
          '',
          @createdAt,
          @createdBy
        )
      `,
    )
    .run({
      userLogin,
      expiresAt,
      createdAt,
      createdBy: actor.userLogin,
    });

  writeAuditLog(
    context.db,
    actor,
    "moderation.link_permit_create",
    `moderation_link_permit:${userLogin}`,
    { userLogin, minutes, expiresAt },
    { createdAt },
  );
};

export const enabledModerationAllowedLinks = (
  context: ModerationServiceContext,
) => listModerationAllowedLinks(context).filter((link) => link.enabled);

export const enabledModerationBlockedLinks = (
  context: ModerationServiceContext,
) => listModerationBlockedLinks(context).filter((link) => link.enabled);

export const inspectModerationLinks = (
  context: ModerationServiceContext,
  message: ChatMessage,
  consumePermit: boolean,
) => {
  const domains = unique(findLinkDomains(message.text));

  if (!domains.length) {
    return {
      allowed: [],
      blocked: [],
      explicitBlocked: [],
      consumedPermit: undefined,
    };
  }

  const allowedEntries = enabledModerationAllowedLinks(context);
  const blockedEntries = enabledModerationBlockedLinks(context);
  const explicitBlocked = domains.filter((domain) =>
    blockedEntries.some((entry) => domainMatchesAllowed(domain, entry.domain)),
  );
  const allowed = domains.filter(
    (domain) =>
      !explicitBlocked.includes(domain) &&
      allowedEntries.some((entry) =>
        domainMatchesAllowed(domain, entry.domain),
      ),
  );
  const untrusted = domains.filter(
    (domain) => !allowed.includes(domain) && !explicitBlocked.includes(domain),
  );
  const stillBlocked = unique([...explicitBlocked, ...untrusted]);

  if (!stillBlocked.length) {
    return {
      allowed,
      blocked: [],
      explicitBlocked: [],
      consumedPermit: undefined,
    };
  }

  const permit = activeModerationLinkPermit(context, message.userLogin);

  if (!permit || explicitBlocked.length) {
    return {
      allowed,
      blocked: stillBlocked,
      explicitBlocked,
      consumedPermit: undefined,
    };
  }

  let consumedPermit: ModerationEvaluation["consumedPermit"] | undefined = {
    id: permit.id,
    userLogin: permit.user_login,
    expiresAt: permit.expires_at,
  };

  if (consumePermit) {
    consumedPermit = consumeModerationLinkPermit(context, permit, message);
  }

  return {
    allowed,
    blocked: [],
    explicitBlocked: [],
    consumedPermit,
  };
};

export const activeModerationLinkPermit = (
  context: ModerationServiceContext,
  userLogin: string,
) => {
  const login = normalizeLogin(userLogin, "Username");
  return context.db
    .prepare(
      `
        SELECT *
        FROM moderation_link_permits
        WHERE user_login = ?
          AND used_at = ''
          AND expires_at > ?
        ORDER BY expires_at DESC, id DESC
        LIMIT 1
      `,
    )
    .get(login, timestamp()) as ModerationLinkPermitRow | undefined;
};

const consumeModerationLinkPermit = (
  context: ModerationServiceContext,
  permit: ModerationLinkPermitRow,
  message: ChatMessage,
) => {
  const usedAt = timestamp();

  context.db
    .prepare(
      `
        UPDATE moderation_link_permits
        SET used_at = @usedAt
        WHERE id = @id
          AND used_at = ''
      `,
    )
    .run({ id: permit.id, usedAt });

  writeAuditLog(
    context.db,
    message,
    "moderation.link_permit_consume",
    `moderation_link_permit:${permit.id}`,
    {
      userLogin: permit.user_login,
      messagePreview: messagePreview(message.text),
    },
    { createdAt: usedAt },
  );

  return {
    id: permit.id,
    userLogin: permit.user_login,
    expiresAt: permit.expires_at,
  };
};

const requireModerationAllowedLinkRow = (
  context: ModerationServiceContext,
  id: number,
) => {
  const row = context.db
    .prepare("SELECT * FROM moderation_allowed_links WHERE id = ?")
    .get(id) as ModerationAllowedLinkRow | undefined;

  if (!row) {
    throw new Error(`Allowed domain #${id} was not found.`);
  }

  return row;
};

const findModerationAllowedLink = (
  context: ModerationServiceContext,
  domain: string,
) => {
  const row = context.db
    .prepare("SELECT * FROM moderation_allowed_links WHERE domain = ?")
    .get(domain) as ModerationAllowedLinkRow | undefined;

  return row ? allowedLinkFromRow(row) : undefined;
};

const requireModerationBlockedLinkRow = (
  context: ModerationServiceContext,
  id: number,
) => {
  const row = context.db
    .prepare("SELECT * FROM moderation_blocked_links WHERE id = ?")
    .get(id) as ModerationBlockedLinkRow | undefined;

  if (!row) {
    throw new Error(`Blocked domain #${id} was not found.`);
  }

  return row;
};

const findModerationBlockedLink = (
  context: ModerationServiceContext,
  domain: string,
) => {
  const row = context.db
    .prepare("SELECT * FROM moderation_blocked_links WHERE domain = ?")
    .get(domain) as ModerationBlockedLinkRow | undefined;

  return row ? blockedLinkFromRow(row) : undefined;
};
