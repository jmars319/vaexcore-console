import type { ChatMessage } from "../../core/chatMessage";
import { writeAuditLog } from "../../core/auditLog";
import type { GiveawaysServiceContext } from "./giveaways.serviceTypes";

export const auditGiveaway = (
  context: GiveawaysServiceContext,
  actor: ChatMessage,
  action: string,
  target: string,
  metadata: Record<string, unknown>,
) => {
  writeAuditLog(context.db, actor, action, target, metadata);
};
