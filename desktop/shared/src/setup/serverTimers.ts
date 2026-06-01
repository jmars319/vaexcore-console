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
import { TimersService, timerMetadata } from "../modules/timers/timers.module";
import { getRecentAuditLogs, writeAuditLog } from "../core/auditLog";
import { localUiActor } from "./serverCommandSimulation";
import {
  presetRequiresConfirmation,
  streamPresetDefinitions,
} from "./serverCommands";
import { getTimerSendReadiness } from "./serverModeration";
import { enqueueChatMessage, getStreamPresets } from "./serverOperatorConfig";
import { db, featureGates, timersService } from "./serverState";

export const applyStreamPreset = (body: {
  id?: string;
  confirmed?: boolean;
}) => {
  try {
    const preset = streamPresetDefinitions.find((item) => item.id === body.id);

    if (!preset) {
      throw new Error("Stream preset was not found.");
    }

    if (presetRequiresConfirmation(preset) && body.confirmed !== true) {
      return {
        ...getStreamPresets(),
        ok: false,
        error: `${preset.label} requires confirmation before changing live feature gates.`,
      };
    }

    const before = featureGates.list();
    const applied = Object.entries(preset.modes).map(([key, mode]) =>
      featureGates.setMode(
        key as FeatureKey,
        mode as FeatureGateMode,
        localUiActor,
      ),
    );
    const after = featureGates.list();

    writeAuditLog(
      db,
      localUiActor,
      "stream_preset.apply",
      `stream_preset:${preset.id}`,
      {
        preset: preset.id,
        label: preset.label,
        modes: preset.modes,
        before: before.map(({ key, mode }) => ({ key, mode })),
        after: after.map(({ key, mode }) => ({ key, mode })),
      },
    );

    return {
      ...getStreamPresets(),
      ok: true,
      appliedPreset: preset.id,
      applied,
    };
  } catch (error) {
    return {
      ...getStreamPresets(),
      ok: false,
      error: safeErrorMessage(error, "Stream preset apply failed"),
    };
  }
};

export const getTimers = () => {
  const timers = timersService.listTimers();
  const readiness = getTimerSendReadiness();

  return {
    ok: true,
    timers: timers.map((timer) => ({
      ...timer,
      inspection: inspectTimer(timer, readiness),
    })),
    featureGate: featureGates.get("timers"),
    readiness,
    presets: timerPresetDefinitions,
    summary: {
      total: timers.length,
      enabled: timers.filter((timer) => timer.enabled).length,
      disabled: timers.filter((timer) => !timer.enabled).length,
      sent: timers.reduce((total, timer) => total + timer.fireCount, 0),
      blocked: timers.filter((timer) => timer.lastStatus === "blocked").length,
      waitingForActivity: timers.filter((timer) => timerNeedsActivity(timer))
        .length,
      nextFireAt:
        timers
          .filter((timer) => timer.enabled && timer.nextFireAt)
          .map((timer) => timer.nextFireAt)
          .sort()[0] ?? "",
    },
  };
};

export const exportTimers = () => ({
  version: 2,
  exportedAt: new Date().toISOString(),
  timers: timersService.listTimers().map((timer) => ({
    name: timer.name,
    message: timer.message,
    intervalMinutes: timer.intervalMinutes,
    minChatMessages: timer.minChatMessages,
    enabled: timer.enabled,
    fireCount: timer.fireCount,
    lastSentAt: timer.lastSentAt,
  })),
});

export const importTimers = (body: unknown) => {
  try {
    const payload = body as { timers?: unknown[] };
    const entries = Array.isArray(payload.timers)
      ? payload.timers.slice(0, 50)
      : [];

    if (entries.length === 0) {
      throw new Error("Import payload must include at least one timer.");
    }

    const saved = entries.map((entry) => {
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
          minChatMessages: input.minChatMessages,
          id: existing?.id,
        },
        localUiActor,
      );
    });

    return {
      ...getTimers(),
      ok: true,
      imported: saved.length,
    };
  } catch (error) {
    return {
      ...getTimers(),
      ok: false,
      error: safeErrorMessage(error, "Timer import failed"),
    };
  }
};

export const createTimerFromPreset = (id: string | undefined) => {
  try {
    const preset = timerPresetDefinitions.find((item) => item.id === id);

    if (!preset) {
      throw new Error("Unknown timer preset.");
    }

    const existing = timersService
      .listTimers()
      .find((timer) => timer.name.toLowerCase() === preset.name.toLowerCase());

    if (existing) {
      throw new Error(`Timer "${preset.name}" already exists.`);
    }

    const timer = timersService.saveTimer(
      {
        name: preset.name,
        message: preset.message,
        intervalMinutes: preset.intervalMinutes,
        minChatMessages: preset.minChatMessages,
        enabled: false,
      },
      localUiActor,
    );

    return {
      ...getTimers(),
      ok: true,
      timer,
    };
  } catch (error) {
    return {
      ...getTimers(),
      ok: false,
      error: safeErrorMessage(error, "Timer preset failed"),
    };
  }
};

export const saveTimer = (body: unknown) => {
  try {
    const timer = timersService.saveTimer(
      body as Record<string, unknown>,
      localUiActor,
    );
    return {
      ...getTimers(),
      ok: true,
      timer,
    };
  } catch (error) {
    return {
      ...getTimers(),
      ok: false,
      error: safeErrorMessage(error, "Timer save failed"),
    };
  }
};

export const setTimerEnabled = (body: { id?: number; enabled?: boolean }) => {
  try {
    const timer = timersService.setEnabled(
      parseSafeInteger(body.id, {
        field: "Timer ID",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
      Boolean(body.enabled),
      localUiActor,
    );

    return {
      ...getTimers(),
      ok: true,
      timer,
    };
  } catch (error) {
    return {
      ...getTimers(),
      ok: false,
      error: safeErrorMessage(error, "Timer update failed"),
    };
  }
};

export const deleteTimer = (id: number | undefined) => {
  try {
    const timer = timersService.deleteTimer(
      parseSafeInteger(id, {
        field: "Timer ID",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
      localUiActor,
    );

    return {
      ...getTimers(),
      ok: true,
      deleted: timer,
    };
  } catch (error) {
    return {
      ...getTimers(),
      ok: false,
      error: safeErrorMessage(error, "Timer delete failed"),
    };
  }
};

export const sendTimerNow = async (id: number | undefined) => {
  try {
    const timer = timersService.requireTimer(
      parseSafeInteger(id, {
        field: "Timer ID",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }),
    );
    const readiness = getTimerSendReadiness();

    if (!timer.enabled) {
      timersService.markBlocked(timer.id, "Timer is disabled.");
      return {
        ...getTimers(),
        ok: false,
        error: "Enable the timer before sending it.",
      };
    }

    if (!readiness.ok) {
      timersService.markBlocked(timer.id, readiness.reason);
      return {
        ...getTimers(),
        ok: false,
        error: readiness.reason,
      };
    }

    const result = await enqueueChatMessage(
      timer.message,
      timerMetadata(timer),
    );

    if (!result.ok || typeof result.outboundMessageId !== "string") {
      const error = result.error || "Timer message could not queue.";
      timersService.markBlocked(timer.id, error);
      return {
        ...getTimers(),
        ...result,
        ok: false,
        error,
      };
    }

    const sent = timersService.markQueued(timer.id, result.outboundMessageId);

    return {
      ...getTimers(),
      ok: true,
      queued: true,
      timer: sent,
      outboundMessageId: result.outboundMessageId,
    };
  } catch (error) {
    return {
      ...getTimers(),
      ok: false,
      error: safeErrorMessage(error, "Timer send failed"),
    };
  }
};

export const timerPresetDefinitions = [
  {
    id: "discord",
    name: "Discord reminder",
    intervalMinutes: 15,
    minChatMessages: 5,
    message: "Join the Discord for stream updates: https://example.com",
  },
  {
    id: "socials",
    name: "Social links",
    intervalMinutes: 20,
    minChatMessages: 8,
    message: "Follow socials and find links here: https://example.com",
  },
  {
    id: "schedule",
    name: "Stream schedule",
    intervalMinutes: 30,
    minChatMessages: 5,
    message: "Stream schedule: check the channel panels for upcoming streams.",
  },
  {
    id: "commands",
    name: "Command reminder",
    intervalMinutes: 25,
    minChatMessages: 5,
    message:
      "Try !gstatus during giveaways, or ask a mod for current channel commands.",
  },
] as const;

export const inspectTimer = (
  timer: ReturnType<TimersService["listTimers"]>[number],
  readiness = getTimerSendReadiness(),
) => {
  if (!timer.enabled) {
    return {
      status: "disabled",
      detail: "Timer is saved but disabled.",
      nextAction: "Enable when you want it to participate in live delivery.",
    };
  }

  if (!readiness.ok) {
    return {
      status: "blocked",
      detail: readiness.reason,
      nextAction: readiness.nextAction,
    };
  }

  if (timer.lastStatus === "blocked" && timer.lastError) {
    return {
      status: "recovering",
      detail: timer.lastError,
      nextAction: timer.nextFireAt
        ? `Will retry after ${timer.nextFireAt}.`
        : "Disable and re-enable the timer to schedule the next send.",
    };
  }

  if (!timer.nextFireAt) {
    return {
      status: "unscheduled",
      detail: "Timer is enabled but has no next fire time.",
      nextAction: "Disable and re-enable the timer to reschedule it.",
    };
  }

  const nextFireMs = Date.parse(timer.nextFireAt);
  const activity = timerActivityProgress(timer);

  if (Number.isFinite(nextFireMs) && nextFireMs <= Date.now()) {
    if (timerNeedsActivity(timer)) {
      const remaining = Math.max(
        0,
        timer.minChatMessages - timer.chatMessagesSinceLastFire,
      );
      return {
        status: "waiting_activity",
        detail: `Interval elapsed; waiting for ${remaining} more chat message${remaining === 1 ? "" : "s"} (${activity}).`,
        nextAction:
          "Let chat activity build or use Send now for an explicit operator send.",
      };
    }

    return {
      status: "due",
      detail:
        "Timer is due and will send on the next scheduler tick if the bot remains live-ready.",
      nextAction: "Wait for the scheduler tick or use Send now.",
    };
  }

  return {
    status: "scheduled",
    detail: timer.nextFireAt
      ? `Next send is scheduled for ${timer.nextFireAt}.`
      : "Timer is waiting for its next schedule.",
    nextAction:
      timer.minChatMessages > 0
        ? `Needs ${activity} chat activity before the next automatic send.`
        : "No action needed.",
  };
};

export const timerNeedsActivity = (
  timer: ReturnType<TimersService["listTimers"]>[number],
) =>
  timer.enabled &&
  timer.minChatMessages > 0 &&
  timer.chatMessagesSinceLastFire < timer.minChatMessages &&
  Boolean(timer.nextFireAt) &&
  Date.parse(timer.nextFireAt) <= Date.now();

export const timerActivityProgress = (
  timer: ReturnType<TimersService["listTimers"]>[number],
) =>
  timer.minChatMessages > 0
    ? `${Math.min(timer.chatMessagesSinceLastFire, timer.minChatMessages)}/${timer.minChatMessages}`
    : "off";
