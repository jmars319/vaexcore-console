export const discordChannelTypeCodes = {
  text: 0,
  voice: 2,
  category: 4,
} as const;

export type DiscordChannelKind = keyof typeof discordChannelTypeCodes;

export type DiscordSetupChannelTemplate = {
  id: string;
  name: string;
  kind: DiscordChannelKind;
  parentId?: string;
  topic?: string;
  bitrate?: number;
  userLimit?: number;
  nsfw?: boolean;
};

export type DiscordSetupRoleTemplate = {
  id: string;
  name: string;
  color?: number;
  mentionable?: boolean;
  hoist?: boolean;
};

export type DiscordSetupTemplate = {
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  recommendedFor?: string;
  roles: DiscordSetupRoleTemplate[];
  channels: DiscordSetupChannelTemplate[];
  recommended: {
    streamAnnouncementChannelId: string;
    generalAnnouncementChannelId: string;
    suggestionChannelId: string;
    streamAlertsRoleId: string;
  };
};

export const fullCreatorCommunityDiscordTemplate: DiscordSetupTemplate = {
  schemaVersion: 1,
  id: "full-creator-community",
  name: "Full Creator Server",
  description:
    "A complete creator Discord layout with onboarding, live stream operations, community rooms, content planning, voice, and staff coordination.",
  recommendedFor:
    "Creators who want Console to build the main server structure in one pass before trimming or renaming channels for their community.",
  roles: [
    {
      id: "stream-alerts",
      name: "Stream Alerts",
      color: 0x39d9ff,
      mentionable: true,
      hoist: false,
    },
  ],
  channels: [
    { id: "category-start-here", name: "START HERE", kind: "category" },
    {
      id: "welcome",
      name: "welcome",
      kind: "text",
      parentId: "category-start-here",
      topic: "New member landing page and server orientation.",
    },
    {
      id: "rules",
      name: "rules",
      kind: "text",
      parentId: "category-start-here",
      topic: "Server rules and community expectations.",
    },
    {
      id: "announcements",
      name: "announcements",
      kind: "text",
      parentId: "category-start-here",
      topic: "General community updates and creator notices.",
    },
    {
      id: "roles-and-alerts",
      name: "roles-and-alerts",
      kind: "text",
      parentId: "category-start-here",
      topic: "Alert role notes and opt-in instructions.",
    },
    { id: "category-stream", name: "STREAM", kind: "category" },
    {
      id: "live-now",
      name: "live-now",
      kind: "text",
      parentId: "category-stream",
      topic: "Stream start, late, cancelled, and schedule notices.",
    },
    {
      id: "schedule",
      name: "schedule",
      kind: "text",
      parentId: "category-stream",
      topic: "Upcoming stream schedule and changes.",
    },
    {
      id: "stream-chat",
      name: "stream-chat",
      kind: "text",
      parentId: "category-stream",
      topic:
        "Live stream chat spillover, watch-along chatter, and post-stream discussion.",
    },
    {
      id: "clips-and-highlights",
      name: "clips-and-highlights",
      kind: "text",
      parentId: "category-stream",
      topic: "Clips, highlights, and stream moments.",
    },
    {
      id: "suggestions",
      name: "suggestions",
      kind: "text",
      parentId: "category-stream",
      topic: "Community suggestions for streams, games, and segments.",
    },
    { id: "category-community", name: "COMMUNITY", kind: "category" },
    {
      id: "general",
      name: "general",
      kind: "text",
      parentId: "category-community",
      topic: "Default community chat.",
    },
    {
      id: "game-chat",
      name: "game-chat",
      kind: "text",
      parentId: "category-community",
      topic: "Game-specific chat, queue talk, and party coordination.",
    },
    {
      id: "media-share",
      name: "media-share",
      kind: "text",
      parentId: "category-community",
      topic: "Screenshots, art, links, and community media.",
    },
    {
      id: "off-topic",
      name: "off-topic",
      kind: "text",
      parentId: "category-community",
      topic: "Casual community conversation that does not fit the main chat.",
    },
    {
      id: "polls-and-giveaways",
      name: "polls-and-giveaways",
      kind: "text",
      parentId: "category-community",
      topic:
        "Community polls, giveaway notices, and event participation prompts.",
    },
    { id: "category-creator-hub", name: "CREATOR HUB", kind: "category" },
    {
      id: "content-ideas",
      name: "content-ideas",
      kind: "text",
      parentId: "category-creator-hub",
      topic: "Stream, video, clip, and community event ideas.",
    },
    {
      id: "gear-and-setups",
      name: "gear-and-setups",
      kind: "text",
      parentId: "category-creator-hub",
      topic: "Streaming setups, gear, software, and workflow notes.",
    },
    {
      id: "collabs",
      name: "collabs",
      kind: "text",
      parentId: "category-creator-hub",
      topic: "Collaboration ideas, guest planning, and creator networking.",
    },
    { id: "category-voice", name: "VOICE", kind: "category" },
    {
      id: "voice-lobby",
      name: "Lobby",
      kind: "voice",
      parentId: "category-voice",
    },
    {
      id: "voice-gaming",
      name: "Gaming",
      kind: "voice",
      parentId: "category-voice",
      userLimit: 10,
    },
    {
      id: "voice-gaming-two",
      name: "Gaming 2",
      kind: "voice",
      parentId: "category-voice",
      userLimit: 10,
    },
    {
      id: "voice-stream-waiting-room",
      name: "Stream Waiting Room",
      kind: "voice",
      parentId: "category-voice",
      userLimit: 8,
    },
    {
      id: "voice-afk",
      name: "AFK",
      kind: "voice",
      parentId: "category-voice",
    },
    { id: "category-staff", name: "STAFF", kind: "category" },
    {
      id: "staff-chat",
      name: "staff-chat",
      kind: "text",
      parentId: "category-staff",
      topic:
        "Private staff coordination placeholder. Review Discord permissions after setup.",
    },
    {
      id: "mod-log",
      name: "mod-log",
      kind: "text",
      parentId: "category-staff",
      topic: "Moderation notes and VaexCore community operations logs.",
    },
    {
      id: "content-planning",
      name: "content-planning",
      kind: "text",
      parentId: "category-staff",
      topic: "Private stream and content planning for staff.",
    },
    {
      id: "incident-notes",
      name: "incident-notes",
      kind: "text",
      parentId: "category-staff",
      topic: "Private moderation incident notes and follow-up tracking.",
    },
  ],
  recommended: {
    streamAnnouncementChannelId: "live-now",
    generalAnnouncementChannelId: "announcements",
    suggestionChannelId: "suggestions",
    streamAlertsRoleId: "stream-alerts",
  },
};

export const streamerCommunityDiscordTemplate: DiscordSetupTemplate = {
  schemaVersion: 1,
  id: "streamer-community-baseline",
  name: "Streamer Community Baseline",
  description:
    "A lean streamer Discord layout with start-here, stream, community, voice, and staff sections.",
  recommendedFor:
    "Small-to-mid streamer communities that need clear live notices, clips, suggestions, general chat, voice, and private staff coordination without a sprawling channel list.",
  roles: [
    {
      id: "stream-alerts",
      name: "Stream Alerts",
      color: 0x39d9ff,
      mentionable: true,
      hoist: false,
    },
  ],
  channels: [
    { id: "category-start-here", name: "START HERE", kind: "category" },
    {
      id: "welcome",
      name: "welcome",
      kind: "text",
      parentId: "category-start-here",
      topic: "New member landing page and server orientation.",
    },
    {
      id: "rules",
      name: "rules",
      kind: "text",
      parentId: "category-start-here",
      topic: "Server rules and community expectations.",
    },
    {
      id: "announcements",
      name: "announcements",
      kind: "text",
      parentId: "category-start-here",
      topic: "General community updates and creator notices.",
    },
    { id: "category-stream", name: "STREAM", kind: "category" },
    {
      id: "live-now",
      name: "live-now",
      kind: "text",
      parentId: "category-stream",
      topic: "Stream start, late, cancelled, and schedule notices.",
    },
    {
      id: "schedule",
      name: "schedule",
      kind: "text",
      parentId: "category-stream",
      topic: "Upcoming stream schedule and changes.",
    },
    {
      id: "clips-and-highlights",
      name: "clips-and-highlights",
      kind: "text",
      parentId: "category-stream",
      topic: "Clips, highlights, and stream moments.",
    },
    {
      id: "suggestions",
      name: "suggestions",
      kind: "text",
      parentId: "category-stream",
      topic: "Community suggestions for streams, games, and segments.",
    },
    { id: "category-community", name: "COMMUNITY", kind: "category" },
    {
      id: "general",
      name: "general",
      kind: "text",
      parentId: "category-community",
      topic: "Default community chat.",
    },
    {
      id: "game-chat",
      name: "game-chat",
      kind: "text",
      parentId: "category-community",
      topic: "Game-specific chat, queue talk, and party coordination.",
    },
    {
      id: "off-topic",
      name: "off-topic",
      kind: "text",
      parentId: "category-community",
      topic: "Casual community conversation that does not fit the main chat.",
    },
    { id: "category-voice", name: "VOICE", kind: "category" },
    {
      id: "voice-lobby",
      name: "Lobby",
      kind: "voice",
      parentId: "category-voice",
    },
    {
      id: "voice-gaming",
      name: "Gaming",
      kind: "voice",
      parentId: "category-voice",
      userLimit: 10,
    },
    {
      id: "voice-stream-waiting-room",
      name: "Stream Waiting Room",
      kind: "voice",
      parentId: "category-voice",
      userLimit: 8,
    },
    {
      id: "voice-afk",
      name: "AFK",
      kind: "voice",
      parentId: "category-voice",
    },
    { id: "category-staff", name: "STAFF", kind: "category" },
    {
      id: "staff-chat",
      name: "staff-chat",
      kind: "text",
      parentId: "category-staff",
      topic:
        "Private staff coordination placeholder. Review Discord permissions after setup.",
    },
    {
      id: "mod-log",
      name: "mod-log",
      kind: "text",
      parentId: "category-staff",
      topic: "Moderation notes and VaexCore community operations logs.",
    },
  ],
  recommended: {
    streamAnnouncementChannelId: "live-now",
    generalAnnouncementChannelId: "announcements",
    suggestionChannelId: "suggestions",
    streamAlertsRoleId: "stream-alerts",
  },
};

export const leanLiveAlertsDiscordTemplate: DiscordSetupTemplate = {
  schemaVersion: 1,
  id: "lean-live-alerts",
  name: "Lean Live Alerts",
  description:
    "A compact setup for existing servers that only need live notices, suggestions, basic community chat, voice, and staff review.",
  recommendedFor:
    "Creators adding VaexCore to an existing Discord without creating a large new channel tree.",
  roles: [
    {
      id: "stream-alerts",
      name: "Stream Alerts",
      color: 0x39d9ff,
      mentionable: true,
      hoist: false,
    },
  ],
  channels: [
    { id: "category-start-here", name: "START HERE", kind: "category" },
    {
      id: "welcome",
      name: "welcome",
      kind: "text",
      parentId: "category-start-here",
      topic: "Short server orientation and useful links.",
    },
    {
      id: "rules",
      name: "rules",
      kind: "text",
      parentId: "category-start-here",
      topic: "Server rules and community expectations.",
    },
    { id: "category-stream", name: "STREAM", kind: "category" },
    {
      id: "announcements",
      name: "announcements",
      kind: "text",
      parentId: "category-stream",
      topic: "General creator notices and updates.",
    },
    {
      id: "live-now",
      name: "live-now",
      kind: "text",
      parentId: "category-stream",
      topic: "Stream start, late, cancelled, and schedule notices.",
    },
    {
      id: "suggestions",
      name: "suggestions",
      kind: "text",
      parentId: "category-stream",
      topic: "Community suggestions for streams, games, and segments.",
    },
    { id: "category-community", name: "COMMUNITY", kind: "category" },
    {
      id: "general",
      name: "general",
      kind: "text",
      parentId: "category-community",
      topic: "Default community chat.",
    },
    { id: "category-voice", name: "VOICE", kind: "category" },
    {
      id: "voice-lobby",
      name: "Lobby",
      kind: "voice",
      parentId: "category-voice",
    },
    { id: "category-staff", name: "STAFF", kind: "category" },
    {
      id: "staff-chat",
      name: "staff-chat",
      kind: "text",
      parentId: "category-staff",
      topic: "Private staff coordination placeholder.",
    },
    {
      id: "mod-log",
      name: "mod-log",
      kind: "text",
      parentId: "category-staff",
      topic: "Moderation notes and VaexCore community operations logs.",
    },
  ],
  recommended: {
    streamAnnouncementChannelId: "live-now",
    generalAnnouncementChannelId: "announcements",
    suggestionChannelId: "suggestions",
    streamAlertsRoleId: "stream-alerts",
  },
};

export const contentClipsHubDiscordTemplate: DiscordSetupTemplate = {
  schemaVersion: 1,
  id: "content-clips-hub",
  name: "Content And Clips Hub",
  description:
    "A media-forward creator layout for clips, highlights, setup sharing, content ideas, live notices, and community feedback.",
  recommendedFor:
    "Creators who want Discord to collect moments, ideas, media, and viewer suggestions around stream content.",
  roles: [
    {
      id: "stream-alerts",
      name: "Stream Alerts",
      color: 0x39d9ff,
      mentionable: true,
      hoist: false,
    },
  ],
  channels: [
    { id: "category-start-here", name: "START HERE", kind: "category" },
    {
      id: "welcome",
      name: "welcome",
      kind: "text",
      parentId: "category-start-here",
      topic: "New member landing page and server orientation.",
    },
    {
      id: "rules",
      name: "rules",
      kind: "text",
      parentId: "category-start-here",
      topic: "Server rules and community expectations.",
    },
    {
      id: "announcements",
      name: "announcements",
      kind: "text",
      parentId: "category-start-here",
      topic: "General creator notices and updates.",
    },
    { id: "category-stream", name: "STREAM", kind: "category" },
    {
      id: "live-now",
      name: "live-now",
      kind: "text",
      parentId: "category-stream",
      topic: "Stream start, late, cancelled, and schedule notices.",
    },
    {
      id: "schedule",
      name: "schedule",
      kind: "text",
      parentId: "category-stream",
      topic: "Upcoming stream schedule and changes.",
    },
    {
      id: "suggestions",
      name: "suggestions",
      kind: "text",
      parentId: "category-stream",
      topic: "Community suggestions for streams, games, and segments.",
    },
    { id: "category-content", name: "CONTENT", kind: "category" },
    {
      id: "clips-and-highlights",
      name: "clips-and-highlights",
      kind: "text",
      parentId: "category-content",
      topic: "Clips, highlights, and stream moments.",
    },
    {
      id: "screenshots",
      name: "screenshots",
      kind: "text",
      parentId: "category-content",
      topic: "Screenshots and visual moments from streams and games.",
    },
    {
      id: "content-ideas",
      name: "content-ideas",
      kind: "text",
      parentId: "category-content",
      topic: "Stream, video, clip, and community event ideas.",
    },
    {
      id: "setup-share",
      name: "setup-share",
      kind: "text",
      parentId: "category-content",
      topic: "Streaming setups, gear, software, and workflow notes.",
    },
    {
      id: "fan-art",
      name: "fan-art",
      kind: "text",
      parentId: "category-content",
      topic: "Community art, edits, memes, and creative posts.",
    },
    { id: "category-community", name: "COMMUNITY", kind: "category" },
    {
      id: "general",
      name: "general",
      kind: "text",
      parentId: "category-community",
      topic: "Default community chat.",
    },
    {
      id: "creator-chat",
      name: "creator-chat",
      kind: "text",
      parentId: "category-community",
      topic: "Creator process, goals, and content discussion.",
    },
    {
      id: "off-topic",
      name: "off-topic",
      kind: "text",
      parentId: "category-community",
      topic: "Casual community conversation.",
    },
    { id: "category-voice", name: "VOICE", kind: "category" },
    {
      id: "voice-lobby",
      name: "Lobby",
      kind: "voice",
      parentId: "category-voice",
    },
    {
      id: "voice-editing-room",
      name: "Editing Room",
      kind: "voice",
      parentId: "category-voice",
      userLimit: 6,
    },
    {
      id: "voice-watch-party",
      name: "Watch Party",
      kind: "voice",
      parentId: "category-voice",
      userLimit: 12,
    },
    {
      id: "voice-afk",
      name: "AFK",
      kind: "voice",
      parentId: "category-voice",
    },
    { id: "category-staff", name: "STAFF", kind: "category" },
    {
      id: "staff-chat",
      name: "staff-chat",
      kind: "text",
      parentId: "category-staff",
      topic: "Private staff coordination placeholder.",
    },
    {
      id: "mod-log",
      name: "mod-log",
      kind: "text",
      parentId: "category-staff",
      topic: "Moderation notes and VaexCore community operations logs.",
    },
    {
      id: "content-planning",
      name: "content-planning",
      kind: "text",
      parentId: "category-staff",
      topic: "Private content planning for staff.",
    },
  ],
  recommended: {
    streamAnnouncementChannelId: "live-now",
    generalAnnouncementChannelId: "announcements",
    suggestionChannelId: "suggestions",
    streamAlertsRoleId: "stream-alerts",
  },
};

export const eventsGameNightsDiscordTemplate: DiscordSetupTemplate = {
  schemaVersion: 1,
  id: "events-game-nights",
  name: "Events And Game Nights",
  description:
    "A community event layout with schedules, signups, party finding, game rooms, stream notices, and staff event planning.",
  recommendedFor:
    "Creators who run recurring game nights, community events, tournaments, or party queues.",
  roles: [
    {
      id: "stream-alerts",
      name: "Stream Alerts",
      color: 0x39d9ff,
      mentionable: true,
      hoist: false,
    },
  ],
  channels: [
    { id: "category-start-here", name: "START HERE", kind: "category" },
    {
      id: "welcome",
      name: "welcome",
      kind: "text",
      parentId: "category-start-here",
      topic: "New member landing page and server orientation.",
    },
    {
      id: "rules",
      name: "rules",
      kind: "text",
      parentId: "category-start-here",
      topic: "Server rules and community expectations.",
    },
    {
      id: "announcements",
      name: "announcements",
      kind: "text",
      parentId: "category-start-here",
      topic: "General creator notices and updates.",
    },
    { id: "category-events", name: "EVENTS", kind: "category" },
    {
      id: "live-now",
      name: "live-now",
      kind: "text",
      parentId: "category-events",
      topic: "Stream start, late, cancelled, and schedule notices.",
    },
    {
      id: "event-schedule",
      name: "event-schedule",
      kind: "text",
      parentId: "category-events",
      topic: "Upcoming community events and game nights.",
    },
    {
      id: "signups",
      name: "signups",
      kind: "text",
      parentId: "category-events",
      topic: "Event signups, waitlists, and participation notes.",
    },
    {
      id: "lfg",
      name: "lfg",
      kind: "text",
      parentId: "category-events",
      topic: "Looking-for-group and party coordination.",
    },
    {
      id: "suggestions",
      name: "suggestions",
      kind: "text",
      parentId: "category-events",
      topic: "Community suggestions for events, games, and stream segments.",
    },
    { id: "category-games", name: "GAMES", kind: "category" },
    {
      id: "general",
      name: "general",
      kind: "text",
      parentId: "category-games",
      topic: "Default community chat.",
    },
    {
      id: "game-chat",
      name: "game-chat",
      kind: "text",
      parentId: "category-games",
      topic: "Game-specific chat, queue talk, and party coordination.",
    },
    {
      id: "party-finder",
      name: "party-finder",
      kind: "text",
      parentId: "category-games",
      topic: "Find players for co-op, queues, and community lobbies.",
    },
    {
      id: "clips-and-highlights",
      name: "clips-and-highlights",
      kind: "text",
      parentId: "category-games",
      topic: "Clips, highlights, and event moments.",
    },
    { id: "category-voice", name: "VOICE", kind: "category" },
    {
      id: "voice-lobby",
      name: "Lobby",
      kind: "voice",
      parentId: "category-voice",
    },
    {
      id: "voice-game-room-one",
      name: "Game Room 1",
      kind: "voice",
      parentId: "category-voice",
      userLimit: 10,
    },
    {
      id: "voice-game-room-two",
      name: "Game Room 2",
      kind: "voice",
      parentId: "category-voice",
      userLimit: 10,
    },
    {
      id: "voice-event-room",
      name: "Event Room",
      kind: "voice",
      parentId: "category-voice",
      userLimit: 20,
    },
    {
      id: "voice-afk",
      name: "AFK",
      kind: "voice",
      parentId: "category-voice",
    },
    { id: "category-staff", name: "STAFF", kind: "category" },
    {
      id: "staff-chat",
      name: "staff-chat",
      kind: "text",
      parentId: "category-staff",
      topic: "Private staff coordination placeholder.",
    },
    {
      id: "mod-log",
      name: "mod-log",
      kind: "text",
      parentId: "category-staff",
      topic: "Moderation notes and VaexCore community operations logs.",
    },
    {
      id: "event-planning",
      name: "event-planning",
      kind: "text",
      parentId: "category-staff",
      topic: "Private event planning and run-of-show notes.",
    },
  ],
  recommended: {
    streamAnnouncementChannelId: "live-now",
    generalAnnouncementChannelId: "announcements",
    suggestionChannelId: "suggestions",
    streamAlertsRoleId: "stream-alerts",
  },
};

export const discordSetupTemplates = [
  fullCreatorCommunityDiscordTemplate,
  streamerCommunityDiscordTemplate,
  leanLiveAlertsDiscordTemplate,
  contentClipsHubDiscordTemplate,
  eventsGameNightsDiscordTemplate,
] as const;

export const [defaultDiscordSetupTemplate] = discordSetupTemplates;

export const getDiscordSetupTemplate = (templateId?: string) =>
  discordSetupTemplates.find((template) => template.id === templateId) ??
  defaultDiscordSetupTemplate;

export const discordAnnouncementKinds = [
  "live",
  "late",
  "cancelled",
  "scheduled",
] as const;

export type DiscordAnnouncementKind = (typeof discordAnnouncementKinds)[number];
