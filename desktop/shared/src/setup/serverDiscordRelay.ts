import {
  DiscordRelayClient,
  type DiscordRelaySuggestionStatus,
} from "../discord/relay";
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
  listDiscordRelayActions,
  parseDiscordRelayActionFilter,
  parseDiscordRelayActionStatus,
  persistDiscordRelayActions,
  updateDiscordRelayActionStatus,
} from "../discord/relayActions";
import { URL } from "node:url";
import { basename, dirname, join, resolve } from "node:path";
import { getRecentAuditLogs, writeAuditLog } from "../core/auditLog";
import { localUiActor } from "./serverCommandSimulation";
import { getSafeDiscordRelayConfig, getSafeRelayConfig } from "./serverConfig";
import { objectInput, optionalInputString } from "./serverDiscordSetup";
import { sanitizeOptionalText } from "./serverInput";
import {
  optionalRelaySuggestionStatus,
  relaySuggestionStatus,
} from "./serverRehearsal";
import { db } from "./serverState";
import { appendSuiteTimelineEvent } from "./serverSuite";

export const getDiscordRelayStatusRoute = async () => {
  const secrets = readLocalSecrets();
  const relay = getSafeDiscordRelayConfig(secrets);
  const connectionError = discordRelayConnectionError(secrets);
  if (connectionError) {
    return {
      ok: true,
      connected: false,
      relay,
      error: connectionError,
    };
  }

  try {
    const status = await createDiscordRelayClient(secrets).status();
    return {
      ok: true,
      connected: true,
      relay,
      readiness: status.readiness,
      hosted: status.config,
      templates: status.templates,
    };
  } catch (error) {
    return {
      ok: false,
      connected: false,
      relay,
      error: safeErrorMessage(error, "Discord Relay status check failed."),
    };
  }
};

export const startDiscordRelayInstallRoute = async () => {
  const secrets = readLocalSecrets();
  const connectionError = discordRelayConnectionError(secrets);
  if (connectionError) {
    throw new SafeInputError(connectionError);
  }
  return createDiscordRelayClient(secrets).startInstall();
};

export const previewDiscordRelaySetupRoute = async (body: unknown) => {
  const secrets = readLocalSecrets();
  const connectionError = discordRelayConnectionError(secrets);
  if (connectionError) {
    throw new SafeInputError(connectionError);
  }
  return createDiscordRelayClient(secrets).previewSetup(objectInput(body));
};

export const applyDiscordRelaySetupRoute = async (body: unknown) => {
  const secrets = readLocalSecrets();
  const connectionError = discordRelayConnectionError(secrets);
  if (connectionError) {
    throw new SafeInputError(connectionError);
  }
  const input = objectInput(body);
  const client = createDiscordRelayClient(secrets);
  let result = await client.applySetup(input);
  let chunks = 1;
  while (discordRelaySetupNeedsContinuation(result) && chunks < 10) {
    await wait(250);
    result = await client.applySetup(input);
    chunks += 1;
  }
  appendSuiteTimelineEvent({
    sourceApp: "vaexcore-console",
    sourceAppName: "vaexcore console",
    kind: "discord.relay.setup",
    title: discordRelaySetupNeedsContinuation(result)
      ? "Hosted Discord setup partially applied"
      : "Hosted Discord setup applied",
    detail: discordRelaySetupNeedsContinuation(result)
      ? "Relay applied part of the hosted Discord server setup. Run Apply setup again to continue."
      : "Relay applied the hosted Discord server setup without exposing a bot token in Console.",
    metadata: {
      templateId:
        typeof result.template === "object" &&
        result.template &&
        "id" in result.template
          ? result.template.id
          : undefined,
      chunks,
    },
  });
  return result;
};

export const discordRelaySetupNeedsContinuation = (
  result: Record<string, unknown>,
) => result.needsContinuation === true;

export const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const registerDiscordRelayCommandsRoute = async () => {
  const secrets = readLocalSecrets();
  const connectionError = discordRelayConnectionError(secrets);
  if (connectionError) {
    throw new SafeInputError(connectionError);
  }
  const result = await createDiscordRelayClient(secrets).registerCommands();
  const current = readLocalSecrets();
  writeLocalSecrets({
    ...current,
    botValidation: {
      ...current.botValidation,
      discordSlashCommandsRegisteredAt: new Date().toISOString(),
    },
  });
  appendSuiteTimelineEvent({
    sourceApp: "vaexcore-console",
    sourceAppName: "vaexcore console",
    kind: "discord.relay.commands.register",
    title: "Discord slash commands registered",
    detail: `Console registered ${result.commands.length} Discord slash commands through Relay.`,
    metadata: {
      scope: result.scope,
      registeredAt: result.registeredAt,
      commands: result.commands,
    },
  });
  return result;
};

export const getDiscordRelayEventsRoute = async () => {
  const secrets = readLocalSecrets();
  const connectionError = discordRelayConnectionError(secrets);
  if (connectionError) {
    throw new SafeInputError(connectionError);
  }
  const result = await createDiscordRelayClient(secrets).events(50);
  const persisted = persistDiscordRelayActions(db, result.events || []);
  if (persisted > 0) {
    writeAuditLog(
      db,
      localUiActor,
      "discord.relay.actions.load",
      "discord_relay_actions",
      {
        persisted,
        eventCount: result.events.length,
      },
    );
  }
  return {
    ...result,
    actions: listDiscordRelayActions(db, { status: "active", limit: 50 }),
  };
};

export const getDiscordRelayActionsRoute = (searchParams: URLSearchParams) => ({
  ok: true,
  actions: listDiscordRelayActions(db, {
    status: parseDiscordRelayActionFilter(searchParams.get("status")),
    limit: searchParams.get("limit"),
  }),
});

export const updateDiscordRelayActionStatusRoute = (body: unknown) => {
  const input = objectInput(body);
  const id =
    optionalInputString(input.relayEventId) || optionalInputString(input.id);
  if (!id) {
    throw new SafeInputError("Discord Relay action ID is required.");
  }
  const status = parseDiscordRelayActionStatus(input.status);
  const action = updateDiscordRelayActionStatus(db, id, status);
  if (!action) {
    throw new SafeInputError("Discord Relay action was not found.");
  }
  writeAuditLog(
    db,
    localUiActor,
    `discord.relay.action.${status}`,
    action.relayEventId,
    {
      commandName: action.commandName,
      username: action.username,
      status,
    },
  );
  return { ok: true, action };
};

export const getDiscordRelaySuggestionsRoute = async (
  searchParams: URLSearchParams,
) => {
  const secrets = readLocalSecrets();
  const connectionError = discordRelayConnectionError(secrets);
  if (connectionError) {
    throw new SafeInputError(connectionError);
  }
  return createDiscordRelayClient(secrets).suggestions(
    optionalRelaySuggestionStatus(searchParams.get("status")),
  );
};

export const updateDiscordRelaySuggestionRoute = async (body: unknown) => {
  const input = objectInput(body);
  const id = optionalInputString(input.id);
  if (!id) {
    throw new SafeInputError("Discord suggestion ID is required.");
  }
  const status = relaySuggestionStatus(input.status);
  const secrets = readLocalSecrets();
  const connectionError = discordRelayConnectionError(secrets);
  if (connectionError) {
    throw new SafeInputError(connectionError);
  }
  return createDiscordRelayClient(secrets).updateSuggestionStatus(id, status);
};

export const discordRelayConnectionError = (secrets = readLocalSecrets()) => {
  const relay = secrets.relay;
  const readiness = relayConfigReadiness({
    baseUrl: relay.baseUrl,
    installationId: relay.installationId,
    consoleToken: relay.consoleToken,
  });
  if (!readiness.ready) {
    return "Save Relay URL, installation ID, and console token before using Discord slash command Relay mode.";
  }
  return "";
};

export const createDiscordRelayClient = (secrets = readLocalSecrets()) =>
  new DiscordRelayClient({
    baseUrl: secrets.relay.baseUrl,
    installationId: secrets.relay.installationId,
    consoleToken: secrets.relay.consoleToken,
  });

export const syncDiscordOperatorRoleToRelay = async (
  operatorRoleId: string,
) => {
  const secrets = readLocalSecrets();
  const connectionError = discordRelayConnectionError(secrets);
  if (connectionError) {
    return { ok: false, skipped: true, error: connectionError };
  }
  try {
    const result = await createDiscordRelayClient(secrets).updateConfig({
      operatorRoleId,
    });
    return { ...result, skipped: false };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      error: safeErrorMessage(
        error,
        "Relay could not save the Discord operator role.",
      ),
    };
  }
};

export const recordRelayChatbotIdentityValidation = (body: unknown) => {
  const input = objectInput(body);
  const existing = readLocalSecrets();
  const confirmed = input.confirmed !== false;
  const note = sanitizeOptionalText(
    optionalInputString(input.note),
    "Chat Bot identity validation note",
    240,
  );
  writeLocalSecrets({
    ...existing,
    relay: {
      ...existing.relay,
      chatbotIdentityValidatedAt: confirmed
        ? new Date().toISOString()
        : undefined,
      chatbotIdentityValidationNote: confirmed ? note : undefined,
    },
    botValidation: {
      ...existing.botValidation,
      twitchChatBotUserListConfirmedAt: confirmed
        ? new Date().toISOString()
        : undefined,
    },
  });
  return { ok: true, relay: getSafeRelayConfig() };
};
