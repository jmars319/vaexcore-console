import type {
  CustomCommandInvocation,
  CustomCommandInvocationRow,
} from "./commands.types";

export const invocationFromRow = (
  row: CustomCommandInvocationRow,
): CustomCommandInvocation => ({
  id: row.id,
  commandId: row.command_id ?? undefined,
  commandName: row.command_name,
  aliasUsed: row.alias_used,
  userKey: row.user_key,
  userLogin: row.user_login,
  responseText: row.response_text,
  createdAt: row.created_at,
});
