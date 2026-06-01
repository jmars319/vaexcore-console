import {
  MessageQueue,
  type MessageQueueEventStatus,
  type MessageQueueMetadata,
} from "../core/messageQueue";
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
import { ModerationService } from "../modules/moderation/moderation.module";
import { getRecentAuditLogs, writeAuditLog } from "../core/auditLog";
import { localUiActor } from "./serverCommandSimulation";
import {
  getCustomCommandReservedNames,
  inspectStreamPreset,
  streamPresetDefinitions,
} from "./serverCommands";
import {
  getGiveawayReminder,
  setGiveawayReminder,
} from "./serverGiveawayReminder";
import { validateSetup } from "./serverSetupStatus";
import {
  chatQueue,
  customCommandsService,
  db,
  featureGates,
  giveawayReminder,
  giveawayTemplates,
  moderationService,
  operatorMessages,
  timersService,
} from "./serverState";
import { exportTimers, saveTimer } from "./serverTimers";

export const parseOptionalNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const enqueueChatMessage = async (
  message: string | undefined,
  metadata: MessageQueueMetadata = {},
) => {
  const text = sanitizeChatMessage(message);

  const validation = await validateSetup();

  if (!validation.ok) {
    return {
      ok: false,
      error: "Validation must pass before sending chat messages.",
      checks: validation.checks,
    };
  }

  const outboundMessageId = chatQueue.enqueue(text, metadata);
  return { ok: true, queued: true, outboundMessageId };
};

export const getOperatorMessages = () => ({
  ok: true,
  templates: operatorMessages.list(),
});

export const saveOperatorMessages = (body: unknown) => ({
  ...getOperatorMessages(),
  templates: operatorMessages.save(body),
});

export const resetOperatorMessages = (ids: unknown) => ({
  ...getOperatorMessages(),
  templates: operatorMessages.reset(ids),
});

export const sendOperatorMessage = async (body: {
  id?: string;
  confirmed?: boolean;
}) => {
  const template = operatorMessages.find(body.id);

  if (!template) {
    return {
      ...getOperatorMessages(),
      ok: false,
      error: "Unknown operator message preset.",
    };
  }

  if (template.requiresConfirmation && body.confirmed !== true) {
    return {
      ...getOperatorMessages(),
      ok: false,
      error: `${template.label} requires confirmation before sending.`,
    };
  }

  const result = await enqueueChatMessage(template.template, {
    category: "operator",
    action: template.id,
    importance: template.requiresConfirmation ? "important" : "normal",
  });

  return {
    ...getOperatorMessages(),
    ...result,
    sentPreset: template.id,
  };
};

export const exportBotConfigBundle = () => {
  const moderation = moderationService.getState();
  const reminder = getGiveawayReminder().reminder;

  return {
    ok: true,
    version: 1,
    exportedAt: new Date().toISOString(),
    includesSecrets: false,
    note: "Safe bot behavior only. Twitch OAuth tokens, client secrets, runtime history, active giveaways, and prize data are excluded.",
    commands: customCommandsService.exportCommands().commands,
    timers: exportTimers().timers,
    moderation: {
      settings: safeModerationSettings(moderation.settings),
      terms: moderation.terms.map((term) => ({
        term: term.term,
        enabled: term.enabled,
      })),
      allowedLinks: moderation.allowedLinks.map((link) => ({
        domain: link.domain,
        enabled: link.enabled,
      })),
      blockedLinks: moderation.blockedLinks.map((link) => ({
        domain: link.domain,
        enabled: link.enabled,
      })),
    },
    operatorMacros: operatorMessages.list().map((template) => ({
      id: template.id,
      template: template.template,
    })),
    giveawayTemplates: giveawayTemplates.list().map((template) => ({
      action: template.action,
      template: template.template,
    })),
    giveawayReminder: {
      enabled: reminder.enabled,
      intervalMinutes: reminder.intervalMinutes,
    },
  };
};

export const importBotConfigBundle = (body: unknown) => {
  try {
    const payload = body as Record<string, unknown>;
    const imported = {
      commands: 0,
      timers: 0,
      moderationSettings: 0,
      moderationTerms: 0,
      moderationAllowedLinks: 0,
      moderationBlockedLinks: 0,
      operatorMacros: 0,
      giveawayTemplates: 0,
      giveawayReminder: 0,
    };

    const commandEntries = bundleArray(payload.commands);
    if (commandEntries.length) {
      imported.commands = customCommandsService.importCommands(
        { commands: commandEntries },
        localUiActor,
        { reservedNames: getCustomCommandReservedNames() },
      ).length;
    }

    const timerEntries = bundleArray(payload.timers);
    if (timerEntries.length) {
      imported.timers = importTimerEntries(timerEntries);
    }

    const moderationPayload = payload.moderation as
      | Record<string, unknown>
      | undefined;
    if (moderationPayload && typeof moderationPayload === "object") {
      if (
        moderationPayload.settings &&
        typeof moderationPayload.settings === "object"
      ) {
        moderationService.saveSettings(
          moderationPayload.settings,
          localUiActor,
        );
        imported.moderationSettings = 1;
      }

      imported.moderationTerms = importModerationTerms(
        bundleArray(moderationPayload.terms),
      );
      imported.moderationAllowedLinks = importModerationLinks(
        bundleArray(moderationPayload.allowedLinks),
        "allowed",
      );
      imported.moderationBlockedLinks = importModerationLinks(
        bundleArray(moderationPayload.blockedLinks),
        "blocked",
      );
    }

    imported.operatorMacros = importOperatorMacros(
      payload.operatorMacros ?? payload.operatorMessages,
    );
    imported.giveawayTemplates = importGiveawayTemplates(
      payload.giveawayTemplates,
    );

    if (
      payload.giveawayReminder &&
      typeof payload.giveawayReminder === "object"
    ) {
      setGiveawayReminder(payload.giveawayReminder);
      imported.giveawayReminder = 1;
    }

    if (!Object.values(imported).some((count) => count > 0)) {
      throw new Error(
        "Import payload did not include commands, timers, moderation, operator macros, or giveaway templates.",
      );
    }

    writeAuditLog(
      db,
      localUiActor,
      "bot_config.import",
      "bot_config",
      imported,
    );

    return {
      ...exportBotConfigBundle(),
      ok: true,
      imported,
    };
  } catch (error) {
    return {
      ok: false,
      error: safeErrorMessage(error, "Bot config import failed"),
    };
  }
};

export const importTimerEntries = (entries: unknown[]) => {
  const saved = entries.slice(0, 50).map((entry) => {
    const input = entry as Record<string, unknown>;
    const name = String(input.name ?? "")
      .trim()
      .toLowerCase();
    const existing = timersService
      .listTimers()
      .find((timer) => timer.name.toLowerCase() === name);

    return timersService.saveTimer(
      {
        ...input,
        id: existing?.id,
      },
      localUiActor,
    );
  });

  return saved.length;
};

export const importModerationTerms = (entries: unknown[]) => {
  let imported = 0;

  for (const entry of entries.slice(0, 100)) {
    const input = entry as Record<string, unknown>;
    const term = String(input.term ?? "")
      .trim()
      .toLowerCase();
    const existing = moderationService
      .listTerms()
      .find((item) => item.term === term);

    moderationService.saveTerm(
      {
        ...input,
        id: existing?.id,
      },
      localUiActor,
    );
    imported += 1;
  }

  return imported;
};

export const importModerationLinks = (
  entries: unknown[],
  type: "allowed" | "blocked",
) => {
  let imported = 0;

  for (const entry of entries.slice(0, 100)) {
    const input = entry as Record<string, unknown>;
    const domain = normalizeBundleDomain(input.domain);

    if (type === "allowed") {
      const existing = moderationService
        .listAllowedLinks()
        .find((item) => item.domain === domain);

      moderationService.saveAllowedLink(
        {
          ...input,
          id: existing?.id,
        },
        localUiActor,
      );
    } else {
      const existing = moderationService
        .listBlockedLinks()
        .find((item) => item.domain === domain);

      moderationService.saveBlockedLink(
        {
          ...input,
          id: existing?.id,
        },
        localUiActor,
      );
    }

    imported += 1;
  }

  return imported;
};

export const importOperatorMacros = (input: unknown) => {
  const templates = bundleTemplateMap(input, "id", "template");

  if (Object.keys(templates).length === 0) {
    return 0;
  }

  operatorMessages.save({ templates });
  return Object.keys(templates).length;
};

export const importGiveawayTemplates = (input: unknown) => {
  const templates = bundleTemplateMap(input, "action", "template");

  if (Object.keys(templates).length === 0) {
    return 0;
  }

  giveawayTemplates.save({ templates });
  return Object.keys(templates).length;
};

export const bundleArray = (input: unknown) => {
  if (Array.isArray(input)) {
    return input;
  }

  if (input && typeof input === "object") {
    const body = input as Record<string, unknown>;
    if (Array.isArray(body.commands)) return body.commands;
    if (Array.isArray(body.timers)) return body.timers;
  }

  return [];
};

export const bundleTemplateMap = (
  input: unknown,
  keyField: string,
  templateField: string,
) => {
  if (Array.isArray(input)) {
    return input.reduce<Record<string, unknown>>((templates, entry) => {
      const row = entry as Record<string, unknown>;
      const key = typeof row[keyField] === "string" ? row[keyField] : "";

      if (key) {
        templates[key] = row[templateField];
      }

      return templates;
    }, {});
  }

  if (input && typeof input === "object") {
    return input as Record<string, unknown>;
  }

  return {};
};

export const normalizeBundleDomain = (value: unknown) => {
  const domain =
    String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/)[0] ?? "";

  return domain.replace(/:\d+$/, "").trim();
};

export const safeModerationSettings = (
  settings: ReturnType<ModerationService["getSettings"]>,
) => ({
  blockedTermsEnabled: settings.blockedTermsEnabled,
  linkFilterEnabled: settings.linkFilterEnabled,
  capsFilterEnabled: settings.capsFilterEnabled,
  repeatFilterEnabled: settings.repeatFilterEnabled,
  symbolFilterEnabled: settings.symbolFilterEnabled,
  botShieldEnabled: settings.botShieldEnabled,
  blockedTermsAction: settings.blockedTermsAction,
  linkFilterAction: settings.linkFilterAction,
  capsFilterAction: settings.capsFilterAction,
  repeatFilterAction: settings.repeatFilterAction,
  symbolFilterAction: settings.symbolFilterAction,
  botShieldAction: settings.botShieldAction,
  botShieldScoreThreshold: settings.botShieldScoreThreshold,
  timeoutSeconds: settings.timeoutSeconds,
  warningMessage: settings.warningMessage,
  capsMinLength: settings.capsMinLength,
  capsRatio: settings.capsRatio,
  repeatWindowSeconds: settings.repeatWindowSeconds,
  repeatLimit: settings.repeatLimit,
  symbolMinLength: settings.symbolMinLength,
  symbolRatio: settings.symbolRatio,
  escalationEnabled: settings.escalationEnabled,
  escalationWindowSeconds: settings.escalationWindowSeconds,
  escalationDeleteAfter: settings.escalationDeleteAfter,
  escalationTimeoutAfter: settings.escalationTimeoutAfter,
  exemptBroadcaster: settings.exemptBroadcaster,
  exemptModerators: settings.exemptModerators,
  exemptVips: settings.exemptVips,
  exemptSubscribers: settings.exemptSubscribers,
});

export const getFeatureGates = () => ({
  ok: true,
  featureGates: featureGates.list(),
});

export const setFeatureGate = (body: {
  key?: FeatureKey;
  mode?: FeatureGateMode;
}) => {
  try {
    const featureGate = featureGates.setMode(body.key, body.mode, localUiActor);

    return {
      ...getFeatureGates(),
      ok: true,
      featureGate,
    };
  } catch (error) {
    return {
      ...getFeatureGates(),
      ok: false,
      error: safeErrorMessage(error, "Feature gate update failed"),
    };
  }
};

export const getStreamPresets = () => {
  const gates = featureGates.list();

  return {
    ok: true,
    presets: streamPresetDefinitions.map((preset) =>
      inspectStreamPreset(preset, gates),
    ),
    featureGates: gates,
  };
};
