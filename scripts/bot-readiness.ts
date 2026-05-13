import {
  getLocalSecretsPath,
  readLocalSecrets,
} from "../desktop/shared/src/config/localSecrets";
import { DiscordRelayClient } from "../desktop/shared/src/discord/relay";
import { RelayChatClient } from "../desktop/shared/src/twitch/relayTransport";

type CheckStatus = "pass" | "todo" | "warn";

type ReadinessCheck = {
  label: string;
  status: CheckStatus;
  detail: string;
  nextAction?: string;
};

type ReadinessSection = {
  title: string;
  checks: ReadinessCheck[];
};

const secrets = readLocalSecrets();
const relayBaseUrl = (secrets.relay.baseUrl ?? "").replace(/\/+$/, "");
const relayConfigured = Boolean(
  relayBaseUrl && secrets.relay.installationId && secrets.relay.consoleToken,
);
const setupUrls = relaySetupUrls(relayBaseUrl, secrets.relay.installationId);

const sections: ReadinessSection[] = [];

addSection("Local Console Pairing", [
  check(
    Boolean(relayBaseUrl),
    "Relay URL",
    "saved",
    "missing",
    "Save Relay URL in Console Settings.",
  ),
  check(
    Boolean(secrets.relay.installationId),
    "Relay installation",
    "installation ID is saved",
    "installation ID is missing",
    "Save the Relay installation ID in Console Settings.",
  ),
  check(
    Boolean(secrets.relay.consoleToken),
    "Relay console token",
    "console token is saved locally",
    "console token is missing",
    "Save the Relay console token in Console Settings.",
  ),
  {
    label: "Twitch transport",
    status:
      secrets.relay.twitchTransportMode === "relay-chatbot" ? "pass" : "todo",
    detail: secrets.relay.twitchTransportMode,
    nextAction:
      secrets.relay.twitchTransportMode === "relay-chatbot"
        ? undefined
        : "Switch Twitch Chat Transport to relay-chatbot before live Chat Bot validation.",
  },
]);

addSection("Twitch Relay Setup URLs", [
  check(
    Boolean(setupUrls.twitchCallbackUrl),
    "Twitch callback URL",
    setupUrls.twitchCallbackUrl || "available after Relay URL is saved",
    "missing",
    "Add this URL in the Twitch Developer Console before OAuth.",
  ),
  check(
    Boolean(setupUrls.twitchBotOAuthUrl),
    "Bot OAuth URL",
    setupUrls.twitchBotOAuthUrl ||
      "available after Relay URL and installation ID are saved",
    "missing",
    "Open while logged into vaexcorebot.",
  ),
  check(
    Boolean(setupUrls.twitchBroadcasterOAuthUrl),
    "Broadcaster OAuth URL",
    setupUrls.twitchBroadcasterOAuthUrl ||
      "available after Relay URL and installation ID are saved",
    "missing",
    "Open while logged into the broadcaster account.",
  ),
]);

await addRelayHealthSection();
await addTwitchRelaySection();
await addDiscordRelaySection();
addValidationRecordSection();

addSection("Local Discord Setup", [
  check(
    Boolean(secrets.discord.botToken),
    "Discord bot token",
    "saved locally",
    "missing",
    "Save a Discord bot token in Console if Console should create channels or send direct announcements.",
  ),
  check(
    Boolean(secrets.discord.guildId),
    "Discord server ID",
    secrets.discord.guildId ? "saved" : "missing",
    "missing",
    "Save the target Discord server ID in Console.",
  ),
  check(
    Boolean(secrets.discord.streamAnnouncementChannelId),
    "Announcement channel",
    secrets.discord.streamAnnouncementChannelId ? "saved" : "missing",
    "missing",
    "Apply server setup or save a stream announcement channel ID.",
  ),
  check(
    Boolean(secrets.discord.setupAppliedAt),
    "Server layout",
    secrets.discord.setupAppliedAt || "not applied",
    "not applied",
    "Preview and apply Discord server setup after local Discord credentials are saved.",
  ),
]);

printReport();
process.exit(0);

async function addRelayHealthSection() {
  const checks: ReadinessCheck[] = [
    check(
      Boolean(relayBaseUrl),
      "Relay public URL",
      relayBaseUrl || "missing",
      "missing",
      "Save Relay URL before checking public health.",
    ),
  ];

  if (relayBaseUrl) {
    try {
      const response = await fetch(`${relayBaseUrl}/health`);
      const body = await response.json().catch(() => null);
      checks.push({
        label: "Relay health endpoint",
        status: response.ok && body?.ok === true ? "pass" : "warn",
        detail:
          response.ok && body?.ok === true
            ? `${body.service ?? "Relay"} is reachable`
            : `Relay health returned HTTP ${response.status}`,
        nextAction:
          response.ok && body?.ok === true
            ? undefined
            : "Confirm Cloudflare Worker deployment and relay.vaexil.tv DNS.",
      });
    } catch (error) {
      checks.push({
        label: "Relay health endpoint",
        status: "warn",
        detail: safeError(error),
        nextAction: "Confirm network access, Worker deployment, and DNS.",
      });
    }
  }

  addSection("Relay Health", checks);
}

async function addTwitchRelaySection() {
  const checks: ReadinessCheck[] = [
    check(
      relayConfigured,
      "Console-to-Relay auth",
      "configured locally",
      "missing local Relay config",
      "Save Relay URL, installation ID, and console token in Console Settings.",
    ),
  ];

  if (relayConfigured) {
    try {
      const client = new RelayChatClient({
        baseUrl: relayBaseUrl,
        installationId: secrets.relay.installationId,
        consoleToken: secrets.relay.consoleToken,
      });
      const status = await client.status();
      checks.push(...relayChecks(status.readiness?.checks ?? []));
      const report = await client.readinessReport().catch(() => null);
      if (report?.checks?.length) {
        checks.push(...relayChecks(report.checks));
      }
      if (report?.counts) {
        checks.push({
          label: "Relay queue counts",
          status: "pass",
          detail: `twitch events ${report.counts.queuedTwitchChatEvents ?? 0}, discord interactions ${report.counts.queuedDiscordInteractions ?? 0}, outbound dead-lettered ${report.counts.outboundSends?.deadLettered ?? 0}`,
        });
      }
    } catch (error) {
      checks.push({
        label: "Twitch Relay status",
        status: "warn",
        detail: safeError(error),
        nextAction: "Run Check Relay in Console and confirm Relay pairing.",
      });
    }
  }

  checks.push({
    label: "Chat Bot identity live test",
    status: secrets.relay.chatbotIdentityValidatedAt ? "pass" : "todo",
    detail: secrets.relay.chatbotIdentityValidatedAt || "not recorded",
    nextAction: secrets.relay.chatbotIdentityValidatedAt
      ? undefined
      : "After Relay test chat sends, confirm Twitch lists vaexcorebot as Chat Bot and record it in Console.",
  });

  addSection("Twitch Chat Bot Readiness", checks);
}

async function addDiscordRelaySection() {
  const checks: ReadinessCheck[] = [
    check(
      Boolean(setupUrls.discordInteractionUrl),
      "Discord interaction URL",
      setupUrls.discordInteractionUrl || "available after Relay URL is saved",
      "missing",
      "Set this as the Discord application Interactions Endpoint URL after Worker Discord secrets are set.",
    ),
  ];

  if (relayConfigured) {
    try {
      const status = await new DiscordRelayClient({
        baseUrl: relayBaseUrl,
        installationId: secrets.relay.installationId,
        consoleToken: secrets.relay.consoleToken,
      }).status();
      checks.push(...relayChecks(status.readiness?.checks ?? []));
    } catch (error) {
      checks.push({
        label: "Discord Relay status",
        status: "warn",
        detail: safeError(error),
        nextAction:
          "Run Check Relay in the Discord tab and confirm Worker Discord configuration.",
      });
    }
  } else {
    checks.push({
      label: "Discord Relay status",
      status: "todo",
      detail: "not checked because local Relay config is incomplete",
      nextAction: "Save Relay URL, installation ID, and console token first.",
    });
  }

  addSection("Discord Relay Readiness", checks);
}

function addValidationRecordSection() {
  const records = secrets.botValidation;
  addSection("Live Validation Records", [
    recordCheck(
      "Twitch callback URL added",
      records.twitchCallbackAddedAt,
      "Add the Relay callback URL in the Twitch Developer Console.",
    ),
    recordCheck(
      "Twitch bot OAuth completed",
      records.twitchBotOAuthCompletedAt,
      "Authorize vaexcorebot through Relay.",
    ),
    recordCheck(
      "Twitch broadcaster OAuth completed",
      records.twitchBroadcasterOAuthCompletedAt,
      "Authorize the broadcaster channel through Relay.",
    ),
    recordCheck(
      "Twitch EventSub registered",
      records.twitchEventSubRegisteredAt,
      "Register EventSub through Console after OAuth grants.",
    ),
    recordCheck(
      "Twitch Relay test send passed",
      records.twitchRelayTestSendPassedAt,
      "Send a Relay test message through Console.",
    ),
    recordCheck(
      "Twitch Chat Bot user-list confirmed",
      records.twitchChatBotUserListConfirmedAt ||
        secrets.relay.chatbotIdentityValidatedAt,
      "Confirm Twitch lists vaexcorebot as a Chat Bot.",
    ),
    recordCheck(
      "Discord interaction endpoint accepted",
      records.discordInteractionEndpointAcceptedAt,
      "Set the Discord Interactions Endpoint URL to Relay.",
    ),
    recordCheck(
      "Discord slash commands registered",
      records.discordSlashCommandsRegisteredAt,
      "Register Discord slash commands through Console.",
    ),
    recordCheck(
      "Discord /suggest tested",
      records.discordSuggestCommandTestedAt,
      "Run /suggest and confirm it reaches Console.",
    ),
    recordCheck(
      "Discord announcement command tested",
      records.discordAnnouncementCommandTestedAt,
      "Run /live, /late, /cancelled, or /scheduled and confirm operator review.",
    ),
  ]);
}

function recordCheck(
  label: string,
  value: string | undefined,
  nextAction: string,
): ReadinessCheck {
  return {
    label,
    status: value ? "pass" : "todo",
    detail: value || "not recorded",
    nextAction: value ? undefined : nextAction,
  };
}

function addSection(title: string, checks: ReadinessCheck[]) {
  sections.push({ title, checks });
}

function check(
  ok: boolean,
  label: string,
  passDetail: string,
  todoDetail: string,
  nextAction?: string,
): ReadinessCheck {
  return {
    label,
    status: ok ? "pass" : "todo",
    detail: ok ? passDetail : todoDetail,
    nextAction: ok ? undefined : nextAction,
  };
}

function relayChecks(
  checks: Array<{ key: string; ok: boolean; detail: string }>,
): ReadinessCheck[] {
  return checks.map((item) => ({
    label: item.key,
    status: item.ok ? "pass" : "todo",
    detail: item.detail,
    nextAction: item.ok ? undefined : relayNextAction(item.key),
  }));
}

function relayNextAction(key: string) {
  const actions: Record<string, string> = {
    "bot-grant": "Open the bot OAuth URL while logged into vaexcorebot.",
    "broadcaster-grant":
      "Open the broadcaster OAuth URL while logged into the broadcaster account.",
    "separate-bot-account":
      "Use separate Twitch accounts for vaexcorebot and the broadcaster grant.",
    "discord-bot-token": "Set DISCORD_BOT_TOKEN on the Relay Worker.",
    "discord-public-key": "Set DISCORD_PUBLIC_KEY on the Relay Worker.",
    "discord-application-id": "Set DISCORD_APPLICATION_ID on the Relay Worker.",
    "discord-guild-id": "Set DISCORD_GUILD_ID on the Relay Worker.",
    "discord-command-registration":
      "Register Discord slash commands from the Console Discord tab.",
  };
  return actions[key];
}

function relaySetupUrls(baseUrl: string, installationId?: string) {
  const installQuery = installationId
    ? `?installationId=${encodeURIComponent(installationId)}`
    : "";
  return {
    twitchCallbackUrl: baseUrl ? `${baseUrl}/oauth/twitch/callback` : "",
    twitchBotOAuthUrl:
      baseUrl && installationId
        ? `${baseUrl}/oauth/twitch/start${installQuery}&kind=bot`
        : "",
    twitchBroadcasterOAuthUrl:
      baseUrl && installationId
        ? `${baseUrl}/oauth/twitch/start${installQuery}&kind=broadcaster`
        : "",
    discordInteractionUrl: baseUrl
      ? `${baseUrl}/webhooks/discord/interactions`
      : "",
  };
}

function printReport() {
  const flatChecks = sections.flatMap((section) => section.checks);
  const todoCount = flatChecks.filter((item) => item.status === "todo").length;
  const warnCount = flatChecks.filter((item) => item.status === "warn").length;
  const passCount = flatChecks.filter((item) => item.status === "pass").length;

  console.log("VaexCore Bot Readiness");
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log(`Config: ${getLocalSecretsPath()}`);
  console.log(
    `Summary: ${passCount} pass, ${todoCount} todo, ${warnCount} warning`,
  );
  console.log("");

  for (const section of sections) {
    console.log(section.title);
    for (const item of section.checks) {
      console.log(
        `- ${statusLabel(item.status)} ${item.label}: ${item.detail}`,
      );
      if (item.nextAction) {
        console.log(`  next: ${item.nextAction}`);
      }
    }
    console.log("");
  }

  console.log(
    "This report is redacted. It prints whether secrets are present, never their values.",
  );
}

function statusLabel(status: CheckStatus) {
  if (status === "pass") return "PASS";
  if (status === "warn") return "WARN";
  return "TODO";
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
