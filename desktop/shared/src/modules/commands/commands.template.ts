import type { ChatMessage } from "../../core/chatMessage";
import { sanitizeChatMessage } from "../../core/security";

export const renderTemplate = (
  template: string,
  input: {
    message: ChatMessage;
    args: string[];
    rawArgs: string;
    count: number;
  },
) => {
  const target =
    input.args[0]?.replace(/^@/, "") || input.message.userDisplayName;
  const values: Record<string, string> = {
    user: input.message.userDisplayName || input.message.userLogin,
    displayName: input.message.userDisplayName || input.message.userLogin,
    login: input.message.userLogin,
    args: input.rawArgs,
    target,
    count: String(input.count),
  };

  input.args.slice(0, 9).forEach((arg, index) => {
    values[`arg${index + 1}`] = arg;
  });

  const rendered = template.replace(
    /\{([a-zA-Z][a-zA-Z0-9]*)\}/g,
    (match, key) =>
      Object.prototype.hasOwnProperty.call(values, key)
        ? (values[key] ?? "")
        : match,
  );

  return sanitizeChatMessage(rendered);
};
