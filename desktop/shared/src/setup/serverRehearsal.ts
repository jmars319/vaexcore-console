import type {
  Giveaway,
  GiveawayWinner,
} from "../modules/giveaways/giveaways.types";
import {
  DiscordRelayClient,
  type DiscordRelaySuggestionStatus,
} from "../discord/relay";
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
  defaultRedirectUri,
  getLocalSecretsPath,
  readLocalSecrets,
  writeLocalSecrets,
  type LocalSecrets,
} from "../config/localSecrets";
import {
  listDiscordRelayActions,
  parseDiscordRelayActionFilter,
  parseDiscordRelayActionStatus,
  persistDiscordRelayActions,
  updateDiscordRelayActionStatus,
} from "../discord/relayActions";
import { URL } from "node:url";
import { basename, dirname, join, resolve } from "node:path";
import { getBotCompletionRoute } from "./serverBotCompletion";
import {
  getRelaySetupUrls,
  getSetupMode,
  setupModeDisplayLabel,
} from "./serverConfig";
import { getDiagnosticsReport } from "./serverDiagnostics";
import { getSupportBundle } from "./serverSupportBundle";
import {
  getDiscordRelayEventsRoute,
  getDiscordRelaySuggestionsRoute,
} from "./serverDiscordRelay";
import { previewDiscordSetup } from "./serverDiscordSetup";
import { getGiveawayState } from "./serverGiveawayState";
import { getRelayStatusRoute } from "./serverRelay";
import { db, giveawaysService } from "./serverState";

export const getBotSupportBundleRoute = async () => {
  const [completion, supportBundle, discordEvents, discordSuggestions] =
    await Promise.all([
      getBotCompletionRoute(),
      getSupportBundle(),
      getOptionalDiscordRelayEvents(),
      getOptionalDiscordRelaySuggestions(),
    ]);
  const discordActionHistory = listDiscordRelayActions(db, {
    status: undefined,
    limit: 100,
  });
  return {
    ok: true,
    bundleVersion: 1,
    generatedAt: new Date().toISOString(),
    note: "Secret-safe bot setup support bundle. It reports presence and readiness only, never tokens or secrets.",
    completion,
    setup: {
      mode: completion.setupMode,
      setupChecks: completion.setupChecks,
      modeCapabilities: completion.modeCapabilities,
    },
    discordSetup: completion.discordSetup,
    relayDiagnostics: completion.relayReadinessReport,
    validationRecords: completion.validation,
    queuedDiscordActions: discordActionHistory.filter((action) =>
      ["queued", "approved"].includes(action.status),
    ),
    discordActionHistory,
    relayEventFetch: {
      ok: discordEvents.ok,
      error: "error" in discordEvents ? discordEvents.error : undefined,
    },
    suggestions: discordSuggestions.suggestions,
    recentSendOutcomes: supportBundle.recent.outbound.slice(0, 20),
    nextActions: completion.nextActions,
  };
};

export const getOptionalDiscordRelayEvents = async () => {
  try {
    return await getDiscordRelayEventsRoute();
  } catch (error) {
    return {
      ok: false,
      events: [],
      error: safeErrorMessage(error, "Discord Relay events are unavailable."),
    };
  }
};

export const getOptionalDiscordRelaySuggestions = async () => {
  try {
    return await getDiscordRelaySuggestionsRoute(new URLSearchParams());
  } catch (error) {
    return {
      ok: false,
      suggestions: [],
      error: safeErrorMessage(
        error,
        "Discord Relay suggestions are unavailable.",
      ),
    };
  }
};

export const runBotSetupRehearsalRoute = async () => {
  const completion = await getBotCompletionRoute();
  const setupUrls = getRelaySetupUrls(readLocalSecrets().relay);
  const steps = [
    dryRunStep(
      "twitch-callback",
      "Hosted Twitch callback URL",
      Boolean(setupUrls.twitchCallbackUrl),
      setupUrls.twitchCallbackUrl ||
        "Start hosted Twitch setup before generating the callback URL.",
    ),
    dryRunStep(
      "bot-oauth",
      "Generate bot OAuth URL",
      Boolean(setupUrls.twitchBotOAuthUrl),
      setupUrls.twitchBotOAuthUrl || "Save Relay installation ID first.",
    ),
    dryRunStep(
      "broadcaster-oauth",
      "Generate broadcaster OAuth URL",
      Boolean(setupUrls.twitchBroadcasterOAuthUrl),
      setupUrls.twitchBroadcasterOAuthUrl ||
        "Save Relay installation ID first.",
    ),
    dryRunStep(
      "eventsub",
      "Mock Twitch EventSub registration",
      true,
      "Dry run would call Relay EventSub registration after OAuth grants are live.",
    ),
    dryRunStep(
      "relay-send",
      "Mock Relay chat send",
      true,
      "Dry run would send a Relay test chat message with an idempotency key.",
    ),
    dryRunStep(
      "chatbot-identity",
      "Mock Twitch Chat Bot user-list confirmation",
      true,
      "Dry run keeps this as an operator validation record until live Twitch confirms it.",
    ),
    dryRunStep(
      "discord-endpoint",
      "Generate Discord interaction endpoint",
      Boolean(setupUrls.discordInteractionUrl),
      setupUrls.discordInteractionUrl ||
        "Save Relay URL before generating the Discord interaction endpoint.",
    ),
    dryRunStep(
      "discord-commands",
      "Mock Discord slash command registration",
      true,
      "Dry run would register /suggest, /live, /late, /cancelled, /scheduled, and /setup-status after Discord Worker secrets are live.",
    ),
    dryRunStep(
      "discord-command-tests",
      "Mock Discord command validation",
      true,
      "Dry run would confirm /suggest queues a suggestion and announcement commands queue operator-visible actions.",
    ),
  ];
  return {
    ok: true,
    dryRun: true,
    generatedAt: new Date().toISOString(),
    steps,
    completion,
    nextActions: completion.nextActions,
  };
};

export const runFullLocalRehearsalRoute = async () => {
  const secrets = readLocalSecrets();
  const setupMode = getSetupMode(secrets);
  const generatedAt = new Date().toISOString();
  const [
    completion,
    botRehearsal,
    relayStatus,
    discordPreview,
    diagnostics,
    supportBundle,
  ] = await Promise.all([
    getBotCompletionRoute(),
    runBotSetupRehearsalRoute(),
    getRelayStatusRoute(),
    previewDiscordSetup({ includeRoles: true }),
    Promise.resolve(getDiagnosticsReport()),
    getSupportBundle(),
  ]);
  const giveawayState = getGiveawayState();
  const giveawayExport = giveawaysService.exportResults();
  const supportBundleSafe = supportBundleExcludesSecrets(
    supportBundle,
    secrets,
  );
  const discordPlan = discordPreview.plan;
  const discordActions = Array.isArray(discordPlan?.actions)
    ? discordPlan.actions.length
    : 0;
  const activeTimers = supportBundle.recent.timers.filter(
    (timer) => timer.enabled,
  ).length;
  const relayOptional = setupMode === "local-only";
  const relayReady = relayStatus.ok && (relayStatus.connected || relayOptional);
  const steps = [
    dryRunStep(
      "setup-mode",
      "Resolve operating mode",
      true,
      `${setupModeDisplayLabel(setupMode)} contract loaded with ${completion.modeCapabilities.length} capability note(s).`,
    ),
    dryRunStep(
      "bot-completion",
      "Refresh bot completion",
      completion.ok === true,
      `${completion.completed}/${completion.total} checks complete; status is ${completion.statusLabel}.`,
    ),
    dryRunStep(
      "relay-status",
      "Check Relay status contract",
      relayReady,
      relayStatus.connected
        ? "Relay status responded with installation/readiness metadata."
        : relayOptional
          ? "Local mode does not require Relay to be paired."
          : relayStatus.error || "Relay status was not available.",
    ),
    dryRunStep(
      "discord-baseline-preview",
      "Preview Discord baseline setup",
      discordPreview.ok === true,
      discordPreview.connected
        ? `Preview loaded from Discord with ${discordActions} planned action(s).`
        : `${discordActions} local template action(s) can be previewed without applying changes.`,
    ),
    dryRunStep(
      "giveaway-state",
      "Read giveaway operator state",
      giveawayState.ok === true,
      `${giveawayState.summary.status} giveaway state, ${giveawayState.summary.entryCount} entrant(s), ${giveawayState.summary.pendingConfirmationCount} pending winner(s), ${giveawayState.summary.expiredWinnerCount} expired winner(s).`,
    ),
    dryRunStep(
      "giveaway-export",
      "Build redacted giveaway export",
      Boolean(giveawayExport),
      "Giveaway export built from local audit/history data without game keys.",
    ),
    dryRunStep(
      "timers",
      "Inspect timer readiness",
      true,
      `${activeTimers} enabled timer(s) found; rehearsal does not send timer messages.`,
    ),
    dryRunStep(
      "diagnostics",
      "Run diagnostics",
      diagnostics.ok === true,
      diagnostics.readiness.nextAction,
    ),
    dryRunStep(
      "support-bundle-redaction",
      "Verify support export redaction",
      supportBundleSafe,
      supportBundleSafe
        ? "Support bundle excludes saved token, secret, and bot token values."
        : "Support bundle contained a saved secret value and must not be shared.",
    ),
  ];

  return {
    ok: steps.every((step) => step.ok),
    dryRun: true,
    generatedAt,
    setupMode,
    status: steps.every((step) => step.ok) ? "ready" : "attention",
    steps,
    completion,
    botRehearsal,
    relayStatus,
    discordPreview: {
      ok: discordPreview.ok,
      connected: discordPreview.connected,
      message: "message" in discordPreview ? discordPreview.message : "",
      template: discordPreview.template,
      plan: discordPreview.plan,
    },
    giveaway: {
      summary: giveawayState.summary,
      assurance: giveawayState.assurance,
      export: giveawayExport,
    },
    diagnostics: {
      ok: diagnostics.ok,
      readiness: diagnostics.readiness,
      generatedAt: diagnostics.generatedAt,
    },
    supportBundle: {
      ok: supportBundle.ok,
      generatedAt: supportBundle.generatedAt,
      setup: supportBundle.setup,
      discordSetup: supportBundle.discordSetup,
      recentCounts: {
        outbound: supportBundle.recent.outbound.length,
        audit: supportBundle.recent.audit.length,
        timers: supportBundle.recent.timers.length,
        customCommandInvocations:
          supportBundle.recent.customCommandInvocations.length,
      },
      redacted: supportBundleSafe,
    },
    nextActions: completion.nextActions,
  };
};

export const supportBundleExcludesSecrets = (
  supportBundle: unknown,
  secrets: LocalSecrets,
) => {
  const serialized = JSON.stringify(supportBundle);
  const forbidden = [
    secrets.twitch.clientSecret,
    secrets.twitch.accessToken,
    secrets.twitch.refreshToken,
    secrets.discord.botToken,
    secrets.relay.consoleToken,
  ].filter((value): value is string => Boolean(value && value.length > 3));

  return forbidden.every((value) => !serialized.includes(value));
};

export const dryRunStep = (
  key: string,
  label: string,
  ok: boolean,
  detail: string,
) => ({
  key,
  label,
  ok,
  status: ok ? "pass" : "todo",
  detail,
});

export const optionalRelaySuggestionStatus = (
  value: string | null,
): DiscordRelaySuggestionStatus | undefined =>
  value ? relaySuggestionStatus(value) : undefined;

export const relaySuggestionStatus = (
  value: unknown,
): DiscordRelaySuggestionStatus => {
  if (
    value === "new" ||
    value === "reviewed" ||
    value === "accepted" ||
    value === "rejected" ||
    value === "archived"
  ) {
    return value;
  }
  throw new SafeInputError(
    "Discord suggestion status must be new, reviewed, accepted, rejected, or archived.",
  );
};
