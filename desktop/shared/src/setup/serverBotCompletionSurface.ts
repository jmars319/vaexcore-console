import type { LocalSecrets } from "../config/localSecrets";
import type { SetupMode } from "./serverConfig";

export type CompletionCheck = {
  key: string;
  label: string;
  complete: boolean;
  state: string;
  nextAction: string;
};

export type CompletionSection = {
  key: string;
  title: string;
  state: string;
  detail: string;
  complete: boolean;
  completed: number;
  total: number;
  nextAction: string;
  checks: CompletionCheck[];
};

type RelayStatusLike = {
  connected?: boolean;
  error?: string;
  installation?: {
    botLogin?: string;
    broadcasterLogin?: string;
  };
};

type RelayReportLike =
  | {
      ok: true;
      report: {
        summary?: {
          state: string;
          detail: string;
          lastCheckedAt: string;
        };
      };
    }
  | { ok: false };

type DiscordRelayStatusLike = { ok?: boolean };

const botIdentityRequiredScopes = [
  "user:read:chat",
  "user:write:chat",
  "channel:read:stream_key",
];

export const buildProviderOnboarding = ({
  checks,
  setupMode,
}: {
  checks: CompletionCheck[];
  setupMode: SetupMode;
}) => {
  const step = (id: string, label: string, checkKeys: string[]) =>
    completionStep(id, label, checks, checkKeys);
  const localSteps = [
    step("local-twitch-config", "Local Twitch credentials", [
      "twitch-local-config",
      "twitch-local-oauth",
    ]),
    step("local-discord", "Local Discord setup", ["discord-local-setup"]),
  ];
  const relaySteps = [
    step("relay-pairing", "Relay URL and transport", [
      "relay-paired",
      "twitch-transport-relay",
    ]),
    step("twitch-oauth", "Twitch bot and broadcaster OAuth", [
      "twitch-bot-oauth",
      "twitch-broadcaster-oauth",
      "twitch-separate-account",
    ]),
    step("twitch-eventsub", "Twitch EventSub and chat test", [
      "twitch-eventsub",
      "twitch-test-send",
      "twitch-chatbot-user-list",
    ]),
    step("discord-relay", "Discord install and slash commands", [
      "discord-worker-config",
      "discord-guild-connected",
      "discord-interaction-endpoint",
      "discord-slash-commands",
    ]),
    step("live-provider-validation", "Live provider validation", [
      "discord-suggest-tested",
      "discord-announcement-tested",
      "twitch-test-send",
    ]),
  ];
  const steps =
    setupMode === "local-only"
      ? localSteps
      : setupMode === "advanced"
        ? [...localSteps, ...relaySteps]
        : relaySteps;
  const nextStep = steps.find((item) => !item.complete) ?? null;

  return {
    mode: setupMode,
    status: nextStep ? "needs-action" : "ready",
    headline: nextStep
      ? `${nextStep.label}: ${nextStep.nextAction}`
      : "Provider setup is ready.",
    steps,
    nextStep,
  };
};

export const buildBotIdentitySummary = ({
  secrets,
  relayStatus,
  relayReport,
  discordRelayStatus,
  checks,
}: {
  secrets: LocalSecrets;
  relayStatus: RelayStatusLike;
  relayReport: RelayReportLike;
  discordRelayStatus: DiscordRelayStatusLike;
  checks: CompletionCheck[];
}) => {
  const check = (key: string) => checks.find((item) => item.key === key);
  const localScopes = secrets.twitch.scopes ?? [];
  const missingLocalScopes = botIdentityRequiredScopes.filter(
    (scope) => !localScopes.includes(scope),
  );
  const relaySummary = relayReport.ok ? relayReport.report.summary : undefined;
  const relayInstallation =
    relayStatus.connected && relayStatus.installation
      ? relayStatus.installation
      : undefined;

  return {
    broadcaster: {
      login:
        relayInstallation?.broadcasterLogin ||
        secrets.twitch.broadcasterLogin ||
        "",
      source: relayInstallation?.broadcasterLogin ? "relay" : "local",
      oauthReady: Boolean(check("twitch-broadcaster-oauth")?.complete),
    },
    bot: {
      login: relayInstallation?.botLogin || secrets.twitch.botLogin || "",
      source: relayInstallation?.botLogin ? "relay" : "local",
      oauthReady: Boolean(
        check("twitch-bot-oauth")?.complete ||
        check("twitch-local-oauth")?.complete,
      ),
      tokenExpiresAt: secrets.twitch.tokenExpiresAt ?? "",
      tokenValidatedAt: secrets.twitch.tokenValidatedAt ?? "",
    },
    twitchScopes: {
      required: botIdentityRequiredScopes,
      saved: localScopes,
      missing: missingLocalScopes,
      ready:
        check("twitch-bot-oauth")?.complete ||
        (localScopes.length > 0 && missingLocalScopes.length === 0),
    },
    eventSub: completionReadiness(check("twitch-eventsub")),
    relayTransport: {
      connected: Boolean(relayStatus.connected),
      state:
        relaySummary?.state ||
        (relayStatus.connected ? "connected" : "not connected"),
      detail:
        relaySummary?.detail ||
        relayStatus.error ||
        "Relay status has not been checked.",
      lastCheckedAt: relaySummary?.lastCheckedAt ?? "",
    },
    discordInstall: {
      connected: Boolean(discordRelayStatus.ok),
      state: check("discord-slash-commands")?.complete
        ? "ready"
        : check("discord-guild-connected")?.complete
          ? "commands pending"
          : "not connected",
      interactionEndpointReady: Boolean(
        check("discord-interaction-endpoint")?.complete,
      ),
      slashCommandsReady: Boolean(check("discord-slash-commands")?.complete),
    },
    reconnectActions: checks
      .filter(
        (item) =>
          !item.complete &&
          [
            "twitch-bot-oauth",
            "twitch-broadcaster-oauth",
            "twitch-local-oauth",
            "discord-guild-connected",
            "discord-slash-commands",
          ].includes(item.key),
      )
      .map((item) => item.nextAction)
      .filter(Boolean),
  };
};

export const buildGoLiveChecklist = ({
  sections,
  setupMode,
}: {
  sections: CompletionSection[];
  setupMode: SetupMode;
}) => {
  const requiredSections =
    setupMode === "local-only"
      ? ["local-console"]
      : ["relay-pairing", "twitch-credentials", "discord-relay"];
  const liveSection = sections.find(
    (section) => section.key === "live-validation",
  );
  const supportSection = sections.find(
    (section) => section.key === "support-export",
  );
  const items = [
    ...requiredSections.map((key) => {
      const section = sections.find((item) => item.key === key);
      return {
        key,
        label: section?.title || key,
        complete: Boolean(section?.complete),
        state: section?.state || "missing",
        detail: section?.complete
          ? section.detail
          : section?.nextAction ||
            section?.detail ||
            "Complete this setup section.",
      };
    }),
    {
      key: "live-validation",
      label: liveSection?.title || "Live validation",
      complete: Boolean(liveSection?.complete),
      state: liveSection?.state || "missing",
      detail: liveSection?.complete
        ? liveSection.detail
        : liveSection?.nextAction ||
          "Run Twitch and Discord live checks before going live.",
    },
    {
      key: "support-export",
      label: "Diagnostics and support bundle",
      complete: Boolean(supportSection?.complete),
      state: supportSection?.state || "ready",
      detail:
        supportSection?.detail ||
        "Secret-safe support bundle export is available before live use.",
    },
  ];
  const blockers = items.filter((item) => !item.complete);

  return {
    status: blockers.length ? "blocked" : "ready",
    requiredMode: setupMode,
    items,
    blockers,
    nextAction:
      blockers[0]?.detail ||
      "Run the final live-provider validation script when credentials are available.",
  };
};

const completionStep = (
  id: string,
  label: string,
  checks: CompletionCheck[],
  checkKeys: string[],
) => {
  const related = checkKeys
    .map((key) => checks.find((check) => check.key === key))
    .filter((check): check is CompletionCheck => Boolean(check));
  const pending = related.filter((check) => !check.complete);
  return {
    id,
    label,
    checkKeys,
    complete: related.length > 0 && pending.length === 0,
    state: pending.length ? "todo" : "ready",
    detail: pending.length
      ? pending[0]?.nextAction || "Review pending setup checks."
      : "Ready.",
    nextAction: pending.length
      ? pending[0]?.nextAction || "Review pending setup checks."
      : "",
  };
};

const completionReadiness = (check: CompletionCheck | undefined) => ({
  ready: Boolean(check?.complete),
  state: check?.complete ? "ready" : "todo",
  detail: check?.complete ? "Recorded or detected." : check?.nextAction || "",
});
