import type { ChatMessage } from "../../core/chatMessage";
import type { MessageQueueMetadata } from "../../core/messageQueue";
import type { PermissionLevel } from "../../core/permissions";

export type CustomCommandRow = {
  id: number;
  name: string;
  permission: PermissionLevel;
  enabled: number;
  global_cooldown_seconds: number;
  user_cooldown_seconds: number;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CustomCommandInvocationRow = {
  id: number;
  command_id: number | null;
  command_name: string;
  alias_used: string;
  user_key: string;
  user_login: string;
  response_text: string;
  created_at: string;
};

export type CustomCommandDefinition = {
  id: number;
  name: string;
  permission: PermissionLevel;
  enabled: boolean;
  globalCooldownSeconds: number;
  userCooldownSeconds: number;
  useCount: number;
  lastUsedAt: string;
  createdAt: string;
  updatedAt: string;
  aliases: string[];
  responses: string[];
};

export type CustomCommandSaveInput = {
  id?: number;
  name?: unknown;
  permission?: unknown;
  enabled?: unknown;
  globalCooldownSeconds?: unknown;
  userCooldownSeconds?: unknown;
  aliases?: unknown;
  responses?: unknown;
  responseText?: unknown;
};

export type CustomCommandInvocation = {
  id: number;
  commandId?: number;
  commandName: string;
  aliasUsed: string;
  userKey: string;
  userLogin: string;
  responseText: string;
  createdAt: string;
};

export type CustomCommandContext = {
  message: ChatMessage;
  name: string;
  args: string[];
  rawArgs: string;
  reply: (message: string, metadata?: MessageQueueMetadata) => void;
};
