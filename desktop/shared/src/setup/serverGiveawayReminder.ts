import type {
  Giveaway,
  GiveawayWinner,
} from "../modules/giveaways/giveaways.types";
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
  giveawayAnnouncement,
  maybeQueueGiveawayAnnouncements,
} from "./serverGiveawayActions";
import {
  db,
  giveawayReminder,
  giveawayTemplates,
  giveawaysService,
  logger,
} from "./serverState";

export type GiveawayReminderState = {
  enabled: boolean;
  intervalMinutes: number;
  lastSentAt: string;
  nextSendAt: string;
  lastError: string;
  timer: NodeJS.Timeout | undefined;
};

export type GiveawayReminderSettingsRow = {
  enabled: number;
  interval_minutes: number;
  last_sent_at: string;
};

export function createGiveawayReminderState(): GiveawayReminderState {
  const saved = readGiveawayReminderSettings();
  return {
    enabled: saved.enabled,
    intervalMinutes: saved.intervalMinutes,
    lastSentAt: saved.lastSentAt,
    nextSendAt: saved.enabled
      ? nextGiveawayReminderAt(saved.intervalMinutes)
      : "",
    lastError: "",
    timer: undefined,
  };
}

export const getGiveawayReminder = () => {
  const status = giveawaysService.status();
  return {
    ok: true,
    reminder: {
      enabled: giveawayReminder.enabled,
      intervalMinutes: giveawayReminder.intervalMinutes,
      lastSentAt: giveawayReminder.lastSentAt,
      nextSendAt: giveawayReminder.nextSendAt,
      lastError: giveawayReminder.lastError,
      openGiveaway: Boolean(status?.giveaway.status === "open"),
      giveawayTitle: status?.giveaway.title ?? "",
    },
  };
};

export const setGiveawayReminder = (body: unknown) => {
  const input = body as {
    enabled?: boolean;
    intervalMinutes?: number | string;
  };
  const intervalMinutes = parseSafeInteger(
    input.intervalMinutes ?? giveawayReminder.intervalMinutes,
    {
      field: "Reminder interval",
      min: 2,
      max: 60,
    },
  );
  const intervalChanged = intervalMinutes !== giveawayReminder.intervalMinutes;

  giveawayReminder.enabled = Boolean(input.enabled);
  giveawayReminder.intervalMinutes = intervalMinutes;
  giveawayReminder.lastError = "";

  if (!giveawayReminder.enabled) {
    giveawayReminder.nextSendAt = "";
    clearGiveawayReminderTimer();
    persistGiveawayReminderSettings();
    return getGiveawayReminder();
  }

  if (intervalChanged || !giveawayReminder.nextSendAt) {
    giveawayReminder.nextSendAt = nextGiveawayReminderAt(intervalMinutes);
  }

  persistGiveawayReminderSettings();
  scheduleGiveawayReminder();
  return getGiveawayReminder();
};

export const sendGiveawayReminderNow = () => {
  const result = queueGiveawayReminderAnnouncement({ manual: true });

  if (result.ok) {
    giveawayReminder.lastSentAt = new Date().toISOString();
    giveawayReminder.lastError = "";
    persistGiveawayReminderSettings();
    if (giveawayReminder.enabled) {
      giveawayReminder.nextSendAt = nextGiveawayReminderAt(
        giveawayReminder.intervalMinutes,
      );
      scheduleGiveawayReminder();
    }
  } else {
    giveawayReminder.lastError = result.error ?? "Reminder was not queued.";
  }

  return {
    ...getGiveawayReminder(),
    ...result,
  };
};

export const queueGiveawayReminderAnnouncement = (
  options: { manual?: boolean } = {},
) => {
  const status = giveawaysService.status();

  if (!status || status.giveaway.status !== "open") {
    if (!options.manual) {
      return {
        ok: true,
        queued: false,
        skipped: true,
        reason: "No open giveaway.",
      };
    }

    return {
      ok: false,
      error: "Reminder requires an open giveaway.",
    };
  }

  const queued = maybeQueueGiveawayAnnouncements(
    giveawayAnnouncement(
      giveawayTemplates.reminder(status.giveaway, status.entries),
      "reminder",
      status.giveaway.id,
      "important",
    ),
  );

  if (!queued) {
    return {
      ok: false,
      error: "Reminder could not queue because chat is not fully configured.",
    };
  }

  return {
    ok: true,
    queued: true,
  };
};

export const scheduleGiveawayReminder = () => {
  clearGiveawayReminderTimer();

  if (!giveawayReminder.enabled) {
    return;
  }

  const nextAt = Date.parse(giveawayReminder.nextSendAt);
  const delayMs = Number.isFinite(nextAt)
    ? Math.max(1000, nextAt - Date.now())
    : giveawayReminder.intervalMinutes * 60 * 1000;

  giveawayReminder.timer = setTimeout(() => {
    giveawayReminder.timer = undefined;
    const result = queueGiveawayReminderAnnouncement();

    if (result.ok && result.queued) {
      giveawayReminder.lastSentAt = new Date().toISOString();
      giveawayReminder.lastError = "";
      persistGiveawayReminderSettings();
    } else if (!result.ok) {
      giveawayReminder.lastError = result.error ?? "Reminder was not queued.";
      logger.warn(
        { error: giveawayReminder.lastError },
        "Giveaway reminder was not queued",
      );
    }

    giveawayReminder.nextSendAt = nextGiveawayReminderAt(
      giveawayReminder.intervalMinutes,
    );
    scheduleGiveawayReminder();
  }, delayMs);
  giveawayReminder.timer.unref?.();
};

export const clearGiveawayReminderTimer = () => {
  if (!giveawayReminder.timer) {
    return;
  }

  clearTimeout(giveawayReminder.timer);
  giveawayReminder.timer = undefined;
};

export function readGiveawayReminderSettings() {
  const row = db
    .prepare(
      "SELECT enabled, interval_minutes, last_sent_at FROM giveaway_reminder_settings WHERE id = 1",
    )
    .get() as GiveawayReminderSettingsRow | undefined;
  const interval = Number(row?.interval_minutes ?? 10);

  return {
    enabled: row?.enabled === 1,
    intervalMinutes:
      Number.isInteger(interval) && interval >= 2 && interval <= 60
        ? interval
        : 10,
    lastSentAt: row?.last_sent_at ?? "",
  };
}

export function persistGiveawayReminderSettings() {
  db.prepare(
    `
      INSERT INTO giveaway_reminder_settings (
        id,
        enabled,
        interval_minutes,
        last_sent_at,
        updated_at
      ) VALUES (
        1,
        @enabled,
        @intervalMinutes,
        @lastSentAt,
        @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        enabled = excluded.enabled,
        interval_minutes = excluded.interval_minutes,
        last_sent_at = excluded.last_sent_at,
        updated_at = excluded.updated_at
    `,
  ).run({
    enabled: giveawayReminder.enabled ? 1 : 0,
    intervalMinutes: giveawayReminder.intervalMinutes,
    lastSentAt: giveawayReminder.lastSentAt,
    updatedAt: new Date().toISOString(),
  });
}

export function nextGiveawayReminderAt(intervalMinutes: number) {
  return new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString();
}
