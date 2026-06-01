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
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  defaultRedirectUri,
  getLocalSecretsPath,
  readLocalSecrets,
  writeLocalSecrets,
  type LocalSecrets,
} from "../config/localSecrets";
import {
  getTokenExpiresAt,
  refreshStoredTwitchToken,
  type TwitchOAuthTokenResponse,
  validateStoredTwitchToken,
} from "../twitch/tokenManager";
import {
  validateSuiteDiscoveryDocument,
  type SuiteDiscoveryDocument,
  type SuiteLocalRuntime,
} from "../suite/discovery";
import { basename, dirname, join, resolve } from "node:path";
import { getBotProcessSnapshot } from "./serverBotProcess";
import { queueLaunchPreparation } from "./serverLaunchPreparation";
import {
  chatQueue,
  logger,
  suiteDiscoverySchemaVersion,
  vaexcoreSuiteAppDefinitions,
} from "./serverState";
import {
  readSuiteSessionDocument,
  suiteAppStatus,
  suiteDiscoveryDir,
} from "./serverSuite";

export const getTwitchStreamKey = async (): Promise<
  | {
      ok: true;
      streamKey: string;
      broadcasterLogin: string;
      broadcasterUserId: string;
    }
  | { ok: false; statusCode: number; error: string }
> => {
  const secrets = readLocalSecrets();
  const twitch = secrets.twitch;

  if (!twitch.clientId || !twitch.accessToken || !twitch.broadcasterUserId) {
    return {
      ok: false,
      statusCode: 409,
      error:
        "Console needs a connected Twitch account and resolved broadcaster identity first.",
    };
  }

  let validation: Awaited<ReturnType<typeof validateStoredTwitchToken>>;
  try {
    validation = await validateStoredTwitchToken({ secrets, logger });
  } catch (error) {
    return {
      ok: false,
      statusCode: 401,
      error: safeErrorMessage(
        error,
        "Twitch token validation failed. Reconnect Twitch in Console.",
      ),
    };
  }

  const activeTwitch = validation.twitch;
  const token = validation.token;
  const clientId = activeTwitch.clientId ?? twitch.clientId;
  const accessToken = activeTwitch.accessToken;
  const broadcasterUserId =
    activeTwitch.broadcasterUserId ?? twitch.broadcasterUserId;
  const broadcasterLogin =
    activeTwitch.broadcasterLogin ?? twitch.broadcasterLogin ?? token.login;

  if (!clientId || !accessToken || !broadcasterUserId) {
    return {
      ok: false,
      statusCode: 409,
      error:
        "Console is missing the active Twitch client, token, or broadcaster ID.",
    };
  }

  if (!token.scopes.includes("channel:read:stream_key")) {
    return {
      ok: false,
      statusCode: 403,
      error:
        "Reconnect Twitch in Console so it can request the channel:read:stream_key scope.",
    };
  }

  if (token.user_id !== broadcasterUserId) {
    return {
      ok: false,
      statusCode: 403,
      error:
        "Twitch only allows stream-key access when the OAuth token belongs to the broadcaster account. Reconnect Console as the broadcaster or make the bot login match the broadcaster.",
    };
  }

  const params = new URLSearchParams({ broadcaster_id: broadcasterUserId });
  const streamKeyResponse = await fetch(
    `https://api.twitch.tv/helix/streams/key?${params}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": clientId,
      },
    },
  );

  if (!streamKeyResponse.ok) {
    const body = await streamKeyResponse.text();
    return {
      ok: false,
      statusCode: streamKeyResponse.status,
      error: `Twitch stream key request failed: ${streamKeyResponse.status} ${body}`,
    };
  }

  const body = (await streamKeyResponse.json()) as {
    data?: Array<{ stream_key?: string }>;
  };
  const streamKey = body.data?.[0]?.stream_key;
  if (!streamKey) {
    return {
      ok: false,
      statusCode: 502,
      error: "Twitch did not return a stream key.",
    };
  }

  if (validation.refreshed) {
    void queueLaunchPreparation("token_refreshed");
  }

  appendSuiteTimelineEvent({
    sourceApp: "vaexcore-console",
    sourceAppName: "vaexcore console",
    kind: "twitch.stream_key",
    title: "Twitch stream key prepared",
    detail: `Console made ${broadcasterLogin}'s stream key available to Studio.`,
    metadata: {
      broadcasterLogin,
      broadcasterUserId,
    },
  });

  return {
    ok: true,
    streamKey,
    broadcasterLogin,
    broadcasterUserId,
  };
};

export const getPlatformStatus = () => {
  const twitch = readLocalSecrets().twitch;
  const broadcasterLogin = twitch.broadcasterLogin ?? "";

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    suiteSession: readSuiteSessionDocument(),
    twitch: {
      broadcasterLogin,
      channelUrl: broadcasterLogin
        ? `https://www.twitch.tv/${broadcasterLogin}`
        : null,
      embedReady: Boolean(broadcasterLogin),
    },
    console: {
      bot: getBotProcessSnapshot(),
      queue: chatQueue.snapshot(),
    },
    timeline: readSuiteTimelineEvents(50),
  };
};

export const buildPlatformPage = (
  status: ReturnType<typeof getPlatformStatus>,
) => {
  const channel = status.twitch.broadcasterLogin;
  const playerSrc = channel
    ? `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=localhost&parent=127.0.0.1&muted=false`
    : "";
  const chatSrc = channel
    ? `https://www.twitch.tv/embed/${encodeURIComponent(channel)}/chat?parent=localhost&parent=127.0.0.1`
    : "";
  const timelineRows = status.timeline
    .map(
      (item) => String.raw`<li>
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.detail)}</span>
        <time>${escapeHtml(formatPlatformTimestamp(item.createdAt))}</time>
      </li>`,
    )
    .join("");

  return String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>VaexCore Platform</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #080b16; color: #eff4ff; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; background: #080b16; }
      main { width: min(1480px, calc(100vw - 32px)); margin: 0 auto; padding: 24px 0 40px; }
      header { display: flex; align-items: end; justify-content: space-between; gap: 24px; padding: 4px 0 18px; border-bottom: 1px solid #26314d; }
      h1 { margin: 0; font-size: 28px; font-weight: 760; letter-spacing: 0; }
      p { margin: 6px 0 0; color: #aeb9d8; }
      .status { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
      .pill { border: 1px solid #334064; border-radius: 999px; padding: 6px 10px; color: #c9d4ef; background: #11172a; font-size: 13px; }
      .grid { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 18px; margin-top: 18px; align-items: start; }
      .frame, aside { border: 1px solid #26314d; background: #0d1224; border-radius: 8px; overflow: hidden; }
      .player { aspect-ratio: 16 / 9; width: 100%; min-height: 360px; }
      iframe { display: block; width: 100%; border: 0; background: #050710; }
      .chat { height: 560px; }
      aside { padding: 16px; }
      h2 { margin: 0 0 12px; font-size: 16px; letter-spacing: 0; }
      ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
      li { display: grid; gap: 4px; padding: 10px 0; border-bottom: 1px solid #202941; }
      li:last-child { border-bottom: 0; }
      strong { font-size: 14px; }
      span, time { color: #9faacf; font-size: 13px; line-height: 1.35; }
      .empty { display: grid; place-items: center; min-height: 360px; color: #aeb9d8; padding: 24px; text-align: center; }
      @media (max-width: 980px) {
        main { width: min(100vw - 20px, 720px); padding-top: 14px; }
        header { align-items: start; flex-direction: column; }
        .status { justify-content: flex-start; }
        .grid { grid-template-columns: 1fr; }
        .player { min-height: 300px; }
        .chat { height: 420px; }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>VaexCore Platform</h1>
          <p>${escapeHtml(channel ? `Live channel: ${channel}` : "Connect Twitch in Console to enable the live embed.")}</p>
        </div>
        <div class="status">
          <span class="pill">${escapeHtml(status.console.bot.status)}</span>
          <span class="pill">${escapeHtml(status.suiteSession?.title ?? "No suite session")}</span>
        </div>
      </header>
      <div class="grid">
        <section class="frame">
          ${
            channel
              ? `<iframe class="player" src="${escapeAttr(playerSrc)}" allowfullscreen></iframe><iframe class="chat" src="${escapeAttr(chatSrc)}"></iframe>`
              : `<div class="empty">Twitch broadcaster login is not configured.</div>`
          }
        </section>
        <aside>
          <h2>Suite Timeline</h2>
          ${timelineRows ? `<ul>${timelineRows}</ul>` : `<div class="empty">No shared suite activity yet.</div>`}
        </aside>
      </div>
    </main>
  </body>
</html>`;
};

export type SuiteTimelineEvent = {
  schemaVersion: number;
  eventId: string;
  sourceApp: string;
  sourceAppName: string;
  kind: string;
  title: string;
  detail: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type SuiteAppStatus = {
  appId: string;
  appName: string;
  launchName: string;
  bundleIdentifier: string;
  installed: boolean;
  running: boolean;
  reachable: boolean;
  stale: boolean;
  discoveryFile: string;
  pid: number | null;
  apiUrl: string | null;
  healthUrl: string | null;
  updatedAt: string | null;
  capabilities: string[];
  suiteSessionId: string | null;
  activity: string | null;
  activityDetail: string | null;
  localRuntime: SuiteLocalRuntime | null;
  detail: string;
};

export const appendSuiteTimelineEvent = (
  event: Omit<SuiteTimelineEvent, "schemaVersion" | "eventId" | "createdAt">,
) => {
  const directory = suiteDiscoveryDir();
  mkdirSync(directory, { recursive: true });
  const document: SuiteTimelineEvent = {
    schemaVersion: suiteDiscoverySchemaVersion,
    eventId: `console-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
    ...event,
  };
  appendFileSync(
    join(directory, "timeline.jsonl"),
    `${JSON.stringify(document)}\n`,
  );
};

export const getSuiteStatus = () => ({
  ok: true,
  generatedAt: new Date().toISOString(),
  protocol: {
    schemaVersion: suiteDiscoverySchemaVersion,
    directory: suiteDiscoveryDir(),
    sessionFile: join(suiteDiscoveryDir(), "session.json"),
    timelineFile: join(suiteDiscoveryDir(), "timeline.jsonl"),
  },
  session: readSuiteSessionDocument(),
  apps: vaexcoreSuiteAppDefinitions.map(suiteAppStatus),
  timeline: readSuiteTimelineEvents(50),
});

export const readSuiteTimelineEvents = (
  limit: number,
): SuiteTimelineEvent[] => {
  const path = join(suiteDiscoveryDir(), "timeline.jsonl");
  if (!existsSync(path)) {
    return [];
  }

  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as SuiteTimelineEvent;
      } catch {
        return null;
      }
    })
    .filter((item): item is SuiteTimelineEvent => Boolean(item))
    .slice(-limit)
    .reverse();
};

export const formatPlatformTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const escapeAttr = escapeHtml;
