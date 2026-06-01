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
import {
  discordAnnouncementKinds,
  discordSetupTemplates,
  getDiscordSetupTemplate,
  type DiscordSetupTemplate,
} from "../discord/templates";
import { URL } from "node:url";
import { defaultConfig } from "../config/defaultConfig";
import {
  getSafeConfig,
  getSafeDiscordConfig,
  getSafeRelayConfig,
} from "./serverConfig";
import {
  createDiscordClient,
  discordConnectionError,
  getDiscordAnnouncementChannelId,
  objectInput,
  optionalInputString,
} from "./serverDiscordSetup";
import { sanitizeRelayBaseUrl } from "./serverInput";
import { appendSuiteTimelineEvent } from "./serverSuite";

export const connectHostedRelayRoute = async (body: unknown) => {
  const input = objectInput(body);
  const existing = readLocalSecrets();
  const requestedBaseUrl =
    optionalInputString(input.relayBaseUrl) ||
    existing.relay.baseUrl ||
    defaultConfig.hostedRelayBaseUrl;
  const baseUrl = sanitizeRelayBaseUrl(requestedBaseUrl);
  if (!baseUrl) {
    throw new SafeInputError("Hosted Relay URL is missing.");
  }

  const alreadyPaired =
    input.force !== true &&
    existing.relay.twitchTransportMode === "relay-chatbot" &&
    existing.relay.baseUrl?.replace(/\/+$/, "") === baseUrl &&
    Boolean(existing.relay.installationId && existing.relay.consoleToken);

  if (alreadyPaired) {
    return {
      ok: true,
      alreadyPaired: true,
      config: getSafeConfig(),
      relay: getSafeRelayConfig(existing),
      status: await getRelayStatusRoute(),
    };
  }

  const install = await startRelayHostedInstall({
    baseUrl,
    name: "VaexCore Console",
  });
  if (!install.ok || !install.installationId || !install.consoleToken) {
    throw new SafeInputError("Hosted Relay did not return a Console pairing.");
  }

  const now = new Date().toISOString();
  const next: LocalSecrets = {
    ...existing,
    setupMode: "relay-assisted",
    relay: {
      ...existing.relay,
      twitchTransportMode: "relay-chatbot",
      baseUrl,
      installationId: install.installationId,
      consoleToken: install.consoleToken,
      chatbotIdentityValidatedAt: undefined,
      chatbotIdentityValidationNote: undefined,
    },
    setupChecks: {
      ...existing.setupChecks,
      relay: {
        checkedAt: now,
        status: "ready",
        message:
          "Hosted Relay pairing is saved. Authorize the bot and broadcaster accounts next.",
      },
    },
    botValidation: {
      ...existing.botValidation,
      twitchEventSubRegisteredAt: undefined,
      twitchRelayTestSendPassedAt: undefined,
      twitchChatBotUserListConfirmedAt: undefined,
    },
  };
  writeLocalSecrets(next);
  appendSuiteTimelineEvent({
    sourceApp: "vaexcore-console",
    sourceAppName: "vaexcore console",
    kind: "twitch.relay.hosted.connect",
    title: "Hosted Twitch Relay paired",
    detail:
      "Console created a hosted Relay installation for Twitch Chat Bot setup.",
    metadata: {
      transport: "relay-chatbot",
      relayBaseUrl: baseUrl,
      installationId: install.installationId,
    },
  });

  let status: Awaited<ReturnType<typeof getRelayStatusRoute>> | null = null;
  try {
    status = await getRelayStatusRoute();
  } catch {
    status = null;
  }

  return {
    ok: true,
    alreadyPaired: false,
    config: getSafeConfig(),
    relay: getSafeRelayConfig(),
    install: {
      installationId: install.installationId,
      next: install.next ?? {},
    },
    status,
  };
};

export const getDiscordReadiness = (secrets = readLocalSecrets()) => {
  const discord = secrets.discord;
  const checks = [
    {
      name: "Bot token",
      ok: Boolean(discord.botToken),
      detail: discord.botToken
        ? "Discord bot token is saved locally."
        : "Save a Discord bot token created in the Discord Developer Portal.",
    },
    {
      name: "Server ID",
      ok: Boolean(discord.guildId),
      detail: discord.guildId
        ? "Discord server ID is saved."
        : "Save the Discord server ID for the channel setup target.",
    },
    {
      name: "Announcement channel",
      ok: Boolean(getDiscordAnnouncementChannelId(discord)),
      detail: getDiscordAnnouncementChannelId(discord)
        ? "A stream announcement channel is selected."
        : "Apply the server setup or save a stream announcement channel ID.",
    },
  ];

  return {
    ready: checks.every((check) => check.ok),
    checks,
  };
};

export const getDiscordStatus = async (searchParams: URLSearchParams) => {
  const secrets = readLocalSecrets();
  const validate = searchParams.get("validate") === "1";
  let bot: { id: string; username: string } | null = null;
  let validationError = "";

  if (validate && secrets.discord.botToken) {
    try {
      const currentUser = await createDiscordClient(
        secrets.discord.botToken,
      ).getCurrentUser();
      bot = {
        id: currentUser.id,
        username: currentUser.global_name || currentUser.username,
      };
    } catch (error) {
      validationError = safeErrorMessage(
        error,
        "Discord bot validation failed.",
      );
    }
  }

  return {
    ok: true,
    config: getSafeDiscordConfig(secrets),
    readiness: getDiscordReadiness(secrets),
    template: getDiscordSetupTemplate(secrets.discord.setupTemplateId),
    templates: discordSetupTemplates,
    bot,
    validationError,
  };
};

export const getDiscordRolesRoute = async () => {
  const secrets = readLocalSecrets();
  const connectionError = discordConnectionError({
    requireAnnouncementChannel: false,
  });

  if (connectionError) {
    return {
      ok: true,
      connected: false,
      roles: [],
      error: connectionError,
      config: getSafeDiscordConfig(secrets),
    };
  }

  try {
    const guildId = secrets.discord.guildId ?? "";
    const roles = await createDiscordClient(
      secrets.discord.botToken ?? "",
    ).listGuildRoles(guildId);
    return {
      ok: true,
      connected: true,
      roles: roles
        .map((role) => ({
          id: role.id,
          name: role.name,
          managed: Boolean(role.managed),
          mentionable: Boolean(role.mentionable),
          staffEligible: role.id !== guildId && !role.managed,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      config: getSafeDiscordConfig(secrets),
    };
  } catch (error) {
    return {
      ok: true,
      connected: false,
      roles: [],
      error: safeErrorMessage(error, "Discord role loading failed."),
      config: getSafeDiscordConfig(secrets),
    };
  }
};

export const getRelayStatusRoute = async () => {
  const secrets = readLocalSecrets();
  const relay = getSafeRelayConfig(secrets);
  const connectionError = relayConnectionError(secrets);
  if (connectionError) {
    return {
      ok: true,
      connected: false,
      relay,
      error: connectionError,
    };
  }

  try {
    const status = await createRelayChatClient(secrets).status();
    return {
      ok: true,
      connected: true,
      relay,
      installation: status.installation,
      readiness: status.readiness,
    };
  } catch (error) {
    return {
      ok: false,
      connected: false,
      relay,
      error: safeErrorMessage(error, "Relay status check failed."),
    };
  }
};

export const registerRelayEventSubRoute = async () => {
  const secrets = readLocalSecrets();
  const connectionError = relayConnectionError(secrets);
  if (connectionError) {
    throw new SafeInputError(connectionError);
  }
  const result = await createRelayChatClient(secrets).registerEventSub();
  const current = readLocalSecrets();
  writeLocalSecrets({
    ...current,
    botValidation: {
      ...current.botValidation,
      twitchEventSubRegisteredAt: new Date().toISOString(),
    },
  });
  appendSuiteTimelineEvent({
    sourceApp: "vaexcore-console",
    sourceAppName: "vaexcore console",
    kind: "twitch.relay.eventsub.register",
    title: "Twitch Relay EventSub registered",
    detail: "Console registered the Relay chatbot EventSub subscription.",
    metadata: {
      transport: "relay-chatbot",
      subscription: result.subscription ?? null,
    },
  });
  return {
    ...result,
    relay: getSafeRelayConfig(),
  };
};

export const sendRelayTestMessageRoute = async () => {
  const secrets = readLocalSecrets();
  const connectionError = relayConnectionError(secrets);
  if (connectionError) {
    return {
      ok: false,
      relay: getSafeRelayConfig(secrets),
      error: connectionError,
      failureCategory: "config",
    };
  }

  const result = await createRelayChatClient(secrets).send(
    "vaexcore console relay setup test.",
    {
      idempotencyKey: `console-test-send-${new Date().toISOString().slice(0, 10)}`,
    },
  );
  const structured = typeof result === "string" ? { status: result } : result;
  if (structured.status === "sent") {
    const current = readLocalSecrets();
    writeLocalSecrets({
      ...current,
      botValidation: {
        ...current.botValidation,
        twitchRelayTestSendPassedAt: new Date().toISOString(),
      },
    });
  }
  return {
    ok: structured.status === "sent",
    relay: getSafeRelayConfig(),
    error:
      structured.status === "sent"
        ? undefined
        : structured.reason || "Relay test chat message was not sent.",
    failureCategory: structured.failureCategory,
  };
};

export const relayConnectionError = (secrets = readLocalSecrets()) => {
  const relay = secrets.relay;
  const readiness = relayConfigReadiness({
    baseUrl: relay.baseUrl,
    installationId: relay.installationId,
    consoleToken: relay.consoleToken,
  });
  if (!readiness.ready) {
    return "Start hosted Twitch setup before using Relay chatbot setup.";
  }
  return "";
};

export const createRelayChatClient = (secrets = readLocalSecrets()) =>
  new RelayChatClient({
    baseUrl: secrets.relay.baseUrl,
    installationId: secrets.relay.installationId,
    consoleToken: secrets.relay.consoleToken,
  });
