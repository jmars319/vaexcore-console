import type { ChatMessage } from "../core/chatMessage";
import type {
  MessageSendFailureCategory,
  MessageSendResult,
} from "../core/messageQueue";
import type { Logger } from "../core/logger";

export type RelayTransportConfig = {
  baseUrl?: string;
  installationId?: string;
  consoleToken?: string;
};

export type RelayHostedInstallStartResponse = {
  ok: boolean;
  installationId: string;
  consoleToken: string;
  next?: {
    twitchCallbackUrl?: string;
    botOAuthUrl?: string;
    broadcasterOAuthUrl?: string;
    twitchEventSubWebhookUrl?: string;
    discordInteractionUrl?: string;
  };
};

export type RelayStatus = {
  ok: boolean;
  installation?: {
    id: string;
    name: string;
    botLogin: string;
    broadcasterLogin: string;
  };
  readiness?: {
    ready: boolean;
    mode: "relay-chatbot";
    checks: Array<{ key: string; ok: boolean; detail: string }>;
  };
};

export type RelayBotReadinessReport = {
  ok: boolean;
  generatedAt: string;
  summary?: {
    state: "ready" | "app-check-available" | "degraded" | "failed";
    detail: string;
    lastCheckedAt: string;
    readyCount: number;
    todoCount: number;
    degradedCount: number;
    blockedCount: number;
  };
  codeReadiness?: {
    state?: "ready" | "degraded" | "blocked";
    detail?: string;
    lastCheckedAt?: string;
    schemaReady?: boolean;
    queueReady?: boolean;
    retryReady?: boolean;
    deadLetterReady?: boolean;
    eventSubFresh?: boolean;
    discordCommandsFresh?: boolean;
    queueAges?: {
      twitchChatOldestAgeMs?: number | null;
      discordInteractionOldestAgeMs?: number | null;
      outboundRetryOldestAgeMs?: number | null;
    };
    latestRecordMetadata?: Record<string, unknown>;
  };
  installation?: {
    id: string;
    name: string;
    botLogin: string;
    broadcasterLogin: string;
  };
  urls?: Record<string, string>;
  checks?: Array<{
    key: string;
    ok: boolean;
    state?: "ready" | "todo" | "degraded" | "blocked";
    detail: string;
  }>;
  counts?: {
    queuedTwitchChatEvents?: number;
    queuedDiscordInteractions?: number;
    suggestions?: Record<string, number>;
    outboundSends?: Record<string, number>;
  };
  schema?: {
    ready?: boolean;
    requiredTables?: number;
    presentTables?: number;
    missingTables?: string[];
  };
  queues?: {
    twitchChatEvents?: {
      queued?: number;
      oldestAgeMs?: number | null;
    };
    discordInteractions?: {
      queued?: number;
      oldestAgeMs?: number | null;
    };
    outboundRetry?: {
      dueRetry?: number;
      deadLettered?: number;
      oldestRetryAgeMs?: number | null;
    };
  };
  freshness?: {
    eventSub?: { present?: boolean; ageMs?: number | null };
    discordCommandRegistration?: {
      present?: boolean;
      ageMs?: number | null;
    };
  };
  latest?: Record<string, unknown>;
  latestRecordMetadata?: Record<string, unknown>;
};

export type RelayEvent = {
  relayEventId: string;
  id: string;
  text: string;
  userId: string;
  userLogin: string;
  userDisplayName: string;
  broadcasterUserId: string;
  badges: string[];
  isBroadcaster: boolean;
  isMod: boolean;
  isVip: boolean;
  isSubscriber: boolean;
  source: "relay-eventsub";
  receivedAt: string;
};

export class RelayChatClient {
  private readonly baseUrl: string;

  constructor(private readonly config: RelayTransportConfig) {
    this.baseUrl = (config.baseUrl ?? "").replace(/\/+$/, "");
  }

  configured() {
    return Boolean(
      this.baseUrl && this.config.installationId && this.config.consoleToken,
    );
  }

  async status() {
    return this.request<RelayStatus>("/api/console/status");
  }

  async readinessReport() {
    return this.request<RelayBotReadinessReport>(
      "/api/console/readiness-report",
    );
  }

  async registerEventSub() {
    return this.request<{ ok: true; subscription?: unknown }>(
      "/api/console/eventsub/register",
      { method: "POST" },
    );
  }

  async events(limit = 25) {
    return this.request<{ ok: true; events: RelayEvent[] }>(
      `/api/console/events?limit=${encodeURIComponent(String(limit))}`,
    );
  }

  async send(
    message: string,
    options: { idempotencyKey?: string } = {},
  ): Promise<MessageSendResult> {
    if (!this.configured()) {
      return {
        status: "failed",
        failureCategory: "config",
        reason:
          "Relay chatbot transport is enabled but Relay URL, installation ID, or console token is missing.",
      };
    }

    try {
      const result = await this.request<{ ok: true; messageId?: string }>(
        "/api/console/chat/send",
        {
          method: "POST",
          body: JSON.stringify({
            message,
            idempotencyKey: options.idempotencyKey,
          }),
        },
      );
      return result.ok ? "sent" : "failed";
    } catch (error) {
      return relayErrorResult(error);
    }
  }

  private async request<T>(
    path: string,
    options: { method?: string; body?: string } = {},
  ): Promise<T> {
    if (!this.configured()) {
      throw new Error("Relay transport is not fully configured.");
    }
    const delimiter = path.includes("?") ? "&" : "?";
    const url = `${this.baseUrl}${path}${delimiter}installationId=${encodeURIComponent(
      this.config.installationId ?? "",
    )}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.config.consoleToken}`,
          "Content-Type": "application/json",
        },
        body: options.body,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const message = relayErrorMessage(body, response.status);
        throw new RelayTransportError(message, response.status);
      }
      return body as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const startRelayHostedInstall = async (input: {
  baseUrl: string;
  name?: string;
}): Promise<RelayHostedInstallStartResponse> => {
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("Relay URL is required before hosted Twitch setup.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${baseUrl}/api/console/install/start`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name || "VaexCore Console",
      }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new RelayTransportError(
        relayErrorMessage(body, response.status),
        response.status,
      );
    }
    return body as RelayHostedInstallStartResponse;
  } finally {
    clearTimeout(timeout);
  }
};

export class RelayEventPoller {
  private timer: NodeJS.Timeout | undefined;
  private polling = false;

  constructor(
    private readonly options: {
      client: RelayChatClient;
      logger: Logger;
      onChatMessage: (message: ChatMessage) => Promise<void> | void;
      intervalMs?: number;
    },
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.poll();
    }, this.options.intervalMs ?? 1000);
    return this.poll();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const result = await this.options.client.events(50);
      for (const event of result.events) {
        await this.options.onChatMessage(relayEventToChatMessage(event));
      }
    } catch (error) {
      this.options.logger.warn({ error }, "Relay chat event poll failed");
    } finally {
      this.polling = false;
    }
  }
}

export const relayEventToChatMessage = (event: RelayEvent): ChatMessage => ({
  id: event.id,
  text: event.text,
  userId: event.userId,
  userLogin: event.userLogin,
  userDisplayName: event.userDisplayName,
  broadcasterUserId: event.broadcasterUserId,
  badges: event.badges,
  isBroadcaster: event.isBroadcaster,
  isMod: event.isMod,
  isVip: event.isVip,
  isSubscriber: event.isSubscriber,
  source: "eventsub",
  receivedAt: new Date(event.receivedAt),
});

export const relayConfigReadiness = (config: RelayTransportConfig) => {
  const checks = [
    {
      key: "relay-url",
      ok: Boolean(config.baseUrl),
      detail: config.baseUrl
        ? "Relay URL is saved."
        : "Save the VaexCore Relay Worker URL.",
    },
    {
      key: "relay-installation",
      ok: Boolean(config.installationId),
      detail: config.installationId
        ? "Relay installation ID is saved."
        : "Pair Console with Relay to get an installation ID.",
    },
    {
      key: "relay-console-token",
      ok: Boolean(config.consoleToken),
      detail: config.consoleToken
        ? "Relay console token is saved locally."
        : "Save the Relay console token returned by pairing.",
    },
  ];
  return { ready: checks.every((check) => check.ok), checks };
};

class RelayTransportError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RelayTransportError";
  }
}

const relayErrorResult = (error: unknown): MessageSendResult => {
  if (error instanceof RelayTransportError) {
    return {
      status: error.status === 429 || error.status >= 500 ? "retry" : "failed",
      failureCategory: relayFailureCategory(error.status),
      reason: error.message,
      retryAfterMs: error.status === 429 ? 5000 : undefined,
    };
  }
  if (error instanceof Error && error.name === "AbortError") {
    return {
      status: "retry",
      failureCategory: "timeout",
      reason: "Relay request timed out.",
      retryAfterMs: 5000,
    };
  }
  return {
    status: "retry",
    failureCategory: "network",
    reason: error instanceof Error ? error.message : String(error),
    retryAfterMs: 3000,
  };
};

const relayFailureCategory = (status: number): MessageSendFailureCategory => {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "network";
  return "twitch_rejected";
};

const relayErrorMessage = (body: unknown, status: number) => {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return body.error;
  }

  return `Relay request failed: ${status}`;
};
