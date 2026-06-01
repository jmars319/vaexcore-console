import type {
  Giveaway,
  GiveawayWinner,
} from "../modules/giveaways/giveaways.types";
import {
  CustomCommandsService,
  getReservedCustomCommandNames,
} from "../modules/commands/commands.service";
import {
  SafeInputError,
  limits,
  normalizeCommandName,
  normalizeKeyword,
  normalizeLogin as normalizeTwitchLogin,
  parseSafeInteger,
  redactSecrets,
  redactSecretText,
  safeErrorMessage,
  sanitizeChatMessage,
  sanitizeCommandText,
  sanitizeDisplayName,
  sanitizeGiveawayTitle,
  sanitizeText,
} from "../core/security";
import {
  createFeatureGateStore,
  type FeatureGateState,
  type FeatureGateMode,
  type FeatureKey,
} from "../core/featureGates";
import { basename, dirname, join, resolve } from "node:path";
import { getRecentAuditLogs, writeAuditLog } from "../core/auditLog";
import {
  createLocalChatMessage,
  localUiActor,
} from "./serverCommandSimulation";
import {
  customCommandsService,
  db,
  featureGates,
  giveawaysService,
} from "./serverState";

export const getCustomCommands = () => {
  const commands = customCommandsService.listCommands();
  const invocations = customCommandsService.getRecentInvocations(50);

  return {
    ok: true,
    commands,
    invocations,
    reservedNames: getCustomCommandReservedNames(),
    presets: customCommandPresetDefinitions.map((preset) =>
      inspectCustomCommandPreset(
        preset,
        commands,
        getCustomCommandReservedNames(),
      ),
    ),
    presetPacks: customCommandPresetPackDefinitions.map((pack) =>
      inspectCustomCommandPresetPack(
        pack,
        commands,
        getCustomCommandReservedNames(),
      ),
    ),
    featureGate: featureGates.get("custom_commands"),
    summary: {
      total: commands.length,
      enabled: commands.filter((command) => command.enabled).length,
      disabled: commands.filter((command) => !command.enabled).length,
      aliases: commands.reduce(
        (total, command) => total + command.aliases.length,
        0,
      ),
      uses: commands.reduce((total, command) => total + command.useCount, 0),
    },
  };
};

export const saveCustomCommand = (body: unknown) => {
  try {
    const command = customCommandsService.saveCommand(
      body as Record<string, unknown>,
      localUiActor,
      {
        reservedNames: getCustomCommandReservedNames(),
      },
    );
    return {
      ...getCustomCommands(),
      ok: true,
      command,
    };
  } catch (error) {
    return {
      ...getCustomCommands(),
      ok: false,
      error: safeErrorMessage(error, "Custom command save failed"),
    };
  }
};

export const setCustomCommandEnabled = (body: {
  id?: number;
  enabled?: boolean;
}) => {
  try {
    const command = customCommandsService.setEnabled(
      parseSafeInteger(body.id, {
        field: "Command ID",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
      Boolean(body.enabled),
      localUiActor,
    );
    return {
      ...getCustomCommands(),
      ok: true,
      command,
    };
  } catch (error) {
    return {
      ...getCustomCommands(),
      ok: false,
      error: safeErrorMessage(error, "Custom command update failed"),
    };
  }
};

export const duplicateCustomCommand = (id: number | undefined) => {
  try {
    const command = customCommandsService.duplicateCommand(
      parseSafeInteger(id, {
        field: "Command ID",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
      localUiActor,
    );
    return {
      ...getCustomCommands(),
      ok: true,
      command,
    };
  } catch (error) {
    return {
      ...getCustomCommands(),
      ok: false,
      error: safeErrorMessage(error, "Custom command duplicate failed"),
    };
  }
};

export const deleteCustomCommand = (id: number | undefined) => {
  try {
    const deleted = customCommandsService.deleteCommand(
      parseSafeInteger(id, {
        field: "Command ID",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
      localUiActor,
    );
    return {
      ...getCustomCommands(),
      ok: true,
      deleted,
    };
  } catch (error) {
    return {
      ...getCustomCommands(),
      ok: false,
      error: safeErrorMessage(error, "Custom command delete failed"),
    };
  }
};

export const createCustomCommandFromPreset = (id: string | undefined) => {
  try {
    const preset = customCommandPresetDefinitions.find(
      (item) => item.id === id,
    );

    if (!preset) {
      throw new Error("Command preset was not found.");
    }

    const command = customCommandsService.saveCommand(
      {
        name: preset.commandName,
        permission: preset.permission,
        enabled: false,
        globalCooldownSeconds: preset.globalCooldownSeconds,
        userCooldownSeconds: preset.userCooldownSeconds,
        aliases: preset.aliases,
        responses: preset.responses,
      },
      localUiActor,
      { reservedNames: getCustomCommandReservedNames() },
    );

    return {
      ...getCustomCommands(),
      ok: true,
      command,
    };
  } catch (error) {
    return {
      ...getCustomCommands(),
      ok: false,
      error: safeErrorMessage(error, "Command preset create failed"),
    };
  }
};

export const createCustomCommandPresetPack = (id: string | undefined) => {
  try {
    const pack = customCommandPresetPackDefinitions.find(
      (item) => item.id === id,
    );

    if (!pack) {
      throw new Error("Command preset pack was not found.");
    }

    const beforeCommands = customCommandsService.listCommands();
    const reservedNames = getCustomCommandReservedNames();
    const inspected = pack.presetIds
      .map((presetId) =>
        customCommandPresetDefinitions.find((preset) => preset.id === presetId),
      )
      .filter(
        (preset): preset is (typeof customCommandPresetDefinitions)[number] =>
          Boolean(preset),
      )
      .map((preset) =>
        inspectCustomCommandPreset(preset, beforeCommands, reservedNames),
      );
    const ready = inspected.filter(
      (preset) => preset.inspection.status === "ready",
    );

    if (!ready.length) {
      throw new Error("No preset commands in this pack are ready to create.");
    }

    const created = ready.map((preset) =>
      customCommandsService.saveCommand(
        {
          name: preset.commandName,
          permission: preset.permission,
          enabled: false,
          globalCooldownSeconds: preset.globalCooldownSeconds,
          userCooldownSeconds: preset.userCooldownSeconds,
          aliases: preset.aliases,
          responses: preset.responses,
        },
        localUiActor,
        { reservedNames },
      ),
    );
    const skipped = inspected
      .filter((preset) => preset.inspection.status !== "ready")
      .map((preset) => ({
        id: preset.id,
        commandName: preset.commandName,
        reason: preset.inspection.detail,
      }));

    writeAuditLog(
      db,
      localUiActor,
      "custom_command.preset_pack_create",
      `custom_command_pack:${pack.id}`,
      {
        packId: pack.id,
        label: pack.label,
        created: created.map((command) => command.name),
        skipped,
      },
    );

    return {
      ...getCustomCommands(),
      ok: true,
      pack,
      created,
      skipped,
    };
  } catch (error) {
    return {
      ...getCustomCommands(),
      ok: false,
      error: safeErrorMessage(error, "Command preset pack create failed"),
    };
  }
};

export const importCustomCommands = (body: unknown) => {
  try {
    const commands = customCommandsService.importCommands(body, localUiActor, {
      reservedNames: getCustomCommandReservedNames(),
    });
    return {
      ...getCustomCommands(),
      ok: true,
      imported: commands.length,
    };
  } catch (error) {
    return {
      ...getCustomCommands(),
      ok: false,
      error: safeErrorMessage(error, "Custom command import failed"),
    };
  }
};

export const previewCustomCommand = (body: unknown) => {
  try {
    const input = body as {
      commandId?: number;
      responseText?: unknown;
      actor?: string;
      role?: "viewer" | "mod" | "broadcaster";
      rawArgs?: unknown;
    };
    const actor = createLocalChatMessage({
      login: input.actor || "viewer",
      role: input.role ?? "viewer",
      text: "!preview",
    });
    return {
      ok: true,
      response: customCommandsService.preview({
        commandId: input.commandId,
        responseText: input.responseText,
        actor,
        rawArgs: input.rawArgs,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error: safeErrorMessage(error, "Custom command preview failed"),
    };
  }
};

export const getCustomCommandReservedNames = () => {
  const names = new Set(getReservedCustomCommandNames());
  const active = giveawaysService.status()?.giveaway.keyword;

  if (active) {
    names.add(normalizeCommandName(active));
  }

  return [...names].sort();
};

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
    description: "YouTube, tips, merch, and setup/specs placeholders.",
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
      detail: conflicts.join("; ") || "Ready to create disabled.",
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
        ? "Create ready commands disabled, edit placeholder links/copy, then enable after local tests."
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
