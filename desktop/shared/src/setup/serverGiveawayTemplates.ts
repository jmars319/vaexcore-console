import {
  GiveawaysService,
  parseSupportedPlatforms,
  type GiveawayFollowAgeResolver,
} from "../modules/giveaways/giveaways.service";
import {
  MessageQueue,
  type MessageQueueEventStatus,
  type MessageQueueMetadata,
} from "../core/messageQueue";
import { getGiveawayTemplates } from "./serverOutbound";
import { giveawayTemplates } from "./serverState";

export const saveGiveawayTemplates = (body: unknown) => ({
  ...getGiveawayTemplates(),
  templates: giveawayTemplates.save(body),
});

export const resetGiveawayTemplates = (actions: unknown) => ({
  ...getGiveawayTemplates(),
  templates: giveawayTemplates.reset(actions),
});

export type GiveawayAnnouncementPhase = {
  id: string;
  label: string;
  actions: [string, ...string[]];
  importance: NonNullable<MessageQueueMetadata["importance"]>;
  requiredWhen: (
    state: ReturnType<GiveawaysService["getLatestGiveawayState"]>,
  ) => boolean;
};

export const giveawayAnnouncementPhases: GiveawayAnnouncementPhase[] = [
  {
    id: "start",
    label: "Start",
    actions: ["start"],
    importance: "critical",
    requiredWhen: (state) => Boolean(state.giveaway),
  },
  {
    id: "reminder",
    label: "Reminder / Last call",
    actions: ["reminder", "last-call"],
    importance: "important",
    requiredWhen: () => false,
  },
  {
    id: "close",
    label: "Close",
    actions: ["close"],
    importance: "critical",
    requiredWhen: (state) =>
      state.giveaway?.status === "closed" || state.giveaway?.status === "ended",
  },
  {
    id: "draw",
    label: "Draw",
    actions: ["draw"],
    importance: "critical",
    requiredWhen: (state) => state.counts.activeWinners > 0,
  },
  {
    id: "end",
    label: "End",
    actions: ["end"],
    importance: "critical",
    requiredWhen: (state) => state.giveaway?.status === "ended",
  },
];

export const getGiveawayAnnouncementPhase = (action: string | undefined) => {
  if (!action) {
    return undefined;
  }

  return giveawayAnnouncementPhases.find(
    (phase) => phase.id === action || phase.actions.includes(action),
  );
};
