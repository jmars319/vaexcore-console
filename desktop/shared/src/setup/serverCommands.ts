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
import { createFeatureGateStore } from "../core/featureGates";
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
import {
  customCommandPresetDefinitions,
  customCommandPresetPackDefinitions,
  inspectCustomCommandPreset,
  inspectCustomCommandPresetPack,
  inspectStreamPreset,
  presetRequiresConfirmation,
  streamPresetDefinitions,
} from "./serverCommandPresets";

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

export {
  customCommandPresetDefinitions,
  customCommandPresetPackDefinitions,
  inspectCustomCommandPreset,
  inspectCustomCommandPresetPack,
  inspectStreamPreset,
  presetRequiresConfirmation,
  streamPresetDefinitions,
} from "./serverCommandPresets";
