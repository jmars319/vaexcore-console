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
import { basename, dirname, join, resolve } from "node:path";
import { getSafeConfig } from "./serverConfig";
import { missingSafeConfigFields } from "./serverDiagnostics";
import { runPreflightCheck, validateSetup } from "./serverSetupStatus";
import { logger } from "./serverState";
import { getCachedTokenReadiness } from "./serverTwitchAuth";

export let launchPreparation = createLaunchPreparationState();

export let launchPreparationPromise: Promise<void> | undefined;

export let pendingLaunchPreparationReason: string | undefined;

export type SetupCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export type LaunchPreparationStatus =
  | "pending"
  | "running"
  | "setup_required"
  | "attention"
  | "ready"
  | "error";

export type LaunchPreparationState = {
  ok: boolean;
  status: LaunchPreparationStatus;
  reason: string;
  step: string;
  startedAt: string;
  completedAt: string;
  setupReady: boolean;
  preflightReady: boolean;
  summary: string;
  nextAction: string;
  checks: SetupCheck[];
  validation?: {
    ok: boolean;
    checks: SetupCheck[];
    error?: string;
  };
  preflight?: {
    ok: boolean;
    checks: SetupCheck[];
    nextAction: string;
    summary?: unknown;
  };
  error?: string;
};

export function createLaunchPreparationState(): LaunchPreparationState {
  return {
    ok: false,
    status: "pending",
    reason: "startup",
    step: "pending",
    startedAt: "",
    completedAt: "",
    setupReady: false,
    preflightReady: false,
    summary: "Launch preparation has not run yet.",
    nextAction: "Waiting for vaexcore console to start.",
    checks: [],
  };
}

export function resetLaunchPreparation(
  status: LaunchPreparationStatus,
  summary: string,
  nextAction: string,
) {
  pendingLaunchPreparationReason = undefined;
  const now = new Date().toISOString();
  launchPreparation = {
    ...createLaunchPreparationState(),
    status,
    reason: "reset",
    step: status,
    startedAt: now,
    completedAt: now,
    summary,
    nextAction,
    checks: [
      {
        name: "Saved setup",
        ok: false,
        detail: nextAction,
      },
    ],
  };
}

export const getLaunchPreparationSnapshot = () => ({
  ...launchPreparation,
  checks: launchPreparation.checks.map((check) => ({ ...check })),
  validation: launchPreparation.validation
    ? {
        ...launchPreparation.validation,
        checks: launchPreparation.validation.checks.map((check) => ({
          ...check,
        })),
      }
    : undefined,
  preflight: launchPreparation.preflight
    ? {
        ...launchPreparation.preflight,
        checks: launchPreparation.preflight.checks.map((check) => ({
          ...check,
        })),
      }
    : undefined,
});

export const queueLaunchPreparation = (reason: string) => {
  if (launchPreparationPromise) {
    pendingLaunchPreparationReason = reason;
    return launchPreparationPromise;
  }

  launchPreparationPromise = runLaunchPreparation(reason)
    .catch((error: unknown) => {
      const detail = safeErrorMessage(error, "Launch preparation failed.");
      launchPreparation = {
        ...launchPreparation,
        ok: false,
        status: "error",
        step: "error",
        completedAt: new Date().toISOString(),
        summary: "Automatic launch preparation failed.",
        nextAction: detail,
        error: detail,
        checks: [
          ...launchPreparation.checks,
          { name: "Launch preparation", ok: false, detail },
        ],
      };
      logger.error(
        { error: redactSecrets(error) },
        "Automatic launch preparation failed",
      );
    })
    .finally(() => {
      launchPreparationPromise = undefined;
      const pendingReason = pendingLaunchPreparationReason;
      pendingLaunchPreparationReason = undefined;
      if (pendingReason) {
        void queueLaunchPreparation(pendingReason);
      }
    });

  return launchPreparationPromise;
};

export const runLaunchPreparation = async (reason: string) => {
  const startedAt = new Date().toISOString();
  launchPreparation = {
    ...createLaunchPreparationState(),
    status: "running",
    reason,
    step: "setup",
    startedAt,
    summary: "Checking saved setup and Twitch connection.",
    nextAction: "Automatic launch checks are running.",
  };

  const config = getSafeConfig();
  const missing = missingSafeConfigFields(config);

  if (missing.length > 0) {
    const detail = `Missing setup fields: ${missing.join(", ")}.`;
    launchPreparation = {
      ...launchPreparation,
      ok: false,
      status: "setup_required",
      step: "setup_required",
      completedAt: new Date().toISOString(),
      setupReady: false,
      preflightReady: false,
      summary: "One-time setup is not complete yet.",
      nextAction: "Open Configuration Settings -> Setup Guide.",
      checks: [{ name: "Saved setup", ok: false, detail }],
    };
    return;
  }

  launchPreparation = {
    ...launchPreparation,
    step: "validation",
    summary: "Validating saved Twitch OAuth and refreshing tokens if needed.",
  };

  const cachedReadiness = getCachedTokenReadiness(config);
  const validation = cachedReadiness.ready
    ? { ok: true, checks: cachedReadiness.checks }
    : await validateSetup();
  const failedValidation = validation.checks.find((check) => !check.ok);

  if (!validation.ok) {
    launchPreparation = {
      ...launchPreparation,
      ok: false,
      status: "error",
      step: "validation",
      completedAt: new Date().toISOString(),
      setupReady: false,
      preflightReady: false,
      summary: "Saved Twitch setup needs attention.",
      nextAction:
        failedValidation?.detail ??
        "Reconnect Twitch in Configuration Settings.",
      checks: validation.checks,
      validation,
    };
    return;
  }

  launchPreparation = {
    ...launchPreparation,
    step: "preflight",
    setupReady: true,
    summary: "Running automatic preflight.",
  };

  const preflight = await runPreflightCheck();
  const checks = [
    ...validation.checks,
    ...preflight.checks.filter(
      (check) =>
        !validation.checks.some(
          (validationCheck) => validationCheck.name === check.name,
        ),
    ),
  ];

  launchPreparation = {
    ...launchPreparation,
    ok: preflight.ok,
    status: preflight.ok ? "ready" : "attention",
    step: "complete",
    completedAt: new Date().toISOString(),
    setupReady: true,
    preflightReady: preflight.ok,
    summary: preflight.ok
      ? "Launch preparation completed automatically."
      : "Saved setup is ready. Live preflight still needs operator attention.",
    nextAction: preflight.nextAction,
    checks,
    validation,
    preflight,
  };
};
