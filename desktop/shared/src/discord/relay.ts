import type { RelayTransportConfig } from "../twitch/relayTransport";

export type DiscordRelayReadiness = {
  ready: boolean;
  mode: "relay-discord-interactions";
  interactionUrl: string;
  checks: Array<{ key: string; ok: boolean; detail: string }>;
};

export type DiscordRelayStatus = {
  ok: boolean;
  readiness?: DiscordRelayReadiness;
};

export type DiscordRelaySuggestionStatus =
  | "new"
  | "reviewed"
  | "accepted"
  | "rejected"
  | "archived";

export type DiscordRelaySuggestion = {
  id: string;
  userId: string;
  username: string;
  text: string;
  status: DiscordRelaySuggestionStatus;
  createdAt: string;
  updatedAt: string;
};

export type DiscordRelayEvent = {
  relayEventId: string;
  id: string;
  commandName: string;
  kind: "suggestion" | "announcement" | "status" | "unknown";
  userId: string;
  username: string;
  guildId: string;
  channelId: string;
  options: Record<string, string | number | boolean>;
  allowed: boolean;
  receivedAt: string;
};

export class DiscordRelayClient {
  private readonly baseUrl: string;

  constructor(private readonly config: RelayTransportConfig) {
    this.baseUrl = (config.baseUrl ?? "").replace(/\/+$/, "");
  }

  configured() {
    return Boolean(
      this.baseUrl && this.config.installationId && this.config.consoleToken,
    );
  }

  status() {
    return this.request<DiscordRelayStatus>("/api/console/discord/status");
  }

  registerCommands() {
    return this.request<{
      ok: true;
      scope: "guild" | "global";
      registeredAt: string;
      commands: string[];
    }>("/api/console/discord/commands/register", { method: "POST" });
  }

  events(limit = 25) {
    return this.request<{ ok: true; events: DiscordRelayEvent[] }>(
      `/api/console/discord/events?limit=${encodeURIComponent(String(limit))}`,
    );
  }

  suggestions(status?: DiscordRelaySuggestionStatus) {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.request<{ ok: true; suggestions: DiscordRelaySuggestion[] }>(
      `/api/console/discord/suggestions${query}`,
    );
  }

  updateSuggestionStatus(id: string, status: DiscordRelaySuggestionStatus) {
    return this.request<{
      ok: true;
      id: string;
      status: DiscordRelaySuggestionStatus;
      updatedAt: string;
    }>("/api/console/discord/suggestions/status", {
      method: "POST",
      body: JSON.stringify({ id, status }),
    });
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
        throw new DiscordRelayError(
          discordRelayErrorMessage(body, response.status),
          response.status,
        );
      }
      return body as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class DiscordRelayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DiscordRelayError";
  }
}

const discordRelayErrorMessage = (body: unknown, status: number) => {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return body.error;
  }
  if (status === 401 || status === 403) {
    return "Relay rejected Console authorization. Recheck the Relay installation ID and console token.";
  }
  if (status === 409) {
    return "Relay is missing required Discord configuration.";
  }
  return `Discord Relay request failed (${status}).`;
};
