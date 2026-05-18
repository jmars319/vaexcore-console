import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "vaexcore-bot-readiness-"));
const relayConsoleToken = "relay-console-secret";
const twitchClientSecret = "relay-client-secret";
const discordBotToken = "discord-bot-secret";
const relayInstallationId = "relay-installation-1";
const fakeRelay = await startFakeRelay();

try {
  writeFileSync(
    join(tempDir, "local.secrets.json"),
    `${JSON.stringify(
      {
        mode: "live",
        twitch: {
          clientId: "relay-client-id",
          clientSecret: twitchClientSecret,
          redirectUri: "http://localhost:3434/auth/twitch/callback",
          scopes: [],
        },
        discord: {
          botToken: discordBotToken,
          guildId: "discord-guild",
          createdChannelIds: {},
          createdRoleIds: {},
        },
        relay: {
          twitchTransportMode: "relay-chatbot",
          baseUrl: fakeRelay.url,
          installationId: relayInstallationId,
          consoleToken: relayConsoleToken,
        },
        botValidation: {},
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  const tsxBin = join(
    process.cwd(),
    "node_modules/.bin",
    process.platform === "win32" ? "tsx.cmd" : "tsx",
  );
  const output = await runBotReadiness(tsxBin, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      VAEXCORE_CONFIG_DIR: tempDir,
    },
  });

  assert.equal(output.includes(relayConsoleToken), false);
  assert.equal(output.includes(twitchClientSecret), false);
  assert.equal(output.includes(discordBotToken), false);
  assert.equal(output.includes("Bearer relay-console-secret"), false);
  assert.match(output, /This report is redacted/);
  console.log("bot readiness redaction smoke passed");
} finally {
  await fakeRelay.stop();
  rmSync(tempDir, { recursive: true, force: true });
}

async function startFakeRelay() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/health") {
      send(response, 200, {
        ok: true,
        service: `relay console token=${relayConsoleToken}`,
      });
      return;
    }

    if (request.headers.authorization !== `Bearer ${relayConsoleToken}`) {
      send(response, 401, {
        error: `authorization: Bearer ${relayConsoleToken}`,
      });
      return;
    }
    if (url.searchParams.get("installationId") !== relayInstallationId) {
      send(response, 404, { error: "Installation missing" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/console/status") {
      send(response, 200, relayStatus());
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/console/readiness-report"
    ) {
      send(response, 200, relayReadinessReport());
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/console/discord/status"
    ) {
      send(response, 200, {
        ok: true,
        readiness: {
          ready: false,
          mode: "relay-discord-interactions",
          interactionUrl: `${stateUrl(server)}/webhooks/discord/interactions`,
          checks: [
            {
              key: "discord-bot-token",
              ok: true,
              detail: `bot token: ${discordBotToken}`,
            },
            {
              key: "discord-command-registration",
              ok: false,
              detail: "Register Discord slash commands from Console.",
            },
          ],
        },
      });
      return;
    }

    send(response, 404, {
      error: `Unhandled ${request.method} ${url.pathname}`,
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    get url() {
      return stateUrl(server);
    },
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

function relayStatus() {
  return {
    ok: true,
    installation: {
      id: relayInstallationId,
      name: "VaexCore Console",
      botLogin: "vaexcorebot",
      broadcasterLogin: "vaexcore",
    },
    readiness: {
      ready: false,
      mode: "relay-chatbot",
      checks: [
        {
          key: "bot-grant",
          ok: true,
          detail: `client secret: ${twitchClientSecret}`,
        },
        {
          key: "broadcaster-grant",
          ok: true,
          detail: `authorization: Bearer ${relayConsoleToken}`,
        },
      ],
    },
  };
}

function relayReadinessReport() {
  return {
    ok: true,
    generatedAt: "2026-05-18T00:00:00.000Z",
    installation: relayStatus().installation,
    checks: [
      {
        key: "latest-eventsub-registration",
        ok: true,
        state: "ready",
        detail: `console token=${relayConsoleToken}`,
      },
      {
        key: "latest-outbound-send",
        ok: false,
        state: "todo",
        detail: "Send a Relay test message from Console.",
      },
    ],
    counts: {
      queuedTwitchChatEvents: 0,
      queuedDiscordInteractions: 0,
      outboundSends: { deadLettered: 0 },
    },
  };
}

function stateUrl(server) {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fake Relay server did not bind to a TCP port.");
  }
  return `http://127.0.0.1:${address.port}`;
}

function send(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function runBotReadiness(tsxBin, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(tsxBin, ["scripts/bot-readiness.ts"], options);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(`bot-readiness exited ${code}: ${stderr || stdout}`));
    });
  });
}
