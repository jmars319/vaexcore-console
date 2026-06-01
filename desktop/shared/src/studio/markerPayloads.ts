import { sanitizeText } from "../core/security";
import type { Giveaway } from "../modules/giveaways/giveaways.types";
import type { StudioMarkerInput } from "./client";
import { studioConsoleMarkerMetadata } from "./markerMetadata";

export const CONSOLE_CHAT_MARKER_EVENT_TYPE = "console.chat.marker" as const;

export type ConsoleGiveawayStudioAction =
  | "start"
  | "close"
  | "last-call"
  | "draw"
  | "reroll"
  | "end";

export type ConsoleChatMarkerMessage = {
  id?: string | undefined;
  source: string;
  userLogin: string;
  userDisplayName: string;
  receivedAt: Date;
};

export type ConsoleGiveawayStudioMarkerOptions = {
  statusTimestamp?: string | null | undefined;
  sourceEventSuffix?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
};

const giveawayStudioActionLabels: Record<ConsoleGiveawayStudioAction, string> =
  {
    start: "started",
    close: "closed",
    "last-call": "last call",
    draw: "draw",
    reroll: "reroll",
    end: "ended",
  };

export const safeStudioSourceEventPart = (value: string) =>
  value
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

export const consoleChatMarkerSourceEventId = (
  message: ConsoleChatMarkerMessage,
) =>
  message.id
    ? `chat:${message.id}`
    : `chat:${message.source}:${message.userLogin}:${message.receivedAt.toISOString()}`;

export const consoleGiveawayMarkerEventType = (
  action: ConsoleGiveawayStudioAction,
) => `console.giveaway.${action}` as const;

export const consoleGiveawaySourceEventId = ({
  action,
  giveawayId,
  sourceEventSuffix,
}: {
  action: ConsoleGiveawayStudioAction;
  giveawayId: number;
  sourceEventSuffix: string;
}) => `vaexcore-console:giveaway:${giveawayId}:${action}:${sourceEventSuffix}`;

export function buildConsoleChatStudioMarker({
  message,
  rawLabel,
}: {
  message: ConsoleChatMarkerMessage;
  rawLabel: string;
}): StudioMarkerInput {
  const fallback = `chat marker from ${message.userDisplayName}`;
  const label = sanitizeText(rawLabel || fallback, {
    field: "Studio marker label",
    maxLength: 120,
    required: true,
  });

  return {
    label,
    source_app: "vaexcore-console",
    source_event_id: consoleChatMarkerSourceEventId(message),
    metadata: studioConsoleMarkerMetadata(
      CONSOLE_CHAT_MARKER_EVENT_TYPE,
      {
        command: "vcmark",
        chatSource: message.source,
        userLogin: message.userLogin,
        userDisplayName: message.userDisplayName,
        receivedAt: message.receivedAt.toISOString(),
      },
      {
        workflow: "manual-chat-marker",
      },
    ),
  };
}

export function buildConsoleGiveawayStudioMarker(
  action: ConsoleGiveawayStudioAction,
  giveaway: Giveaway,
  options: ConsoleGiveawayStudioMarkerOptions = {},
): StudioMarkerInput {
  const timestamp = options.statusTimestamp ?? new Date().toISOString();
  const sourceEventSuffix =
    options.sourceEventSuffix ?? safeStudioSourceEventPart(timestamp);

  return {
    label: sanitizeText(
      `Console giveaway ${giveawayStudioActionLabels[action]}: ${giveaway.title}`,
      {
        field: "Studio marker label",
        maxLength: 140,
        required: true,
      },
    ),
    source_app: "vaexcore-console",
    source_event_id: consoleGiveawaySourceEventId({
      giveawayId: giveaway.id,
      action,
      sourceEventSuffix,
    }),
    metadata: studioConsoleMarkerMetadata(
      consoleGiveawayMarkerEventType(action),
      {
        giveaway: giveawayMetadata(giveaway),
        ...options.metadata,
      },
    ),
  };
}

export const giveawayMetadata = (giveaway: Giveaway) => ({
  id: giveaway.id,
  title: giveaway.title,
  keyword: giveaway.keyword,
  status: giveaway.status,
  winnerCount: giveaway.winner_count,
  itemName: giveaway.item_name,
  itemEdition: giveaway.item_edition,
  gameName: giveaway.game_name,
  prizeType: giveaway.prize_type,
  createdAt: giveaway.created_at,
  openedAt: giveaway.opened_at,
  closedAt: giveaway.closed_at,
  endedAt: giveaway.ended_at,
});
