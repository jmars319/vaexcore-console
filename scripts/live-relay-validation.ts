import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  getLocalSecretsPath,
  readLocalSecrets,
  writeLocalSecrets,
  type LocalSecrets,
} from "../desktop/shared/src/config/localSecrets";
import { DiscordRelayClient } from "../desktop/shared/src/discord/relay";
import {
  RelayChatClient,
  type RelayBotReadinessReport,
} from "../desktop/shared/src/twitch/relayTransport";

type CheckStatus = "pass" | "warn" | "fail" | "skipped";

type LiveValidationCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  evidence?: Record<string, unknown>;
};

type LiveValidationReport = {
  schemaVersion: 1;
  generatedAt: string;
  mode: {
    recordLocalState: boolean;
    setRelayTransport: boolean;
    registerEventSub: boolean;
    sendChat: boolean;
    registerDiscordCommands: boolean;
  };
  localConfig: {
    path: string;
    relayBaseUrl: string;
    productionTarget: boolean;
    installationSaved: boolean;
    consoleCredentialSaved: boolean;
    twitchTransportMode: string;
  };
  summary: {
    status: "pass" | "pass-with-warnings" | "failed";
    passed: number;
    warnings: number;
    failed: number;
    skipped: number;
  };
  checks: LiveValidationCheck[];
  artifacts: {
    json: string;
    markdown: string;
  };
};

const productionRelayUrl = "https://relay.vaexil.tv";
const expectedDiscordCommands = [
  "suggest",
  "live",
  "late",
  "cancelled",
  "scheduled",
  "setup-status",
];
const args = parseArgs(process.argv.slice(2));
const now = new Date().toISOString();
const artifactDir = resolve(
  String(
    args["artifact-dir"] ??
      process.env.VAEXCORE_LIVE_VALIDATION_ARTIFACT_DIR ??
      ".local/live-relay-validation",
  ),
);
const artifactJsonPath = join(artifactDir, "latest.json");
const artifactMarkdownPath = join(artifactDir, "latest.md");
const checks: LiveValidationCheck[] = [];
let secrets = readLocalSecrets();

const recordLocalState = Boolean(args.record);
const setRelayTransport = Boolean(args["set-relay-transport"]);
const registerEventSub = Boolean(args["register-eventsub"]);
const sendChat = Boolean(args["send-chat"]);
const registerDiscordCommands = Boolean(args["register-discord-commands"]);
const debug = Boolean(args.debug || process.env.VAEXCORE_LIVE_VALIDATION_DEBUG);

if (recordLocalState && setRelayTransport) {
  secrets = updateLocalSecrets((current) => ({
    ...current,
    setupMode: "relay-assisted",
    relay: {
      ...current.relay,
      twitchTransportMode: "relay-chatbot",
    },
  }));
}

const relayBaseUrl = (secrets.relay.baseUrl ?? "").replace(/\/+$/, "");
const relayConfigured = Boolean(
  relayBaseUrl && secrets.relay.installationId && secrets.relay.consoleToken,
);
const relayClient = new RelayChatClient({
  baseUrl: relayBaseUrl,
  installationId: secrets.relay.installationId,
  consoleToken: secrets.relay.consoleToken,
});
const discordRelayClient = new DiscordRelayClient({
  baseUrl: relayBaseUrl,
  installationId: secrets.relay.installationId,
  consoleToken: secrets.relay.consoleToken,
});

await runValidation();

async function runValidation() {
  trace("starting validation");
  addCheck({
    id: "local-relay-config",
    label: "Local Relay pairing",
    status: relayConfigured ? "pass" : "fail",
    detail: relayConfigured
      ? "Relay URL, installation ID, and Console token are saved locally."
      : "Relay URL, installation ID, or Console token is missing.",
    evidence: {
      baseUrl: relayBaseUrl || null,
      installationSaved: Boolean(secrets.relay.installationId),
      consoleCredentialSaved: Boolean(secrets.relay.consoleToken),
    },
  });

  addCheck({
    id: "relay-transport-mode",
    label: "Hosted Relay transport mode",
    status:
      secrets.relay.twitchTransportMode === "relay-chatbot" ? "pass" : "warn",
    detail:
      secrets.relay.twitchTransportMode === "relay-chatbot"
        ? "Console is configured for Relay Chat Bot transport."
        : "Console is still configured for local-user-token transport.",
    evidence: { transportMode: secrets.relay.twitchTransportMode },
  });

  if (!relayBaseUrl) {
    return finish();
  }

  await traceStep("relay health", validateRelayHealth);
  if (!relayConfigured) {
    return finish();
  }

  const readiness = await traceStep("twitch relay", validateTwitchRelay);
  await traceStep("eventsub", maybeRegisterEventSub);
  await traceStep("chat send", maybeSendRelayChat);
  await traceStep("chat events", () => validateRelayChatEvents(readiness));
  await traceStep("discord relay", validateDiscordRelay);
  await traceStep("discord commands", maybeRegisterDiscordCommands);
  await traceStep("discord queues", validateDiscordQueues);
  finish();
}

async function validateRelayHealth() {
  try {
    const response = await fetch(`${relayBaseUrl}/health`);
    const body = await response.json().catch(() => null);
    addCheck({
      id: "relay-health",
      label: "Relay health",
      status: response.ok && body?.ok === true ? "pass" : "fail",
      detail:
        response.ok && body?.ok === true
          ? `${body.service ?? "Relay"} is reachable.`
          : `Relay health returned HTTP ${response.status}.`,
      evidence: { capabilities: body?.capabilities ?? [] },
    });
  } catch (error) {
    addCheck({
      id: "relay-health",
      label: "Relay health",
      status: "fail",
      detail: safeError(error),
    });
  }
}

async function validateTwitchRelay() {
  let readiness: RelayBotReadinessReport | null = null;
  try {
    const status = await relayClient.status();
    const checksByKey = readinessKeyMap(status.readiness?.checks ?? []);
    addReadinessCheck(checksByKey, "bot-grant", "Twitch bot OAuth grant");
    addReadinessCheck(
      checksByKey,
      "broadcaster-grant",
      "Twitch broadcaster OAuth grant",
    );
    addReadinessCheck(
      checksByKey,
      "separate-bot-account",
      "Separate Twitch bot account",
    );

    if (recordLocalState) {
      markValidation("twitchBotOAuthCompletedAt", checksByKey.get("bot-grant"));
      markValidation(
        "twitchBroadcasterOAuthCompletedAt",
        checksByKey.get("broadcaster-grant"),
      );
      markValidation("twitchCallbackAddedAt", {
        ok: true,
        detail: `${relayBaseUrl}/oauth/twitch/callback`,
      });
    }
  } catch (error) {
    addCheck({
      id: "twitch-relay-status",
      label: "Twitch Relay status",
      status: "fail",
      detail: safeError(error),
    });
  }

  try {
    readiness = await relayClient.readinessReport();
    addCheck({
      id: "relay-readiness-report",
      label: "Relay readiness report",
      status: readiness.summary?.state === "failed" ? "fail" : "pass",
      detail: readiness.summary?.detail ?? "Relay readiness report returned.",
      evidence: {
        state: readiness.summary?.state ?? null,
        counts: readiness.counts ?? null,
      },
    });
  } catch (error) {
    addCheck({
      id: "relay-readiness-report",
      label: "Relay readiness report",
      status: "warn",
      detail: safeError(error),
    });
  }
  return readiness;
}

async function maybeRegisterEventSub() {
  if (!registerEventSub) {
    addSkipped(
      "eventsub-register",
      "Twitch EventSub registration",
      "Run with --register-eventsub to register the live subscription.",
    );
    return;
  }
  try {
    const result = await relayClient.registerEventSub();
    addCheck({
      id: "eventsub-register",
      label: "Twitch EventSub registration",
      status: result.ok ? "pass" : "fail",
      detail: result.ok
        ? "Relay accepted EventSub registration."
        : "Relay did not accept EventSub registration.",
      evidence: summarizeSubscription(result.subscription),
    });
    if (recordLocalState && result.ok) {
      markValidation("twitchEventSubRegisteredAt", {
        ok: true,
        detail: "registered",
      });
    }
  } catch (error) {
    addCheck({
      id: "eventsub-register",
      label: "Twitch EventSub registration",
      status: "fail",
      detail: safeError(error),
    });
  }
}

async function maybeSendRelayChat() {
  if (!sendChat) {
    addSkipped(
      "relay-chat-send",
      "Twitch Relay chat send",
      "Run with --send-chat to send a live Relay validation message.",
    );
    return;
  }
  const result = await relayClient.send(
    "vaexcore console live Relay validation check.",
    { idempotencyKey: `console-live-validation-${Date.now()}` },
  );
  const structured = typeof result === "string" ? { status: result } : result;
  addCheck({
    id: "relay-chat-send",
    label: "Twitch Relay chat send",
    status: structured.status === "sent" ? "pass" : "fail",
    detail:
      structured.status === "sent"
        ? "Relay sent a live Twitch chat validation message."
        : structured.reason || "Relay chat send failed.",
    evidence: {
      status: structured.status,
      failureCategory: structured.failureCategory ?? null,
    },
  });
  if (recordLocalState && structured.status === "sent") {
    markValidation("twitchRelayTestSendPassedAt", {
      ok: true,
      detail: "sent",
    });
  }
}

async function validateRelayChatEvents(
  readiness: RelayBotReadinessReport | null,
) {
  try {
    const events = await relayClient.events(5);
    const count =
      events.events.length || readiness?.counts?.queuedTwitchChatEvents || 0;
    addCheck({
      id: "relay-chat-events",
      label: "Twitch Relay chat intake",
      status: count > 0 ? "pass" : "warn",
      detail:
        count > 0
          ? `Relay has ${count} Twitch chat event(s) available for Console pickup.`
          : "No Relay Twitch chat events were available during validation.",
      evidence: {
        fetchedEvents: events.events.length,
        readinessCount: readiness?.counts?.queuedTwitchChatEvents ?? null,
      },
    });
  } catch (error) {
    addCheck({
      id: "relay-chat-events",
      label: "Twitch Relay chat intake",
      status: "warn",
      detail: safeError(error),
    });
  }
}

async function validateDiscordRelay() {
  try {
    const status = await discordRelayClient.status();
    const checksByKey = readinessKeyMap(status.readiness?.checks ?? []);
    addReadinessCheck(
      checksByKey,
      "discord-bot-token",
      "Discord bot token Worker secret",
    );
    addReadinessCheck(
      checksByKey,
      "discord-public-key",
      "Discord interaction public key",
    );
    addReadinessCheck(
      checksByKey,
      "discord-application-id",
      "Discord application ID",
    );
    addReadinessCheck(
      checksByKey,
      "discord-client-secret",
      "Discord client secret Worker secret",
    );
    addReadinessCheck(
      checksByKey,
      "discord-guild-id",
      "Discord hosted guild connection",
    );
    addReadinessCheck(
      checksByKey,
      "discord-interaction-url",
      "Discord interaction endpoint URL",
    );
    addReadinessCheck(
      checksByKey,
      "discord-command-registration",
      "Discord slash command registration",
    );
  } catch (error) {
    addCheck({
      id: "discord-relay-status",
      label: "Discord Relay status",
      status: "fail",
      detail: safeError(error),
    });
  }
}

async function maybeRegisterDiscordCommands() {
  if (!registerDiscordCommands) {
    addSkipped(
      "discord-command-register",
      "Discord slash command registration",
      "Run with --register-discord-commands to register live slash commands.",
    );
    return;
  }
  try {
    const result = await discordRelayClient.registerCommands();
    const missing = expectedDiscordCommands.filter(
      (command) => !result.commands.includes(command),
    );
    addCheck({
      id: "discord-command-register",
      label: "Discord slash command registration",
      status: missing.length === 0 ? "pass" : "fail",
      detail:
        missing.length === 0
          ? `Relay registered ${result.commands.length} Discord slash command(s).`
          : `Relay command registration missed: ${missing.join(", ")}.`,
      evidence: {
        scope: result.scope,
        registeredAt: result.registeredAt,
        commands: result.commands,
      },
    });
    if (recordLocalState && missing.length === 0) {
      markValidation("discordSlashCommandsRegisteredAt", {
        ok: true,
        detail: "registered",
      });
    }
  } catch (error) {
    addCheck({
      id: "discord-command-register",
      label: "Discord slash command registration",
      status: "fail",
      detail: safeError(error),
    });
  }
}

async function validateDiscordQueues() {
  let interactionObserved = false;
  try {
    const suggestions = await discordRelayClient.suggestions();
    interactionObserved = suggestions.suggestions.length > 0;
    addCheck({
      id: "discord-suggestion-queue",
      label: "Discord /suggest queue",
      status: suggestions.suggestions.length > 0 ? "pass" : "warn",
      detail:
        suggestions.suggestions.length > 0
          ? `${suggestions.suggestions.length} suggestion(s) are visible to Console.`
          : "No /suggest command output is visible yet.",
      evidence: { count: suggestions.suggestions.length },
    });
    if (recordLocalState && suggestions.suggestions.length > 0) {
      markValidation("discordSuggestCommandTestedAt", {
        ok: true,
        detail: "suggestions visible",
      });
    }
  } catch (error) {
    addCheck({
      id: "discord-suggestion-queue",
      label: "Discord /suggest queue",
      status: "warn",
      detail: safeError(error),
    });
  }

  try {
    const events = await discordRelayClient.events(25);
    const announcementCount = events.events.filter(
      (event) => event.kind === "announcement",
    ).length;
    interactionObserved ||= events.events.length > 0;
    addCheck({
      id: "discord-announcement-queue",
      label: "Discord announcement command queue",
      status: announcementCount > 0 ? "pass" : "warn",
      detail:
        announcementCount > 0
          ? `${announcementCount} announcement command event(s) are visible to Console.`
          : "No announcement command event is visible yet.",
      evidence: {
        totalEvents: events.events.length,
        announcementEvents: announcementCount,
      },
    });
    if (recordLocalState && announcementCount > 0) {
      markValidation("discordAnnouncementCommandTestedAt", {
        ok: true,
        detail: "announcement event visible",
      });
    }
  } catch (error) {
    addCheck({
      id: "discord-announcement-queue",
      label: "Discord announcement command queue",
      status: "warn",
      detail: safeError(error),
    });
  }

  if (recordLocalState && interactionObserved) {
    markValidation("discordInteractionEndpointAcceptedAt", {
      ok: true,
      detail: "interaction queue evidence present",
    });
  }
}

function finish() {
  const failed = checks.filter((check) => check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  const skipped = checks.filter((check) => check.status === "skipped").length;
  const passed = checks.filter((check) => check.status === "pass").length;
  const report: LiveValidationReport = {
    schemaVersion: 1,
    generatedAt: now,
    mode: {
      recordLocalState,
      setRelayTransport,
      registerEventSub,
      sendChat,
      registerDiscordCommands,
    },
    localConfig: {
      path: getLocalSecretsPath(),
      relayBaseUrl,
      productionTarget: relayBaseUrl === productionRelayUrl,
      installationSaved: Boolean(secrets.relay.installationId),
      consoleCredentialSaved: Boolean(secrets.relay.consoleToken),
      twitchTransportMode: secrets.relay.twitchTransportMode,
    },
    summary: {
      status:
        failed > 0 ? "failed" : warnings > 0 ? "pass-with-warnings" : "pass",
      passed,
      warnings,
      failed,
      skipped,
    },
    checks,
    artifacts: {
      json: artifactJsonPath,
      markdown: artifactMarkdownPath,
    },
  };
  writeArtifacts(report);
  printReport(report);
  process.exit(failed > 0 ? 1 : 0);
}

function addReadinessCheck(
  checksByKey: Map<string, { ok: boolean; detail: string }>,
  key: string,
  label: string,
) {
  const item = checksByKey.get(key);
  addCheck({
    id: key,
    label,
    status: item?.ok ? "pass" : "warn",
    detail: item?.detail ?? "Relay did not include this readiness check.",
  });
}

function readinessKeyMap(
  items: Array<{ key: string; ok: boolean; detail: string }>,
) {
  return new Map(items.map((item) => [item.key, item]));
}

function markValidation(
  key: keyof LocalSecrets["botValidation"],
  evidence: { ok: boolean; detail: string } | undefined,
) {
  if (!evidence?.ok) return;
  secrets = updateLocalSecrets((current) => ({
    ...current,
    botValidation: {
      ...current.botValidation,
      [key]: now,
    },
  }));
}

function updateLocalSecrets(
  updater: (current: LocalSecrets) => LocalSecrets,
): LocalSecrets {
  const next = updater(readLocalSecrets());
  writeLocalSecrets(next);
  return next;
}

function addSkipped(id: string, label: string, detail: string) {
  addCheck({ id, label, status: "skipped", detail });
}

function addCheck(check: LiveValidationCheck) {
  checks.push({ ...check, detail: redactText(check.detail) });
}

function summarizeSubscription(subscription: unknown) {
  if (!subscription || typeof subscription !== "object") return {};
  const record = subscription as Record<string, unknown>;
  return {
    id: typeof record.id === "string" ? record.id : undefined,
    status: typeof record.status === "string" ? record.status : undefined,
    type: typeof record.type === "string" ? record.type : undefined,
  };
}

function writeArtifacts(report: LiveValidationReport) {
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(
    artifactJsonPath,
    `${JSON.stringify(redact(report), null, 2)}\n`,
  );
  writeFileSync(artifactMarkdownPath, renderMarkdown(report));
}

function renderMarkdown(report: LiveValidationReport) {
  const lines = [
    "# Console/Relay Live Validation",
    "",
    `Generated: ${report.generatedAt}`,
    `Overall: ${report.summary.status}`,
    `Relay: ${report.localConfig.relayBaseUrl}`,
    "",
    "| Check | Status | Detail |",
    "| --- | --- | --- |",
  ];
  for (const check of report.checks) {
    lines.push(
      `| ${check.id} | ${check.status} | ${escapeTable(check.detail)} |`,
    );
  }
  lines.push(
    "",
    "The Twitch Chat Bot user-list confirmation is intentionally manual and is not recorded by this script.",
  );
  return `${lines.join("\n")}\n`;
}

function printReport(report: LiveValidationReport) {
  if (args.json) {
    console.log(JSON.stringify(redact(report), null, 2));
    return;
  }
  console.log("VaexCore Console/Relay live validation");
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Relay: ${report.localConfig.relayBaseUrl || "missing"}`);
  console.log(`Status: ${report.summary.status}`);
  console.log(
    `Artifacts: ${report.artifacts.json}, ${report.artifacts.markdown}`,
  );
  for (const check of report.checks) {
    console.log(
      `- ${check.status.toUpperCase()} ${check.label}: ${check.detail}`,
    );
  }
}

function safeError(error: unknown) {
  return redactText(error instanceof Error ? error.message : String(error));
}

function redactText(value: string) {
  const secretValues = [
    secrets.twitch.clientSecret,
    secrets.twitch.accessToken,
    secrets.twitch.refreshToken,
    secrets.discord.botToken,
    secrets.relay.consoleToken,
  ].filter((item): item is string => Boolean(item));
  let output = value;
  for (const secret of secretValues)
    output = output.replaceAll(secret, "[redacted]");
  return output
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /\b(token|secret|authorization|client_secret|code)(\s*[:=]\s*)[^\n,;]+/gi,
      "$1$2[redacted]",
    );
}

function redact(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /token|secret|authorization/i.test(key) ? "[redacted]" : redact(item),
      ]),
    );
  }
  return value;
}

function escapeTable(value: string) {
  return value.replaceAll("|", "\\|").replace(/\s+/g, " ");
}

function parseArgs(argv: string[]) {
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

async function traceStep<T>(label: string, action: () => Promise<T>) {
  trace(`begin ${label}`);
  const result = await action();
  trace(`end ${label}`);
  return result;
}

function trace(message: string) {
  if (debug) console.error(`[live-relay-validation] ${message}`);
}
