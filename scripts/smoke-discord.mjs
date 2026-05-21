import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const tempDir = mkdtempSync(join(tmpdir(), "vaexcore-discord-smoke-"));
const smokeDbPath = join(tempDir, "data/vaexcore.sqlite");
const guildId = "123456789012345678";
const botToken = "smoke.discord.bot-token";
const botUserId = "999999999999999999";
const staffRoleId = "888888888888888888";

process.env.VAEXCORE_CONFIG_DIR = tempDir;
process.env.DATABASE_URL = `file:${smokeDbPath}`;

const fakeDiscord = await startFakeDiscord();
process.env.DISCORD_API_BASE_URL = `${fakeDiscord.url}/api/v10`;

const { startSetupServer } = await import(
  pathToFileURL(resolve("dist-bundle/setup-server.js")).href
);

const handle = await startSetupServer({ port: 3441 });
const baseUrl = handle.url;

try {
  await runSmoke();
  console.log("discord smoke passed");
} finally {
  await handle.stop();
  await fakeDiscord.stop();
  rmSync(tempDir, { recursive: true, force: true });
}

async function runSmoke() {
  const appJs = await text("/ui/app.js");
  assert(appJs.includes('["discord", "Discord"]'), "Discord tab is registered");
  assert(appJs.includes("Server Layout"), "Discord setup UI is present");
  assert(
    appJs.includes("Hosted Discord Connect"),
    "Hosted Discord connect UI is present",
  );
  assert(
    appJs.includes("Advanced Self-Hosted Discord Connection"),
    "Local bot token setup is kept behind Advanced self-hosted UI",
  );
  assert(
    appJs.includes("discordRelayInstallStart"),
    "Hosted Discord connect action is wired",
  );
  assert(
    appJs.includes("Layout preset"),
    "Discord layout preset picker is present",
  );
  assert(
    appJs.includes("Each preset is a server layout"),
    "Discord layout presets explain preview behavior",
  );
  assert(
    appJs.includes("Lock Staff category"),
    "Discord Staff privacy toggle is present",
  );
  assert(
    appJs.includes("Create preset roles"),
    "Discord preset role setup toggle is present",
  );
  assert(
    appJs.includes("Apply operations permission matrix"),
    "Discord operations permission toggle is present",
  );
  assert(
    appJs.includes("Post starter messages"),
    "Discord starter message toggle is present",
  );
  assert(appJs.includes("Staff role picker"), "Discord role picker is present");
  assert(
    appJs.includes("Load roles"),
    "Discord role loading action is present",
  );
  assert(
    appJs.includes("Required bot permissions for the full setup"),
    "Discord preview explains required bot permissions",
  );
  assert(
    appJs.includes("Stream Announcements"),
    "Discord announcement UI is present",
  );

  const cleanStatus = await json("/api/discord/status");
  assert(cleanStatus.ok === true, "Discord status returns ok on clean install");
  assert(
    cleanStatus.config.hasBotToken === false,
    "Discord status starts without a bot token",
  );
  assert(
    cleanStatus.readiness.ready === false,
    "Discord readiness starts blocked",
  );
  assert(
    cleanStatus.config.setupTemplate.name === "Full Creator Server",
    "Discord full setup template is surfaced by default",
  );
  assert(
    cleanStatus.config.setupTemplate.roleCount >= 13,
    "Discord full setup template exposes the full role hierarchy",
  );
  assert(
    cleanStatus.config.setupTemplate.starterMessageCount >= 8,
    "Discord full setup template exposes starter content",
  );
  assert(
    cleanStatus.config.setupTemplates.some(
      (template) => template.id === "streamer-community-baseline",
    ),
    "Discord baseline setup option is surfaced",
  );
  assert(
    cleanStatus.config.setupTemplates.some(
      (template) => template.id === "lean-live-alerts",
    ),
    "Discord lean setup option is surfaced",
  );

  const saved = await post("/api/discord/config", {
    botToken,
    guildId,
    setupTemplateId: "content-clips-hub",
  });
  assert(saved.ok === true, "Discord config save returns ok");
  assert(
    saved.config.hasBotToken === true,
    "Discord bot token is saved safely",
  );
  assert(saved.config.guildId === guildId, "Discord guild ID is saved");
  assert(
    saved.config.setupTemplateId === "content-clips-hub",
    "Discord setup template choice is saved",
  );
  assertSafePayload(saved);

  const validated = await json("/api/discord/status?validate=1");
  assert(validated.bot?.username === "VaexCore Test Bot", "bot validates");

  const roles = await json("/api/discord/roles");
  assert(roles.connected === true, "Discord roles route connects");
  assert(
    roles.roles.some(
      (role) => role.id === staffRoleId && role.staffEligible === true,
    ),
    "Discord roles route returns selectable Staff roles",
  );
  assertSafePayload(roles);

  const leanPreview = await post("/api/discord/setup/preview", {
    templateId: "lean-live-alerts",
    includeRoles: true,
  });
  assert(
    leanPreview.plan.template.name === "Lean Live Alerts",
    "alternate Discord setup preset can be previewed",
  );
  assert(
    leanPreview.plan.summary.channelsToCreate >= 8,
    "lean setup preset plans a compact server layout",
  );

  const preview = await post("/api/discord/setup/preview", {
    templateId: "full-creator-community",
    includeRoles: true,
    applyPermissions: true,
    postStarterMessages: true,
  });
  assert(preview.connected === true, "setup preview connects to Discord");
  assert(
    preview.plan.summary.channelsToCreate >= 17,
    "setup preview plans streamer text and voice channels",
  );
  assert(
    preview.plan.summary.rolesToCreate >= 13,
    "setup preview plans the full operations role hierarchy",
  );
  assert(
    preview.plan.summary.permissionOverwrites >= 60,
    "setup preview plans the operations permission matrix",
  );
  assert(
    preview.plan.summary.starterMessagesToPost >= 8,
    "setup preview plans starter messages",
  );
  assert(
    preview.plan.actions.some(
      (action) =>
        action.type === "post_starter_message" &&
        action.detail.includes("Welcome to the server"),
    ),
    "setup preview shows exact starter message copy",
  );
  assert(
    preview.plan.summary.existingChannels >= 4,
    "setup preview reuses existing Vaexil-style channels",
  );
  assert(
    preview.plan.actions.some(
      (action) =>
        action.type === "use_existing_channel" &&
        [
          "general",
          "announcements",
          "clips-and-highlights",
          "Lobby",
          "Gaming",
        ].includes(action.name),
    ),
    "setup preview shows existing baseline channels are reused",
  );

  const blockedPrivacy = await post("/api/discord/setup/preview", {
    templateId: "full-creator-community",
    includeRoles: true,
    applyPermissions: false,
    lockStaffCategory: true,
  });
  assert(
    blockedPrivacy.plan.summary.blockedPermissions === 1,
    "Staff privacy preview is blocked without a Staff role ID",
  );

  const savedStaff = await post("/api/discord/config", {
    staffRoleId,
    lockStaffCategory: true,
  });
  assert(
    savedStaff.config.staffRoleId === staffRoleId,
    "Discord Staff role ID is saved",
  );

  const privacyPreview = await post("/api/discord/setup/preview", {
    templateId: "full-creator-community",
    includeRoles: true,
    applyPermissions: false,
    lockStaffCategory: true,
    staffRoleId,
  });
  assert(
    privacyPreview.plan.summary.permissionOverwrites === 1,
    "Staff privacy preview plans a permission overwrite action",
  );

  const applied = await post("/api/discord/setup/apply", {
    templateId: "full-creator-community",
    includeRoles: true,
    applyPermissions: true,
    postStarterMessages: true,
    lockStaffCategory: false,
  });
  assert(applied.ok === true, "Discord setup apply returns ok");
  assert(
    applied.createdChannels.length ===
      privacyPreview.plan.summary.channelsToCreate,
    "Discord setup creates planned channels",
  );
  assert(
    applied.createdRoles.length >= 13,
    "Discord setup creates the full operations role hierarchy",
  );
  assert(
    fakeDiscord.roles.some((role) => role.name === "VaexCore Operator"),
    "Discord setup creates the VaexCore Operator role",
  );
  assert(
    fakeDiscord.roles.some((role) => role.name === "Muted"),
    "Discord setup creates the Muted role",
  );
  assert(
    fakeDiscord.roles
      .filter((role) => role.id !== guildId && !role.managed)
      .every((role) => !["2", "4", "8", "32"].includes(role.permissions)),
    "Discord setup does not grant unsafe role permissions",
  );
  assert(
    applied.permissionOverwritesApplied ===
      preview.plan.summary.permissionOverwrites,
    `Discord setup applies the planned operations permission overwrites (${applied.permissionOverwritesApplied} applied, ${preview.plan.summary.permissionOverwrites} previewed)`,
  );
  assert(
    fakeDiscord.plannedPermissionOverwrites.length ===
      applied.permissionOverwritesApplied,
    "fake Discord stores deterministic permission overwrites",
  );
  assert(
    fakeDiscord.permissionOverwrites.some(
      (overwrite) =>
        overwrite.path.endsWith(`/permissions/${botUserId}`) &&
        overwrite.body.type === 1,
    ),
    "Discord setup preserves bot access with a member permission overwrite",
  );
  assert(
    applied.starterMessagesPosted >= 8,
    "Discord setup posts starter messages",
  );
  assert(
    applied.createdMessageIds.welcome && applied.createdMessageIds.rules,
    "Discord setup records starter message IDs",
  );
  assert(
    fakeDiscord.messages.some((message) =>
      message.content.includes("Welcome to the server"),
    ),
    "fake Discord received starter message content",
  );
  assert(
    applied.config.streamAnnouncementChannelId,
    "Discord setup stores stream announcement channel",
  );
  assert(
    applied.config.operatorRoleId,
    "Discord setup stores the operator role ID",
  );
  assert(
    fakeDiscord.channels.some((channel) => channel.name === "live-now"),
    "fake Discord received live-now channel create",
  );
  assert(
    fakeDiscord.channels.some((channel) => channel.type === 2),
    "fake Discord received voice channel create",
  );

  const idempotent = await post("/api/discord/setup/apply", {
    templateId: "full-creator-community",
    includeRoles: true,
    applyPermissions: true,
    postStarterMessages: true,
    lockStaffCategory: false,
  });
  assert(
    idempotent.createdChannels.length === 0,
    "Discord setup is idempotent for channels",
  );
  assert(
    idempotent.createdRoles.length === 0,
    "Discord setup is idempotent for roles",
  );
  assert(
    idempotent.starterMessagesPosted === 0,
    "Discord setup is idempotent for starter messages",
  );
  assert(
    idempotent.permissionOverwritesApplied === 0,
    "Discord setup skips already matching permission overwrites",
  );
  assert(
    idempotent.plan.summary.starterMessagesSkipped >= 8,
    "Discord setup preview skips previously posted starter messages",
  );
  assert(
    fakeDiscord.plannedPermissionOverwrites.length ===
      applied.permissionOverwritesApplied,
    "Discord setup updates permission overwrites without duplicating them",
  );

  const live = await post("/api/discord/announce", {
    kind: "live",
    title: "We are live",
    detail: "Smoke test stream start.",
    streamUrl: "https://www.twitch.tv/vaexcore",
  });
  assert(live.ok === true, "live announcement sends");
  assert(live.messageId, "live announcement returns message ID");
  const liveMessage = fakeDiscord.messages.find(
    (message) => message.id === live.messageId,
  );
  assert(
    liveMessage?.content.includes("<@&"),
    "live announcement mentions the Stream Alerts role",
  );
  assertSafePayload(live);

  const late = await post("/api/discord/announce", {
    kind: "late",
    title: "Running late",
    detail: "Smoke test late notice.",
    mentionRole: false,
  });
  assert(late.ok === true, "late announcement sends");
  const lateMessage = fakeDiscord.messages.find(
    (message) => message.id === late.messageId,
  );
  assert(
    !lateMessage?.content.includes("<@&"),
    "late announcement does not mention role when disabled",
  );
}

async function startFakeDiscord() {
  const state = {
    nextId: 200000000000000000n,
    channels: [
      {
        id: "111111111111111111",
        name: "general",
        type: 0,
        parent_id: null,
        topic: null,
        position: 0,
        permission_overwrites: [],
      },
      {
        id: "111111111111111112",
        name: "announcements",
        type: 5,
        parent_id: null,
        topic: null,
        position: 1,
        permission_overwrites: [],
      },
      {
        id: "111111111111111115",
        name: "clips-and-highlights",
        type: 0,
        parent_id: null,
        topic: null,
        position: 2,
        permission_overwrites: [],
      },
      {
        id: "111111111111111113",
        name: "Lobby",
        type: 2,
        parent_id: null,
        topic: null,
        position: 3,
        permission_overwrites: [],
      },
      {
        id: "111111111111111114",
        name: "Gaming",
        type: 2,
        parent_id: null,
        topic: null,
        position: 4,
        permission_overwrites: [],
      },
    ],
    roles: [
      { id: guildId, name: "@everyone", managed: false },
      {
        id: staffRoleId,
        name: "Moderators",
        managed: false,
        mentionable: false,
      },
      {
        id: "777777777777777777",
        name: "Managed Integration",
        managed: true,
      },
    ],
    messages: [],
    permissionOverwrites: [],
  };

  const server = createServer(async (request, response) => {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );

    if (request.headers.authorization !== `Bot ${botToken}`) {
      send(response, 401, { message: "Unauthorized" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v10/users/@me") {
      send(response, 200, {
        id: botUserId,
        username: "vaexcore-test-bot",
        global_name: "VaexCore Test Bot",
      });
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === `/api/v10/guilds/${guildId}/channels`
    ) {
      send(response, 200, state.channels);
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === `/api/v10/guilds/${guildId}/roles`
    ) {
      send(response, 200, state.roles);
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === `/api/v10/guilds/${guildId}/roles`
    ) {
      const body = await readBody(request);
      const role = {
        id: nextId(state),
        name: body.name,
        permissions: body.permissions ?? "0",
        color: body.color ?? 0,
        hoist: Boolean(body.hoist),
        managed: false,
        mentionable: Boolean(body.mentionable),
      };
      state.roles.push(role);
      send(response, 200, role);
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === `/api/v10/guilds/${guildId}/channels`
    ) {
      const body = await readBody(request);
      const channel = {
        id: nextId(state),
        name: body.name,
        type: body.type,
        parent_id: body.parent_id ?? null,
        topic: body.topic ?? null,
        position: state.channels.length,
        permission_overwrites: body.permission_overwrites ?? [],
      };
      state.channels.push(channel);
      send(response, 200, channel);
      return;
    }

    if (
      request.method === "PUT" &&
      /^\/api\/v10\/channels\/\d+\/permissions\/\d+$/.test(url.pathname)
    ) {
      const body = await readBody(request);
      const overwriteId = url.pathname.split("/").at(-1);
      if (
        body.type === 0 &&
        !state.roles.some((role) => role.id === overwriteId)
      ) {
        send(response, 404, { message: "Unknown Overwrite", code: 10009 });
        return;
      }
      if (body.type === 1 && overwriteId !== botUserId) {
        send(response, 404, { message: "Unknown Member", code: 10007 });
        return;
      }
      const overwrite = {
        path: url.pathname,
        body,
      };
      const existingIndex = state.permissionOverwrites.findIndex(
        (item) => item.path === overwrite.path,
      );
      if (existingIndex >= 0) {
        state.permissionOverwrites[existingIndex] = overwrite;
      } else {
        state.permissionOverwrites.push(overwrite);
      }
      const channelId = url.pathname.split("/").at(-3);
      const channel = state.channels.find((item) => item.id === channelId);
      if (channel) {
        const channelOverwrites = channel.permission_overwrites ?? [];
        const channelOverwrite = {
          id: overwriteId,
          type: body.type,
          allow: body.allow ?? "0",
          deny: body.deny ?? "0",
        };
        const channelOverwriteIndex = channelOverwrites.findIndex(
          (item) => item.id === overwriteId,
        );
        if (channelOverwriteIndex >= 0) {
          channelOverwrites[channelOverwriteIndex] = channelOverwrite;
        } else {
          channelOverwrites.push(channelOverwrite);
        }
        channel.permission_overwrites = channelOverwrites;
      }
      send(response, 204, {});
      return;
    }

    if (
      request.method === "POST" &&
      /^\/api\/v10\/channels\/\d+\/messages$/.test(url.pathname)
    ) {
      const channelId = url.pathname.split("/").at(-2);
      const body = await readBody(request);
      const message = {
        id: nextId(state),
        channel_id: channelId,
        content: body.content ?? "",
        embeds: body.embeds ?? [],
        allowed_mentions: body.allowed_mentions ?? {},
        timestamp: new Date().toISOString(),
      };
      state.messages.push(message);
      send(response, 200, message);
      return;
    }

    send(response, 404, {
      message: `Unhandled ${request.method} ${url.pathname}`,
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fake Discord server did not bind to a TCP port.");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    get channels() {
      return state.channels;
    },
    get roles() {
      return state.roles;
    },
    get messages() {
      return state.messages;
    },
    get permissionOverwrites() {
      return state.permissionOverwrites;
    },
    get plannedPermissionOverwrites() {
      return state.permissionOverwrites.filter(
        (overwrite) => overwrite.body.type === 0,
      );
    },
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

function nextId(state) {
  state.nextId += 1n;
  return state.nextId.toString();
}

async function json(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      `${options.method || "GET"} ${path} failed ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

async function text(path) {
  const response = await fetch(`${baseUrl}${path}`);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${path} failed ${response.status}: ${body}`);
  }
  return body;
}

function post(path, body) {
  return json(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertSafePayload(value) {
  const text = JSON.stringify(value);
  assert(!text.includes(botToken), "payload must not expose Discord bot token");
}
