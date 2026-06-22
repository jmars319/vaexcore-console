import type {
  Giveaway,
  GiveawayWinner,
} from "../modules/giveaways/giveaways.types";
import {
  RelayChatClient,
  relayConfigReadiness,
  startRelayHostedInstall,
  type RelayBotReadinessReport,
} from "../twitch/relayTransport";
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
import { URL } from "node:url";
import { basename, dirname, join, resolve } from "node:path";
import {
  getSafeBotValidation,
  getSafeDiscordConfig,
  getSafeRelayConfig,
  getSafeSetupChecks,
  getSetupMode,
} from "./serverConfig";
import { getDiscordRelayStatusRoute } from "./serverDiscordRelay";
import { objectInput } from "./serverDiscordSetup";
import {
  createRelayChatClient,
  getDiscordReadiness,
  getRelayStatusRoute,
  relayConnectionError,
} from "./serverRelay";
import { botValidationKeys, botValidationLabels } from "./serverState";
import type { SetupMode } from "./serverConfig";
import type { BotValidationKey } from "./serverState";

/* Completion route boundary */
export const getBotCompletionRoute = async () => {
  const secrets = readLocalSecrets();
  const [relayStatus, relayReport, discordRelayStatus] = await Promise.all([
    getRelayStatusRoute(),
    getRelayReadinessReport(secrets),
    getDiscordRelayStatusRoute(),
  ]);
  const validation = getSafeBotValidation(secrets);
  const relay = getSafeRelayConfig(secrets);
  const localDiscord = getDiscordReadiness(secrets);
  const records = validation.records;
  const checks = buildBotCompletionChecks({
    secrets,
    relayStatus,
    relayReport,
    discordRelayStatus,
    localDiscord,
    records,
    setupMode: getSetupMode(secrets),
  });
  const sections = buildBotCompletionSections(checks);
  const nextActions = checks
    .filter((check) => !check.complete)
    .map((check) => check.nextAction)
    .filter(Boolean)
    .slice(0, 8);
  const completed = checks.filter((check) => check.complete).length;
  const completionPercent = Math.round((completed / checks.length) * 100);
  const operatorStatus = botCompletionOperatorStatus({
    completionPercent,
    sections,
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    status: operatorStatus.status,
    statusLabel: operatorStatus.label,
    statusDetail: operatorStatus.detail,
    completionPercent,
    completed,
    total: checks.length,
    checks,
    sections,
    nextActions,
    validation,
    relay,
    relayStatus,
    relayReadinessReport: relayReport,
    setupChecks: getSafeSetupChecks(secrets),
    modeCapabilities: getSetupCapabilitySummary(getSetupMode(secrets)),
    discordSetup: getDiscordSetupSummary(secrets),
    discord: {
      localReadiness: localDiscord,
      localConfig: getSafeDiscordConfig(secrets),
      relay: discordRelayStatus,
    },
    setupMode: getSetupMode(secrets),
    transportMode: secrets.relay.twitchTransportMode,
  };
};

/* Setup capability boundary */
export const getSetupCapabilitySummary = (setupMode: SetupMode) => {
  const local = [
    "Local Twitch chat send while Console is running.",
    "Local Discord announcements and server layout setup.",
    "Giveaway controls and OBS overlay from this machine.",
  ];
  const relay = [
    "Hosted Relay handles public callbacks and webhook endpoints.",
    "Relay Chat Bot identity and Discord slash-command workflows.",
    "Console remains the local operator review surface.",
  ];

  if (setupMode === "advanced") {
    return [...local, ...relay];
  }

  return setupMode === "relay-assisted" ? relay : local;
};

export const getDiscordSetupSummary = (secrets = readLocalSecrets()) => {
  const discord = getSafeDiscordConfig(secrets);
  return {
    templateId: discord.setupTemplateId,
    templateName: discord.setupTemplate.name,
    setupAppliedAt: discord.setupAppliedAt,
    staffPrivacy: {
      enabled: discord.lockStaffCategory,
      staffRoleSelected: Boolean(discord.staffRoleId),
      staffRoleId: discord.staffRoleId,
    },
    createdChannelKeys: Object.keys(discord.createdChannelIds || {}).sort(),
    createdRoleKeys: Object.keys(discord.createdRoleIds || {}).sort(),
    recommendedMappings: {
      streamAlerts: discord.streamAnnouncementChannelId,
      announcements: discord.generalAnnouncementChannelId,
      streamAlertsRole: discord.streamAlertsRoleId,
    },
  };
};

/* Relay readiness boundary */
export const getRelayReadinessReport = async (
  secrets = readLocalSecrets(),
): Promise<
  | { ok: true; connected: true; report: RelayBotReadinessReport }
  | { ok: false; connected: false; error: string }
> => {
  if (relayConnectionError(secrets)) {
    return {
      ok: false,
      connected: false,
      error:
        "Relay readiness report was not requested because local Relay pairing is incomplete.",
    };
  }

  try {
    return {
      ok: true,
      connected: true,
      report: await createRelayChatClient(secrets).readinessReport(),
    };
  } catch (error) {
    return {
      ok: false,
      connected: false,
      error: safeErrorMessage(error, "Relay readiness report failed."),
    };
  }
};

/* Validation check boundary */
export const buildBotCompletionChecks = ({
  secrets,
  relayStatus,
  relayReport,
  discordRelayStatus,
  localDiscord,
  records,
  setupMode,
}: {
  secrets: LocalSecrets;
  relayStatus: Awaited<ReturnType<typeof getRelayStatusRoute>>;
  relayReport: Awaited<ReturnType<typeof getRelayReadinessReport>>;
  discordRelayStatus: Awaited<ReturnType<typeof getDiscordRelayStatusRoute>>;
  localDiscord: ReturnType<typeof getDiscordReadiness>;
  records: Record<BotValidationKey, string>;
  setupMode: SetupMode;
}) => {
  const relayReadinessChecks =
    relayReport.ok && relayReport.report
      ? relayReport.report.checks || []
      : relayStatus.connected
        ? relayStatus.readiness?.checks || []
        : [];
  const checkByKey = (key: string) =>
    relayReadinessChecks.find((item) => item.key === key);
  const discordChecks = discordRelayStatus.ok
    ? discordRelayStatus.readiness?.checks || []
    : relayReport.ok && relayReport.report
      ? relayReport.report.checks || []
      : [];
  const discordCheckByKey = (key: string) =>
    discordChecks.find((item) => item.key === key);

  const localMissing = [
    secrets.twitch.clientId ? null : "Client ID",
    secrets.twitch.clientSecret ? null : "Client Secret",
    secrets.twitch.redirectUri ? null : "Redirect URI",
    secrets.twitch.broadcasterLogin ? null : "Broadcaster Login",
    secrets.twitch.botLogin ? null : "Bot Login",
  ].filter(Boolean) as string[];
  const localChecks = [
    botCompletionCheck(
      "twitch-transport-local",
      "Twitch transport is Local",
      secrets.relay.twitchTransportMode !== "relay-chatbot",
      "Select Local mode when you want chat sends to use the local Twitch OAuth token.",
    ),
    botCompletionCheck(
      "twitch-local-config",
      "Local Twitch setup fields are saved",
      localMissing.length === 0,
      `Save ${localMissing.join(", ")} for local Twitch setup.`,
    ),
    botCompletionCheck(
      "twitch-local-oauth",
      "Local Twitch OAuth token is saved",
      Boolean(secrets.twitch.accessToken),
      "Use Connect Twitch as Bot Login for local chat sends.",
    ),
    botCompletionCheck(
      "discord-local-setup",
      "Local Discord announcements and layout are ready",
      localDiscord.ready,
      "Save Discord bot token, server ID, and announcement channel if Console should manage local Discord setup.",
    ),
  ];
  const relayCompletionChecks = [
    botCompletionCheck(
      "relay-paired",
      "Console paired to Relay",
      !relayConnectionError(secrets),
      "Start hosted Twitch setup.",
    ),
    botCompletionCheck(
      "twitch-transport-relay",
      "Twitch transport is relay-chatbot",
      secrets.relay.twitchTransportMode === "relay-chatbot",
      "Select Hosted mode in Settings.",
    ),
    botCompletionCheck(
      "twitch-bot-oauth",
      botValidationLabels.twitchBotOAuthCompletedAt,
      Boolean(records.twitchBotOAuthCompletedAt || checkByKey("bot-grant")?.ok),
      "Log in as vaexcorebot when Console opens the bot auth window.",
    ),
    botCompletionCheck(
      "twitch-broadcaster-oauth",
      botValidationLabels.twitchBroadcasterOAuthCompletedAt,
      Boolean(
        records.twitchBroadcasterOAuthCompletedAt ||
        checkByKey("broadcaster-grant")?.ok,
      ),
      "Log in as the channel owner when Console opens the broadcaster auth window.",
    ),
    botCompletionCheck(
      "twitch-separate-account",
      "Twitch bot and broadcaster accounts are separate",
      Boolean(checkByKey("separate-bot-account")?.ok),
      "Relay must show vaexcorebot and broadcaster grants as separate accounts.",
    ),
    botCompletionCheck(
      "twitch-eventsub",
      botValidationLabels.twitchEventSubRegisteredAt,
      Boolean(
        records.twitchEventSubRegisteredAt ||
        checkByKey("latest-eventsub-registration")?.ok,
      ),
      "Register EventSub through Console after OAuth grants are ready.",
    ),
    botCompletionCheck(
      "twitch-test-send",
      botValidationLabels.twitchRelayTestSendPassedAt,
      Boolean(
        records.twitchRelayTestSendPassedAt ||
        checkByKey("latest-outbound-send")?.ok,
      ),
      "Send a Relay test message through Console.",
    ),
    botCompletionCheck(
      "twitch-chatbot-user-list",
      botValidationLabels.twitchChatBotUserListConfirmedAt,
      Boolean(
        records.twitchChatBotUserListConfirmedAt ||
        secrets.relay.chatbotIdentityValidatedAt,
      ),
      "Confirm Twitch lists vaexcorebot as a Chat Bot in the channel user list.",
    ),
    botCompletionCheck(
      "discord-worker-config",
      "Discord Worker secrets are configured",
      Boolean(
        discordCheckByKey("discord-bot-token")?.ok &&
        discordCheckByKey("discord-public-key")?.ok &&
        discordCheckByKey("discord-application-id")?.ok &&
        discordCheckByKey("discord-client-secret")?.ok,
      ),
      "Set Discord Worker secrets on Relay.",
    ),
    botCompletionCheck(
      "discord-guild-connected",
      "Discord server is connected",
      Boolean(discordCheckByKey("discord-guild-id")?.ok),
      "Connect Discord from Console so Relay knows which server to manage.",
    ),
    botCompletionCheck(
      "discord-interaction-endpoint",
      botValidationLabels.discordInteractionEndpointAcceptedAt,
      Boolean(
        records.discordInteractionEndpointAcceptedAt ||
        discordCheckByKey("discord-interaction-url")?.ok,
      ),
      "Set the Discord Interactions Endpoint to the Relay URL.",
    ),
    botCompletionCheck(
      "discord-slash-commands",
      botValidationLabels.discordSlashCommandsRegisteredAt,
      Boolean(
        records.discordSlashCommandsRegisteredAt ||
        discordCheckByKey("discord-command-registration")?.ok,
      ),
      "Register Discord slash commands through Console after Discord is connected.",
    ),
    botCompletionCheck(
      "discord-suggest-tested",
      botValidationLabels.discordSuggestCommandTestedAt,
      Boolean(records.discordSuggestCommandTestedAt),
      "Run /suggest in Discord and confirm it appears in Console.",
    ),
    botCompletionCheck(
      "discord-announcement-tested",
      botValidationLabels.discordAnnouncementCommandTestedAt,
      Boolean(records.discordAnnouncementCommandTestedAt),
      "Run /live, /late, /cancelled, or /scheduled and confirm Console review behavior.",
    ),
  ];

  if (setupMode === "local-only") {
    return localChecks;
  }

  if (setupMode === "advanced") {
    return [...localChecks, ...relayCompletionChecks];
  }

  return relayCompletionChecks;
};

export const botCompletionCheck = (
  key: string,
  label: string,
  complete: boolean,
  nextAction: string,
) => ({
  key,
  label,
  complete,
  state: complete ? "ready" : "todo",
  nextAction: complete ? "" : nextAction,
});

/* Operator section boundary */
export const buildBotCompletionSections = (
  checks: ReturnType<typeof botCompletionCheck>[],
) => {
  const byKey = new Map(checks.map((check) => [check.key, check]));
  const sectionDefinitions = [
    {
      key: "local-console",
      title: "Local Twitch",
      incompleteState: "blocked",
      readyDetail:
        "Local Twitch setup is ready to send chat through the saved OAuth user token.",
      blockedDetail:
        "Complete local Twitch app fields and OAuth before local chat sends can pass.",
      checkKeys: [
        "twitch-transport-local",
        "twitch-local-config",
        "twitch-local-oauth",
      ],
    },
    {
      key: "local-discord",
      title: "Local Discord",
      incompleteState: "needs setup",
      readyDetail:
        "Console can manage Discord announcements and server layout locally.",
      blockedDetail:
        "Save Discord bot token, server ID, and announcement channel before local Discord actions are ready.",
      checkKeys: ["discord-local-setup"],
    },
    {
      key: "relay-pairing",
      title: "Relay pairing",
      incompleteState: "blocked",
      readyDetail:
        "Console is paired to Relay and configured for hosted Chat Bot transport.",
      blockedDetail:
        "Pair Console with Relay and select relay-chatbot transport before live setup can proceed.",
      checkKeys: ["relay-paired", "twitch-transport-relay"],
    },
    {
      key: "twitch-credentials",
      title: "Twitch credentials",
      incompleteState: "needs credentials",
      readyDetail:
        "OAuth grants, account separation, and EventSub records are present.",
      blockedDetail:
        "Complete the bot grant, broadcaster grant, account separation, and EventSub records.",
      checkKeys: [
        "twitch-bot-oauth",
        "twitch-broadcaster-oauth",
        "twitch-separate-account",
        "twitch-eventsub",
      ],
    },
    {
      key: "discord-relay",
      title: "Discord Relay",
      incompleteState: "needs setup",
      readyDetail:
        "Discord server, Worker secrets, endpoint, and slash commands are ready.",
      blockedDetail:
        "Connect Discord to this Relay installation, verify Worker secrets, and register commands.",
      checkKeys: [
        "discord-worker-config",
        "discord-guild-connected",
        "discord-interaction-endpoint",
        "discord-slash-commands",
      ],
    },
    {
      key: "live-validation",
      title: "Live validation",
      incompleteState: "live validation required",
      readyDetail:
        "Twitch test sends, Chat Bot user-list confirmation, and Discord command tests are recorded.",
      blockedDetail:
        "Run the Twitch and Discord live checks, then record the operator confirmations.",
      checkKeys: [
        "twitch-test-send",
        "twitch-chatbot-user-list",
        "discord-suggest-tested",
        "discord-announcement-tested",
      ],
    },
  ] as const;

  const sections = sectionDefinitions.flatMap((definition) => {
    const sectionChecks = definition.checkKeys
      .map((key) => byKey.get(key))
      .filter((check): check is ReturnType<typeof botCompletionCheck> =>
        Boolean(check),
      );
    if (!sectionChecks.length) {
      return [];
    }
    const pending = sectionChecks.filter((check) => !check.complete);
    return [
      {
        key: definition.key,
        title: definition.title,
        state: pending.length ? definition.incompleteState : "ready",
        detail: pending.length
          ? definition.blockedDetail
          : definition.readyDetail,
        complete: pending.length === 0,
        completed: sectionChecks.length - pending.length,
        total: sectionChecks.length,
        nextAction: pending[0]?.nextAction ?? "",
        checks: sectionChecks,
      },
    ];
  });

  return [
    ...sections,
    {
      key: "support-export",
      title: "Support/export",
      state: "ready",
      detail:
        "Bot-only support bundle copy and export use the secret-safe support route.",
      complete: true,
      completed: 1,
      total: 1,
      nextAction: "",
      checks: [],
    },
  ];
};

export const botCompletionOperatorStatus = ({
  completionPercent,
  sections,
}: {
  completionPercent: number;
  sections: ReturnType<typeof buildBotCompletionSections>;
}) => {
  if (completionPercent === 100) {
    return {
      status: "ready",
      label: "ready",
      detail:
        "Code readiness is complete. Remaining risk is external live-service validation.",
    };
  }

  const blocked = sections.find((section) => section.state === "blocked");
  if (blocked) {
    return {
      status: "blocked",
      label: "blocked",
      detail: blocked.nextAction || blocked.detail,
    };
  }

  const credentials = sections.find(
    (section) =>
      section.state === "needs credentials" || section.state === "needs setup",
  );
  if (credentials) {
    return {
      status:
        credentials.state === "needs setup"
          ? "needs-setup"
          : "needs-credentials",
      label:
        credentials.state === "needs setup"
          ? "needs setup"
          : "needs credentials",
      detail: credentials.nextAction || credentials.detail,
    };
  }

  const liveValidation = sections.find(
    (section) => section.state === "live validation required",
  );
  if (liveValidation) {
    return {
      status: "live-validation-required",
      label: "live validation required",
      detail: liveValidation.nextAction || liveValidation.detail,
    };
  }

  return {
    status: "needs-review",
    label: "needs review",
    detail: "Review bot completion checks before calling setup complete.",
  };
};

/* Validation state boundary */
export const recordBotValidation = (body: unknown) => {
  const input = objectInput(body);
  const key = botValidationKey(input.key);
  const confirmed = input.confirmed !== false;
  const existing = readLocalSecrets();
  const timestamp = confirmed ? new Date().toISOString() : undefined;
  const next: LocalSecrets = {
    ...existing,
    botValidation: {
      ...existing.botValidation,
      [key]: timestamp,
    },
  };

  if (key === "twitchChatBotUserListConfirmedAt") {
    next.relay = {
      ...next.relay,
      chatbotIdentityValidatedAt: timestamp,
      chatbotIdentityValidationNote: confirmed
        ? "Operator confirmed Twitch user list shows vaexcorebot as Chat Bot."
        : undefined,
    };
  }

  writeLocalSecrets(next);
  return { ok: true, validation: getSafeBotValidation() };
};

export const botValidationKey = (value: unknown): BotValidationKey => {
  if (
    typeof value === "string" &&
    botValidationKeys.includes(value as BotValidationKey)
  ) {
    return value as BotValidationKey;
  }
  throw new SafeInputError("Unknown bot validation record key.");
};
