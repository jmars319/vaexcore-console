import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setupUiJavaScriptSource } from "./support/setup-ui-source.mjs";

const tempDir = mkdtempSync(join(tmpdir(), "vaexcore-twitch-ops-smoke-"));
const smokeDbPath = join(tempDir, "data/vaexcore.sqlite");
const accessToken = "twitch-creator-ops-access-token";

process.env.VAEXCORE_CONFIG_DIR = tempDir;
process.env.DATABASE_URL = `file:${smokeDbPath}`;

writeLocalSecrets();
const fakeTwitch = await startFakeTwitch();
process.env.TWITCH_API_BASE_URL = fakeTwitch.url;

const { startSetupServer } = await import(
  pathToFileURL(resolve("dist-bundle/setup-server.js")).href
);

const handle = await startSetupServer({ port: 3443 });
const baseUrl = handle.url;

try {
  await runSmoke();
  console.log("twitch creator ops smoke passed");
} finally {
  await handle.stop();
  await fakeTwitch.stop();
  rmSync(tempDir, { recursive: true, force: true });
}

async function runSmoke() {
  const appJs = await setupUiJavaScriptSource(text);
  assert(appJs.includes('["twitch-ops", "Twitch Ops"]'), "tab is registered");
  assert(appJs.includes("Start raid"), "raid control is present");
  assert(appJs.includes("Guarded live controls"), "guarded UI copy is present");

  const state = await json("/api/twitch/creator-ops");
  assert(state.ok === true, "creator ops state returns ok");
  assert(state.readiness.ready === true, "creator ops readiness is complete");
  assertSafePayload(state);

  const blocked = await post("/api/twitch/creator-ops/announcement", {
    message: "blocked",
  });
  assert(blocked.ok === false, "live action requires confirmation");

  await expectOk("/api/twitch/creator-ops/poll", {
    title: "Smoke poll",
    choices: "One\nTwo",
    durationSeconds: 120,
    confirmed: true,
  });
  await expectOk("/api/twitch/creator-ops/poll/end", {
    id: "poll-1",
    status: "TERMINATED",
    confirmed: true,
  });
  await expectOk("/api/twitch/creator-ops/prediction", {
    title: "Smoke prediction",
    outcomes: "Win\nLose",
    predictionWindowSeconds: 120,
    confirmed: true,
  });
  await expectOk("/api/twitch/creator-ops/prediction/end", {
    id: "prediction-1",
    status: "RESOLVED",
    winningOutcomeId: "outcome-1",
    confirmed: true,
  });
  await expectOk("/api/twitch/creator-ops/announcement", {
    message: "Smoke announcement",
    color: "purple",
    confirmed: true,
  });
  await expectOk("/api/twitch/creator-ops/shoutout", {
    targetLogin: "target_channel",
    confirmed: true,
  });
  await expectOk("/api/twitch/creator-ops/raid", {
    targetLogin: "target_channel",
    confirmed: true,
  });
  await expectOk("/api/twitch/creator-ops/raid/cancel", {
    confirmed: true,
  });

  assert(
    fakeTwitch.requests.some(
      (request) =>
        request.method === "POST" && request.pathname === "/helix/polls",
    ),
    "fake Twitch received create poll",
  );
  assert(
    fakeTwitch.requests.some(
      (request) =>
        request.method === "POST" &&
        request.pathname === "/helix/chat/shoutouts",
    ),
    "fake Twitch received shoutout",
  );
  assert(
    fakeTwitch.requests.every(
      (request) => request.authorization === `Bearer ${accessToken}`,
    ),
    "Twitch requests use stored OAuth token",
  );

  const after = await json("/api/twitch/creator-ops");
  assert(after.logs.length >= 7, "creator ops actions are audited");
  assertSafePayload(after);
}

async function expectOk(path, body) {
  const response = await post(path, body);
  assert(response.ok === true, `${path} returns ok`);
  assertSafePayload(response);
  return response;
}

async function startFakeTwitch() {
  const requests = [];
  const server = createServer(async (request, response) => {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );
    const body = await readBody(request);
    requests.push({
      method: request.method,
      pathname: url.pathname,
      search: url.search,
      authorization: request.headers.authorization,
      body,
    });

    if (request.headers.authorization !== `Bearer ${accessToken}`) {
      send(response, 401, { message: "unauthorized" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/helix/users") {
      send(response, 200, {
        data: [
          {
            id: "target-user-id",
            login: url.searchParams.get("login") ?? "target_channel",
            display_name: "Target Channel",
          },
        ],
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/helix/polls") {
      send(response, 200, {
        data: [{ id: "poll-1", status: "ACTIVE", title: body.title }],
      });
      return;
    }

    if (request.method === "PATCH" && url.pathname === "/helix/polls") {
      send(response, 200, {
        data: [
          {
            id: url.searchParams.get("id"),
            status: url.searchParams.get("status"),
          },
        ],
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/helix/predictions") {
      send(response, 200, {
        data: [{ id: "prediction-1", status: "ACTIVE", title: body.title }],
      });
      return;
    }

    if (request.method === "PATCH" && url.pathname === "/helix/predictions") {
      send(response, 200, {
        data: [
          {
            id: url.searchParams.get("id"),
            status: url.searchParams.get("status"),
            winning_outcome_id: url.searchParams.get("winning_outcome_id"),
          },
        ],
      });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/helix/chat/announcements"
    ) {
      send(response, 204);
      return;
    }

    if (request.method === "POST" && url.pathname === "/helix/chat/shoutouts") {
      send(response, 204);
      return;
    }

    if (request.method === "POST" && url.pathname === "/helix/raids") {
      send(response, 200, { data: [{ created_at: new Date().toISOString() }] });
      return;
    }

    if (request.method === "DELETE" && url.pathname === "/helix/raids") {
      send(response, 204);
      return;
    }

    send(response, 404, { message: "not found" });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  return {
    requests,
    url: `http://127.0.0.1:${address.port}`,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

function writeLocalSecrets() {
  const path = join(tempDir, "local.secrets.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        mode: "live",
        twitch: {
          clientId: "creator-ops-client-id",
          clientSecret: "creator-ops-client-secret",
          redirectUri: "http://localhost:3434/auth/twitch/callback",
          broadcasterLogin: "vaexcore",
          broadcasterUserId: "broadcaster-user-id",
          botLogin: "vaexcorebot",
          botUserId: "bot-user-id",
          accessToken,
          refreshToken: "creator-ops-refresh-token",
          scopes: [
            "user:read:chat",
            "user:write:chat",
            "channel:read:stream_key",
            "moderator:manage:chat_messages",
            "moderator:manage:banned_users",
            "channel:manage:polls",
            "channel:manage:predictions",
            "channel:manage:raids",
            "moderator:manage:announcements",
            "moderator:manage:shoutouts",
          ],
        },
        discord: { createdChannelIds: {}, createdRoleIds: {} },
        relay: { twitchTransportMode: "local-user-token" },
      },
      null,
      2,
    )}\n`,
  );
}

async function text(path) {
  const response = await fetch(`${baseUrl}${path}`);
  assert(response.ok, `${path} returned ${response.status}`);
  return response.text();
}

async function json(path) {
  const response = await fetch(`${baseUrl}${path}`);
  assert(response.ok, `${path} returned ${response.status}`);
  return response.json();
}

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert(response.ok, `${path} returned ${response.status}`);
  return response.json();
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function send(response, status, body) {
  response.statusCode = status;
  if (body === undefined) {
    response.end();
    return;
  }
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

function assertSafePayload(payload) {
  const raw = JSON.stringify(payload);
  assert(!raw.includes(accessToken), "access token is not exposed");
  assert(!raw.includes("creator-ops-client-secret"), "client secret is safe");
  assert(!raw.includes("creator-ops-refresh-token"), "refresh token is safe");
  assert(!raw.includes("Bearer "), "bearer tokens are not exposed");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Smoke failed: ${message}`);
  }
}
