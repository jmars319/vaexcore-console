import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "vaexcore-live-relay-validation-"));
const artifactDir = join(tempDir, "artifacts");
const configDir = join(tempDir, "config");
const relayInstallationId = "relay-installation-1";
const relayConsoleToken = "relay-console-token";

const fakeRelay = await startFakeRelay();

try {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "local.secrets.json"),
    `${JSON.stringify(
      {
        mode: "live",
        setupMode: "relay-assisted",
        twitch: {
          redirectUri: "http://localhost:3434/auth/twitch/callback",
          broadcasterLogin: "vaexil",
          botLogin: "vaexcorebot",
          scopes: [],
        },
        discord: {
          lockStaffCategory: false,
          createdChannelIds: {},
          createdRoleIds: {},
          createdMessageIds: {},
        },
        relay: {
          twitchTransportMode: "local-user-token",
          baseUrl: fakeRelay.url,
          installationId: relayInstallationId,
          consoleToken: relayConsoleToken,
        },
        setupChecks: { local: {}, relay: {} },
        botValidation: {},
      },
      null,
      2,
    )}\n`,
  );

  const result = await runValidationChild(
    process.platform === "win32"
      ? resolve("node_modules/.bin/tsx.cmd")
      : resolve("node_modules/.bin/tsx"),
    [
      "scripts/live-relay-validation.ts",
      "--record",
      "--set-relay-transport",
      "--register-eventsub",
      "--send-chat",
      "--register-discord-commands",
      "--artifact-dir",
      artifactDir,
      "--json",
      "--debug",
    ],
    {
      VAEXCORE_CONFIG_DIR: configDir,
    },
  );

  assert.equal(
    result.code,
    0,
    [
      result.error,
      result.stderr ? `stderr:\n${result.stderr}` : "",
      result.stdout ? `stdout:\n${result.stdout}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
  const report = JSON.parse(result.stdout);
  assert.equal(report.summary.status, "pass");
  assert.equal(
    report.checks.find((check) => check.id === "relay-chat-send")?.status,
    "pass",
  );
  assert.equal(
    report.checks.find((check) => check.id === "discord-command-register")
      ?.status,
    "pass",
  );
  assert.equal(fakeRelay.eventSubRegistrations, 1);
  assert.equal(fakeRelay.chatSends, 1);
  assert.equal(fakeRelay.commandRegistrations, 1);

  const saved = JSON.parse(
    readFileSync(join(configDir, "local.secrets.json"), "utf8"),
  );
  assert.equal(saved.relay.twitchTransportMode, "relay-chatbot");
  assert.ok(saved.botValidation.twitchBotOAuthCompletedAt);
  assert.ok(saved.botValidation.twitchBroadcasterOAuthCompletedAt);
  assert.ok(saved.botValidation.twitchEventSubRegisteredAt);
  assert.ok(saved.botValidation.twitchRelayTestSendPassedAt);
  assert.ok(saved.botValidation.discordSlashCommandsRegisteredAt);
  assert.ok(saved.botValidation.discordSuggestCommandTestedAt);
  assert.ok(saved.botValidation.discordAnnouncementCommandTestedAt);
  assert.equal(saved.botValidation.twitchChatBotUserListConfirmedAt, undefined);
  assert.ok(
    readFileSync(join(artifactDir, "latest.md"), "utf8").includes(
      "Console/Relay Live Validation",
    ),
  );
  console.log("live relay validation smoke passed");
} finally {
  await fakeRelay.stop();
  rmSync(tempDir, { recursive: true, force: true });
}

async function startFakeRelay() {
  let eventSubRegistrations = 0;
  let chatSends = 0;
  let commandRegistrations = 0;
  const server = createServer(async (request, response) => {
    request.resume();
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/health") {
      send(response, 200, {
        ok: true,
        service: "fake vaexcore relay",
        capabilities: ["twitch.app-token-chat", "discord.command-registration"],
      });
      return;
    }

    if (!authorized(request, url)) {
      send(response, 401, { error: "Unauthorized" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/console/status") {
      send(response, 200, {
        ok: true,
        installation: {
          id: relayInstallationId,
          name: "VaexCore Console",
          botLogin: "vaexcorebot",
          broadcasterLogin: "vaexil",
        },
        readiness: {
          ready: true,
          mode: "relay-chatbot",
          checks: [
            readiness("bot-grant", "Bot grant stored for vaexcorebot."),
            readiness(
              "broadcaster-grant",
              "Broadcaster grant stored for vaexil.",
            ),
            readiness(
              "separate-bot-account",
              "Bot and broadcaster are separate.",
            ),
          ],
        },
      });
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/console/readiness-report"
    ) {
      send(response, 200, {
        ok: true,
        summary: {
          state: "ready",
          detail: "Fake Relay readiness is complete.",
          readyCount: 3,
          todoCount: 0,
          degradedCount: 0,
          blockedCount: 0,
        },
        counts: {
          queuedTwitchChatEvents: 1,
          queuedDiscordInteractions: 2,
          outboundSends: { deadLettered: 0 },
        },
      });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/console/eventsub/register"
    ) {
      eventSubRegistrations += 1;
      send(response, 200, {
        ok: true,
        subscription: {
          id: "subscription-1",
          status: "created",
          type: "channel.chat.message",
        },
      });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/console/chat/send"
    ) {
      chatSends += 1;
      send(response, 200, { ok: true, messageId: "message-1" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/console/events") {
      send(response, 200, {
        ok: true,
        events: [
          {
            relayEventId: "event-1",
            id: "chat-1",
            text: "!ping",
            userId: "viewer-1",
            userLogin: "viewer",
            userDisplayName: "Viewer",
            broadcasterUserId: "broadcaster-1",
            badges: [],
            isBroadcaster: false,
            isMod: false,
            isVip: false,
            isSubscriber: false,
            source: "relay-eventsub",
            receivedAt: new Date().toISOString(),
          },
        ],
      });
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/console/discord/status"
    ) {
      send(response, 200, {
        ok: true,
        readiness: {
          ready: true,
          mode: "relay-discord-interactions",
          interactionUrl: `${serverUrl(server)}/webhooks/discord/interactions`,
          checks: [
            readiness("discord-bot-token", "Discord bot token is configured."),
            readiness(
              "discord-public-key",
              "Discord public key is configured.",
            ),
            readiness(
              "discord-application-id",
              "Discord app ID is configured.",
            ),
            readiness(
              "discord-client-secret",
              "Discord client secret is configured.",
            ),
            readiness("discord-guild-id", "Discord guild is connected."),
            readiness(
              "discord-interaction-url",
              "Discord interaction URL is set.",
            ),
            readiness(
              "discord-command-registration",
              "Slash commands are registered.",
            ),
          ],
        },
      });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/console/discord/commands/register"
    ) {
      commandRegistrations += 1;
      send(response, 200, {
        ok: true,
        scope: "guild",
        registeredAt: new Date().toISOString(),
        commands: [
          "suggest",
          "live",
          "late",
          "cancelled",
          "scheduled",
          "setup-status",
        ],
      });
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/console/discord/suggestions"
    ) {
      send(response, 200, {
        ok: true,
        suggestions: [
          {
            id: "suggestion-1",
            userId: "discord-user-1",
            username: "Viewer",
            text: "Add more clips.",
            status: "new",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      });
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/console/discord/events"
    ) {
      send(response, 200, {
        ok: true,
        events: [
          {
            relayEventId: "event-live-1",
            id: "interaction-live-1",
            commandName: "live",
            kind: "announcement",
            userId: "discord-user-1",
            username: "Operator",
            guildId: "guild-1",
            channelId: "channel-1",
            options: { title: "Live now" },
            allowed: true,
            receivedAt: new Date().toISOString(),
          },
        ],
      });
      return;
    }

    send(response, 404, { error: "Not found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: serverUrl(server),
    get eventSubRegistrations() {
      return eventSubRegistrations;
    },
    get chatSends() {
      return chatSends;
    },
    get commandRegistrations() {
      return commandRegistrations;
    },
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

function authorized(request, url) {
  return (
    request.headers.authorization === `Bearer ${relayConsoleToken}` &&
    url.searchParams.get("installationId") === relayInstallationId
  );
}

function readiness(key, detail) {
  return { key, ok: true, detail };
}

function send(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function serverUrl(server) {
  const address = server.address();
  assert(typeof address === "object" && address);
  return `http://127.0.0.1:${address.port}`;
}

function runValidationChild(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve({
        code: 124,
        stdout,
        stderr,
        error: "live validation child timed out",
      });
    }, 15_000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code: 1, stdout, stderr, error: error.message });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code, stdout, stderr, error: "" });
    });
  });
}
