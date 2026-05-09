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
  roles: DiscordSetupRoleTemplate[];
  channels: DiscordSetupChannelTemplate[];
  recommended: {
    streamAnnouncementChannelId: string;
    generalAnnouncementChannelId: string;
    suggestionChannelId: string;
    streamAlertsRoleId: string;
  };
};

export const minimalStreamerDiscordTemplate: DiscordSetupTemplate = {
  schemaVersion: 1,
  id: "minimal-streamer",
  name: "Minimal Streamer Server",
  description:
    "A lean streamer Discord layout with start-here, stream, community, voice, and staff sections.",
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
      id: "memes",
      name: "memes",
      kind: "text",
      parentId: "category-community",
      topic: "Memes and casual community posts.",
    },
    { id: "category-voice", name: "VOICE", kind: "category" },
    {
      id: "voice-lobby",
      name: "Lobby",
      kind: "voice",
      parentId: "category-voice",
    },
    {
      id: "voice-community",
      name: "Community VC",
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
      topic: "Private staff coordination placeholder. Review Discord permissions after setup.",
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

export const discordAnnouncementKinds = [
  "live",
  "late",
  "cancelled",
  "scheduled",
] as const;

export type DiscordAnnouncementKind =
  (typeof discordAnnouncementKinds)[number];
