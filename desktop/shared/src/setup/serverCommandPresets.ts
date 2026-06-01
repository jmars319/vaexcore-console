import type {
  FeatureGateMode,
  FeatureGateState,
  FeatureKey,
} from "../core/featureGates";
import type { CustomCommandsService } from "../modules/commands/commands.service";

export const customCommandPresetDefinitions = [
  {
    id: "discord",
    label: "Discord",
    category: "Community",
    description: "Community Discord link.",
    commandName: "discord",
    permission: "viewer",
    globalCooldownSeconds: 30,
    userCooldownSeconds: 10,
    aliases: ["dc"],
    responses: ["Join the Discord: https://example.com"],
  },
  {
    id: "socials",
    label: "Social Links",
    category: "Community",
    description: "Primary social and link hub.",
    commandName: "socials",
    permission: "viewer",
    globalCooldownSeconds: 30,
    userCooldownSeconds: 10,
    aliases: ["links"],
    responses: ["Find links and socials here: https://example.com"],
  },
  {
    id: "schedule",
    label: "Schedule",
    category: "Channel Info",
    description: "Streaming schedule reminder.",
    commandName: "schedule",
    permission: "viewer",
    globalCooldownSeconds: 30,
    userCooldownSeconds: 10,
    aliases: ["when"],
    responses: [
      "Stream schedule: check the channel panels for upcoming streams.",
    ],
  },
  {
    id: "commands",
    label: "Command List",
    category: "Channel Info",
    description: "Simple list of common viewer commands.",
    commandName: "commands",
    permission: "viewer",
    globalCooldownSeconds: 20,
    userCooldownSeconds: 20,
    aliases: ["cmds"],
    responses: [
      "Common commands: !discord, !socials, !schedule, !lurk, !rules",
    ],
  },
  {
    id: "lurk",
    label: "Lurk",
    category: "Community",
    description: "Viewer lurk acknowledgement.",
    commandName: "lurk",
    permission: "viewer",
    globalCooldownSeconds: 10,
    userCooldownSeconds: 30,
    aliases: [],
    responses: ["{user} is lurking. Thanks for hanging out."],
  },
  {
    id: "unlurk",
    label: "Unlurk",
    category: "Community",
    description: "Viewer return acknowledgement.",
    commandName: "unlurk",
    permission: "viewer",
    globalCooldownSeconds: 10,
    userCooldownSeconds: 30,
    aliases: ["back"],
    responses: ["Welcome back, {user}."],
  },
  {
    id: "shoutout",
    label: "Shoutout",
    category: "Moderator",
    description: "Moderator shoutout helper.",
    commandName: "so",
    permission: "moderator",
    globalCooldownSeconds: 10,
    userCooldownSeconds: 5,
    aliases: ["shoutout"],
    responses: ["Go check out {target}: https://twitch.tv/{target}"],
  },
  {
    id: "rules",
    label: "Rules",
    category: "Safety",
    description: "Short chat rules reminder.",
    commandName: "rules",
    permission: "viewer",
    globalCooldownSeconds: 30,
    userCooldownSeconds: 10,
    aliases: [],
    responses: ["Keep chat respectful, avoid spoilers, and listen to mods."],
  },
  {
    id: "youtube",
    label: "YouTube",
    category: "Community",
    description: "YouTube or VOD link.",
    commandName: "youtube",
    permission: "viewer",
    globalCooldownSeconds: 30,
    userCooldownSeconds: 10,
    aliases: ["yt"],
    responses: ["YouTube and VODs: https://example.com"],
  },
  {
    id: "tip",
    label: "Tip Link",
    category: "Support",
    description: "Optional support or tip link.",
    commandName: "tip",
    permission: "viewer",
    globalCooldownSeconds: 60,
    userCooldownSeconds: 30,
    aliases: ["donate"],
    responses: [
      "Support is never required, but you can find the tip link here: https://example.com",
    ],
  },
  {
    id: "merch",
    label: "Merch",
    category: "Support",
    description: "Merch store link.",
    commandName: "merch",
    permission: "viewer",
    globalCooldownSeconds: 60,
    userCooldownSeconds: 30,
    aliases: ["store"],
    responses: ["Merch/store link: https://example.com"],
  },
  {
    id: "specs",
    label: "Setup Specs",
    category: "Channel Info",
    description: "Streaming setup or gear note.",
    commandName: "specs",
    permission: "viewer",
    globalCooldownSeconds: 30,
    userCooldownSeconds: 15,
    aliases: ["setup"],
    responses: [
      "Stream setup/specs: update this command with your current gear list.",
    ],
  },
  {
    id: "giveaway",
    label: "Giveaway Status",
    category: "Giveaway",
    description: "Points viewers to giveaway status.",
    commandName: "giveaway",
    permission: "viewer",
    globalCooldownSeconds: 15,
    userCooldownSeconds: 10,
    aliases: ["raffle"],
    responses: ["Giveaway status: use !gstatus when a giveaway is active."],
  },
] as const;

export const customCommandPresetPackDefinitions = [
  {
    id: "core-utilities",
    label: "Core Utility Pack",
    description:
      "Discord, socials, schedule, command list, lurk/unlurk, rules, and shoutout.",
    presetIds: [
      "discord",
      "socials",
      "schedule",
      "commands",
      "lurk",
      "unlurk",
      "rules",
      "shoutout",
    ],
  },
  {
    id: "support-links",
    label: "Support Links Pack",
    description:
      "Draft YouTube, tips, merch, and setup/specs links for review.",
    presetIds: ["youtube", "tip", "merch", "specs"],
  },
] as const;

export const inspectCustomCommandPreset = (
  preset: (typeof customCommandPresetDefinitions)[number],
  commands: ReturnType<CustomCommandsService["listCommands"]>,
  reservedNames: string[],
) => {
  const reserved = new Set(reservedNames);
  const commandNames = new Set(commands.map((command) => command.name));
  const aliases = new Set(commands.flatMap((command) => command.aliases));
  const conflicts = [
    reserved.has(preset.commandName)
      ? `!${preset.commandName} is reserved`
      : undefined,
    commandNames.has(preset.commandName)
      ? `!${preset.commandName} already exists`
      : undefined,
    aliases.has(preset.commandName)
      ? `!${preset.commandName} is already an alias`
      : undefined,
    ...preset.aliases.flatMap((alias) => [
      reserved.has(alias) ? `!${alias} is reserved` : undefined,
      commandNames.has(alias) ? `!${alias} already exists` : undefined,
      aliases.has(alias) ? `!${alias} is already an alias` : undefined,
    ]),
  ].filter(Boolean);

  return {
    ...preset,
    inspection: {
      status: conflicts.length ? "blocked" : "ready",
      detail: conflicts.join("; ") || "Ready to create as disabled drafts.",
      nextAction: conflicts.length
        ? "Resolve the command or alias conflict first."
        : "Create, edit links/copy, then enable when tested.",
    },
  };
};

export const inspectCustomCommandPresetPack = (
  pack: (typeof customCommandPresetPackDefinitions)[number],
  commands: ReturnType<CustomCommandsService["listCommands"]>,
  reservedNames: string[],
) => {
  const presets = pack.presetIds
    .map((presetId) =>
      customCommandPresetDefinitions.find((preset) => preset.id === presetId),
    )
    .filter(
      (preset): preset is (typeof customCommandPresetDefinitions)[number] =>
        Boolean(preset),
    )
    .map((preset) =>
      inspectCustomCommandPreset(preset, commands, reservedNames),
    );
  const ready = presets.filter(
    (preset) => preset.inspection.status === "ready",
  );
  const blocked = presets.filter(
    (preset) => preset.inspection.status !== "ready",
  );

  return {
    ...pack,
    commandCount: presets.length,
    readyCount: ready.length,
    blockedCount: blocked.length,
    commands: presets.map((preset) => ({
      id: preset.id,
      commandName: preset.commandName,
      label: preset.label,
      status: preset.inspection.status,
    })),
    inspection: {
      status:
        ready.length === 0 ? "blocked" : blocked.length ? "partial" : "ready",
      detail: blocked.length
        ? `${ready.length} ready, ${blocked.length} already present or blocked.`
        : `${ready.length} commands ready to create disabled.`,
      nextAction: ready.length
        ? "Create ready commands as disabled drafts, review links and copy, then enable after local tests."
        : "Resolve command or alias conflicts before creating this pack.",
    },
  };
};

export const streamPresetDefinitions = [
  {
    id: "giveaway-night",
    label: "Giveaway Night",
    description:
      "Keep giveaways and custom commands live while optional timers and moderation stay off.",
    modes: {
      custom_commands: "live",
      timers: "off",
      moderation_filters: "off",
    },
  },
  {
    id: "local-bot-rehearsal",
    label: "Local Bot Rehearsal",
    description:
      "Keep custom commands live and move timers/moderation into local test mode.",
    modes: {
      custom_commands: "live",
      timers: "test",
      moderation_filters: "test",
    },
  },
  {
    id: "timers-live",
    label: "Timers Live",
    description:
      "Use custom commands and timers in live chat while moderation remains local-test only.",
    modes: {
      custom_commands: "live",
      timers: "live",
      moderation_filters: "test",
    },
  },
  {
    id: "bot-replacement",
    label: "Bot Replacement",
    description:
      "Enable custom commands, timers, and scoped moderation for live Twitch chat.",
    modes: {
      custom_commands: "live",
      timers: "live",
      moderation_filters: "live",
    },
  },
] as const satisfies Array<{
  id: string;
  label: string;
  description: string;
  modes: Record<FeatureKey, FeatureGateMode>;
}>;

export const inspectStreamPreset = (
  preset: (typeof streamPresetDefinitions)[number],
  gates: FeatureGateState[],
) => {
  const gateModes = new Map(gates.map((gate) => [gate.key, gate.mode]));
  const changes = Object.entries(preset.modes)
    .filter(([key, mode]) => gateModes.get(key as FeatureKey) !== mode)
    .map(([key, mode]) => ({
      key,
      from: gateModes.get(key as FeatureKey) || "off",
      to: mode,
    }));

  return {
    ...preset,
    requiresConfirmation: presetRequiresConfirmation(preset),
    inspection: {
      status: changes.length ? "changes" : "current",
      detail: changes.length
        ? changes
            .map((change) => `${change.key}: ${change.from} -> ${change.to}`)
            .join("; ")
        : "Preset is already active.",
      nextAction: changes.length
        ? "Apply explicitly, then run preflight and local tests before relying on live chat behavior."
        : "No feature gate changes needed.",
    },
  };
};

export const presetRequiresConfirmation = (
  preset: (typeof streamPresetDefinitions)[number],
) => {
  const modes: Record<FeatureKey, FeatureGateMode> = preset.modes;
  return modes.timers === "live" || modes.moderation_filters === "live";
};
