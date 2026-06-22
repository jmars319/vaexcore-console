import { getPermissionLevel, hasPermission } from "../../core/permissions";
import {
  limits,
  normalizeCommandName,
  parseSafeInteger,
  sanitizeChatMessage,
} from "../../core/security";
import type { ChatMessage } from "../../core/chatMessage";
import type { DbClient } from "../../db/client";
import { getProtectedCommandNames } from "../../core/protectedCommands";
import { writeAuditLog } from "../../core/auditLog";
import type { FeatureGateStore } from "../../core/featureGates";
import { invocationFromRow } from "./commands.mappers";
import {
  normalizeAliasList,
  normalizeCooldown,
  normalizePermission,
  normalizeResponseList,
  previewActor,
  sanitizePreviewArgs,
  timestamp,
  userKey,
} from "./commands.normalization";
import { renderTemplate } from "./commands.template";
import type {
  CustomCommandContext,
  CustomCommandDefinition,
  CustomCommandInvocation,
  CustomCommandInvocationRow,
  CustomCommandRow,
  CustomCommandSaveInput,
} from "./commands.types";

export type {
  CustomCommandContext,
  CustomCommandDefinition,
  CustomCommandInvocation,
  CustomCommandInvocationRow,
  CustomCommandRow,
  CustomCommandSaveInput,
} from "./commands.types";

/* Command persistence boundary */
export class CustomCommandsService {
  constructor(
    private readonly db: DbClient,
    private readonly options: { featureGates?: FeatureGateStore } = {},
  ) {}

  listCommands(): CustomCommandDefinition[] {
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM custom_commands
          ORDER BY name ASC
        `,
      )
      .all() as CustomCommandRow[];

    return rows.map((row) => this.definitionFromRow(row));
  }

  getRecentInvocations(limit = 50): CustomCommandInvocation[] {
    const safeLimit = parseSafeInteger(limit, {
      field: "History limit",
      fallback: 50,
      min: 1,
      max: 200,
    });

    return (
      this.db
        .prepare(
          `
          SELECT *
          FROM custom_command_invocations
          ORDER BY created_at DESC
          LIMIT ?
        `,
        )
        .all(safeLimit) as CustomCommandInvocationRow[]
    ).map(invocationFromRow);
  }

  /* Command mutation path */
  saveCommand(
    input: CustomCommandSaveInput,
    actor: ChatMessage,
    options: { reservedNames?: string[] } = {},
  ) {
    const existing = input.id
      ? this.requireCommandById(Number(input.id))
      : undefined;
    const existingDefinition = existing
      ? this.definitionFromRow(existing)
      : undefined;
    const name = normalizeCommandName(
      input.name ?? existingDefinition?.name,
      "Command name",
    );
    const permission = normalizePermission(
      input.permission ?? existingDefinition?.permission,
    );
    const aliases = normalizeAliasList(
      input.aliases ?? existingDefinition?.aliases ?? [],
    );
    const responses = normalizeResponseList(
      input.responses ??
        input.responseText ??
        existingDefinition?.responses ??
        [],
    );
    const enabled =
      input.enabled === undefined
        ? (existingDefinition?.enabled ?? true)
        : Boolean(input.enabled);
    const globalCooldownSeconds = normalizeCooldown(
      input.globalCooldownSeconds,
      existingDefinition?.globalCooldownSeconds ?? 30,
      "Global cooldown",
    );
    const userCooldownSeconds = normalizeCooldown(
      input.userCooldownSeconds,
      existingDefinition?.userCooldownSeconds ?? 10,
      "User cooldown",
    );

    this.assertNameAllowed(name, existing?.id, options.reservedNames);
    this.assertAliasesAllowed(
      name,
      aliases,
      existing?.id,
      options.reservedNames,
    );

    const now = timestamp();
    this.db.exec("BEGIN");

    try {
      let commandId = existing?.id;

      if (existing) {
        this.db
          .prepare(
            `
              UPDATE custom_commands
              SET
                name = @name,
                permission = @permission,
                enabled = @enabled,
                global_cooldown_seconds = @globalCooldownSeconds,
                user_cooldown_seconds = @userCooldownSeconds,
                updated_at = @updatedAt
              WHERE id = @id
            `,
          )
          .run({
            id: existing.id,
            name,
            permission,
            enabled: enabled ? 1 : 0,
            globalCooldownSeconds,
            userCooldownSeconds,
            updatedAt: now,
          });
      } else {
        const result = this.db
          .prepare(
            `
              INSERT INTO custom_commands (
                name,
                permission,
                enabled,
                global_cooldown_seconds,
                user_cooldown_seconds,
                created_at,
                updated_at
              ) VALUES (
                @name,
                @permission,
                @enabled,
                @globalCooldownSeconds,
                @userCooldownSeconds,
                @createdAt,
                @updatedAt
              )
            `,
          )
          .run({
            name,
            permission,
            enabled: enabled ? 1 : 0,
            globalCooldownSeconds,
            userCooldownSeconds,
            createdAt: now,
            updatedAt: now,
          });
        commandId = Number(result.lastInsertRowid);
      }

      if (!commandId) {
        throw new Error("Custom command was not saved.");
      }

      this.replaceAliases(commandId, aliases, now);
      this.replaceResponses(commandId, responses, now);
      this.audit(
        actor,
        existing ? "custom_command.update" : "custom_command.create",
        `custom_command:${name}`,
        {
          commandId,
          name,
          aliases,
          permission,
          enabled,
          globalCooldownSeconds,
          userCooldownSeconds,
          responseCount: responses.length,
        },
        now,
      );
      this.db.exec("COMMIT");

      return this.requireCommandDefinition(commandId);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  setEnabled(id: number, enabled: boolean, actor: ChatMessage) {
    const row = this.requireCommandById(id);
    const now = timestamp();

    this.db
      .prepare(
        `
          UPDATE custom_commands
          SET enabled = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(enabled ? 1 : 0, now, id);
    this.audit(
      actor,
      enabled ? "custom_command.enable" : "custom_command.disable",
      `custom_command:${row.name}`,
      {
        commandId: row.id,
        name: row.name,
      },
    );

    return this.requireCommandDefinition(id);
  }

  duplicateCommand(id: number, actor: ChatMessage) {
    const source = this.requireCommandDefinition(id);
    const name = this.nextDuplicateName(source.name);

    return this.saveCommand(
      {
        name,
        permission: source.permission,
        enabled: false,
        globalCooldownSeconds: source.globalCooldownSeconds,
        userCooldownSeconds: source.userCooldownSeconds,
        aliases: [],
        responses: source.responses,
      },
      actor,
    );
  }

  deleteCommand(id: number, actor: ChatMessage) {
    const row = this.requireCommandById(id);

    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM custom_commands WHERE id = ?").run(id);
      this.audit(actor, "custom_command.delete", `custom_command:${row.name}`, {
        commandId: row.id,
        name: row.name,
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    return { id, name: row.name };
  }

  /* Command transfer boundary */
  exportCommands() {
    return {
      version: 1,
      exportedAt: timestamp(),
      commands: this.listCommands().map((command) => ({
        name: command.name,
        permission: command.permission,
        enabled: command.enabled,
        globalCooldownSeconds: command.globalCooldownSeconds,
        userCooldownSeconds: command.userCooldownSeconds,
        aliases: command.aliases,
        responses: command.responses,
        useCount: command.useCount,
        lastUsedAt: command.lastUsedAt,
      })),
    };
  }

  importCommands(
    body: unknown,
    actor: ChatMessage,
    options: { reservedNames?: string[] } = {},
  ) {
    const payload = body as { commands?: unknown[] };
    const commands = Array.isArray(payload.commands) ? payload.commands : [];

    if (commands.length === 0) {
      throw new Error("Import payload must include at least one command.");
    }

    const saved = commands.slice(0, 100).map((entry) => {
      const input = entry as CustomCommandSaveInput;
      const name = normalizeCommandName(input.name, "Command name");
      const existing = this.findCommandByName(name);
      return this.saveCommand({ ...input, id: existing?.id }, actor, options);
    });

    this.audit(actor, "custom_command.import", "custom_commands", {
      imported: saved.length,
      names: saved.map((command) => command.name),
    });

    return saved;
  }

  preview(input: {
    commandId?: number;
    responseText?: unknown;
    actor?: ChatMessage;
    rawArgs?: unknown;
  }) {
    const command = input.commandId
      ? this.requireCommandDefinition(input.commandId)
      : undefined;
    const response = input.responseText
      ? sanitizeChatMessage(input.responseText)
      : (command?.responses[0] ?? "");
    const actor = input.actor ?? previewActor;
    const rawArgs = sanitizePreviewArgs(input.rawArgs);
    return renderTemplate(response, {
      message: actor,
      args: rawArgs ? rawArgs.split(/\s+/) : [],
      rawArgs,
      count: Math.max((command?.useCount ?? 0) + 1, 1),
    });
  }

  /* Chat dispatch boundary */
  handle(context: CustomCommandContext) {
    const lookup = this.findEnabledCommandForName(context.name);

    if (!lookup) {
      return false;
    }

    const gate = this.options.featureGates?.describeAccess(
      "custom_commands",
      context.message.source,
    );

    if (gate && !gate.allowed) {
      return true;
    }

    if (!hasPermission(context.message, lookup.command.permission)) {
      this.audit(
        context.message,
        "custom_command.denied",
        `custom_command:${lookup.command.name}`,
        {
          commandId: lookup.command.id,
          aliasUsed: lookup.aliasUsed,
          userLogin: context.message.userLogin,
          requiredPermission: lookup.command.permission,
          userPermission: getPermissionLevel(context.message),
        },
      );
      return true;
    }

    if (this.isCoolingDown(lookup.command, context.message)) {
      return true;
    }

    const command = lookup.command;
    const responses = this.getResponses(command.id);

    if (responses.length === 0) {
      return true;
    }

    const now = timestamp();
    const responseText =
      responses[Math.floor(Math.random() * responses.length)] ??
      responses[0] ??
      "";
    const nextCount = Number(command.use_count || 0) + 1;
    const rendered = renderTemplate(responseText, {
      message: context.message,
      args: context.args,
      rawArgs: context.rawArgs,
      count: nextCount,
    });

    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `
            UPDATE custom_commands
            SET use_count = use_count + 1,
                last_used_at = @usedAt,
                updated_at = updated_at
            WHERE id = @id
          `,
        )
        .run({ id: command.id, usedAt: now });
      this.db
        .prepare(
          `
            INSERT INTO custom_command_user_cooldowns (
              command_id,
              user_key,
              last_used_at
            ) VALUES (
              @commandId,
              @userKey,
              @lastUsedAt
            )
            ON CONFLICT(command_id, user_key) DO UPDATE SET
              last_used_at = excluded.last_used_at
          `,
        )
        .run({
          commandId: command.id,
          userKey: userKey(context.message),
          lastUsedAt: now,
        });
      this.db
        .prepare(
          `
            INSERT INTO custom_command_invocations (
              command_id,
              command_name,
              alias_used,
              user_key,
              user_login,
              response_text,
              created_at
            ) VALUES (
              @commandId,
              @commandName,
              @aliasUsed,
              @userKey,
              @userLogin,
              @responseText,
              @createdAt
            )
          `,
        )
        .run({
          commandId: command.id,
          commandName: command.name,
          aliasUsed: lookup.aliasUsed,
          userKey: userKey(context.message),
          userLogin: context.message.userLogin,
          responseText: rendered,
          createdAt: now,
        });
      this.audit(
        context.message,
        "custom_command.use",
        `custom_command:${command.name}`,
        {
          commandId: command.id,
          aliasUsed: lookup.aliasUsed,
          userLogin: context.message.userLogin,
          useCount: nextCount,
        },
        now,
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    context.reply(rendered, {
      category: "operator",
      action: `custom:${command.name}`,
      importance: "normal",
    });
    return true;
  }

  private isCoolingDown(command: CustomCommandRow, message: ChatMessage) {
    const now = Date.now();

    if (
      command.global_cooldown_seconds > 0 &&
      command.last_used_at &&
      now - Date.parse(command.last_used_at) <
        command.global_cooldown_seconds * 1000
    ) {
      return true;
    }

    if (command.user_cooldown_seconds <= 0) {
      return false;
    }

    const row = this.db
      .prepare(
        `
          SELECT last_used_at AS lastUsedAt
          FROM custom_command_user_cooldowns
          WHERE command_id = ? AND user_key = ?
        `,
      )
      .get(command.id, userKey(message)) as { lastUsedAt?: string } | undefined;

    return Boolean(
      row?.lastUsedAt &&
      now - Date.parse(row.lastUsedAt) < command.user_cooldown_seconds * 1000,
    );
  }

  /* Name safety boundary */
  private assertNameAllowed(
    name: string,
    currentCommandId: number | undefined,
    extraReservedNames: string[] = [],
  ) {
    const reserved = new Set([
      ...getProtectedCommandNames(),
      ...extraReservedNames.map((item) => normalizeCommandName(item)),
    ]);

    if (reserved.has(name)) {
      throw new Error(`!${name} is reserved by vaexcore console.`);
    }

    const command = this.findCommandByName(name);
    if (command && command.id !== currentCommandId) {
      throw new Error(`!${name} already exists.`);
    }

    const alias = this.findAlias(name);
    if (alias && alias.commandId !== currentCommandId) {
      throw new Error(`!${name} is already used as an alias.`);
    }
  }

  private assertAliasesAllowed(
    name: string,
    aliases: string[],
    currentCommandId: number | undefined,
    extraReservedNames: string[] = [],
  ) {
    if (aliases.includes(name)) {
      throw new Error("An alias cannot match the command name.");
    }

    for (const alias of aliases) {
      this.assertNameAllowed(alias, currentCommandId, extraReservedNames);
    }
  }

  private nextDuplicateName(name: string) {
    for (let index = 1; index < 1000; index += 1) {
      const suffix = index === 1 ? "_copy" : `_copy_${index}`;
      const base = name.slice(
        0,
        Math.max(1, limits.commandNameLength - suffix.length),
      );
      const candidate = normalizeCommandName(`${base}${suffix}`);

      if (
        !this.findCommandByName(candidate) &&
        !this.findAlias(candidate) &&
        !getProtectedCommandNames().includes(candidate)
      ) {
        return candidate;
      }
    }

    throw new Error("Could not find an available duplicate command name.");
  }

  private replaceAliases(commandId: number, aliases: string[], now: string) {
    this.db
      .prepare("DELETE FROM custom_command_aliases WHERE command_id = ?")
      .run(commandId);
    const insert = this.db.prepare(
      `
        INSERT INTO custom_command_aliases (command_id, alias, created_at)
        VALUES (?, ?, ?)
      `,
    );

    for (const alias of aliases) {
      insert.run(commandId, alias, now);
    }
  }

  private replaceResponses(
    commandId: number,
    responses: string[],
    now: string,
  ) {
    this.db
      .prepare("DELETE FROM custom_command_responses WHERE command_id = ?")
      .run(commandId);
    const insert = this.db.prepare(
      `
        INSERT INTO custom_command_responses (command_id, response_text, position, created_at)
        VALUES (?, ?, ?, ?)
      `,
    );

    responses.forEach((response, index) =>
      insert.run(commandId, response, index, now),
    );
  }

  private requireCommandDefinition(id: number) {
    return this.definitionFromRow(this.requireCommandById(id));
  }

  private requireCommandById(id: number) {
    const row = this.db
      .prepare("SELECT * FROM custom_commands WHERE id = ?")
      .get(id) as CustomCommandRow | undefined;

    if (!row) {
      throw new Error(`Custom command #${id} was not found.`);
    }

    return row;
  }

  private findCommandByName(name: string) {
    return this.db
      .prepare("SELECT * FROM custom_commands WHERE name = ?")
      .get(name) as CustomCommandRow | undefined;
  }

  private findAlias(alias: string) {
    return this.db
      .prepare(
        `
          SELECT command_id AS commandId, alias
          FROM custom_command_aliases
          WHERE alias = ?
        `,
      )
      .get(alias) as { commandId: number; alias: string } | undefined;
  }

  private findEnabledCommandForName(name: string) {
    const direct = this.db
      .prepare("SELECT * FROM custom_commands WHERE name = ? AND enabled = 1")
      .get(name) as CustomCommandRow | undefined;

    if (direct) {
      return { command: direct, aliasUsed: name };
    }

    const aliased = this.db
      .prepare(
        `
          SELECT c.*
          FROM custom_command_aliases a
          JOIN custom_commands c ON c.id = a.command_id
          WHERE a.alias = ? AND c.enabled = 1
          LIMIT 1
        `,
      )
      .get(name) as CustomCommandRow | undefined;

    return aliased ? { command: aliased, aliasUsed: name } : undefined;
  }

  /* Row mapping boundary */
  private definitionFromRow(row: CustomCommandRow): CustomCommandDefinition {
    return {
      id: row.id,
      name: row.name,
      permission: row.permission,
      enabled: row.enabled === 1,
      globalCooldownSeconds: row.global_cooldown_seconds,
      userCooldownSeconds: row.user_cooldown_seconds,
      useCount: row.use_count,
      lastUsedAt: row.last_used_at ?? "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      aliases: this.getAliases(row.id),
      responses: this.getResponses(row.id),
    };
  }

  private getAliases(commandId: number) {
    return (
      this.db
        .prepare(
          `
          SELECT alias
          FROM custom_command_aliases
          WHERE command_id = ?
          ORDER BY alias ASC
        `,
        )
        .all(commandId) as { alias: string }[]
    ).map((row) => row.alias);
  }

  private getResponses(commandId: number) {
    return (
      this.db
        .prepare(
          `
          SELECT response_text AS responseText
          FROM custom_command_responses
          WHERE command_id = ?
          ORDER BY position ASC, id ASC
        `,
        )
        .all(commandId) as { responseText: string }[]
    ).map((row) => row.responseText);
  }

  private audit(
    actor: ChatMessage,
    action: string,
    target: string,
    metadata: Record<string, unknown>,
    createdAt = timestamp(),
  ) {
    writeAuditLog(this.db, actor, action, target, metadata, { createdAt });
  }
}

export const getReservedCustomCommandNames = () => getProtectedCommandNames();
