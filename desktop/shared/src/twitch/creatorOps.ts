import type { Logger } from "../core/logger";
import { createTwitchHeaders } from "./auth";
import type { TwitchUser } from "./users";

export type TwitchCreatorOpsOptions = {
  clientId: string;
  accessToken: string;
  accessTokenProvider?: () => string | Promise<string>;
  broadcasterId: string;
  moderatorId: string;
  logger: Logger;
  apiBaseUrl?: string;
  timeoutMs?: number;
};

export type PollInput = {
  title: string;
  choices: string[];
  durationSeconds: number;
  channelPointsVotingEnabled?: boolean;
  channelPointsPerVote?: number;
};

export type PredictionInput = {
  title: string;
  outcomes: string[];
  predictionWindowSeconds: number;
};

export type EndPredictionInput = {
  id: string;
  status: "RESOLVED" | "CANCELED" | "LOCKED";
  winningOutcomeId?: string;
};

export type AnnouncementInput = {
  message: string;
  color?: "blue" | "green" | "orange" | "purple" | "primary";
};

export class TwitchCreatorOpsClient {
  private readonly apiBaseUrl: string;

  constructor(private readonly options: TwitchCreatorOpsOptions) {
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://api.twitch.tv").replace(
      /\/+$/,
      "",
    );
  }

  async createPoll(input: PollInput) {
    return this.requestJson("POST", "/helix/polls", {
      broadcaster_id: this.options.broadcasterId,
      title: input.title,
      choices: input.choices.map((title) => ({ title })),
      duration: input.durationSeconds,
      channel_points_voting_enabled: Boolean(input.channelPointsVotingEnabled),
      channel_points_per_vote: input.channelPointsVotingEnabled
        ? input.channelPointsPerVote
        : undefined,
    });
  }

  async endPoll(input: { id: string; status: "TERMINATED" | "ARCHIVED" }) {
    const params = new URLSearchParams({
      broadcaster_id: this.options.broadcasterId,
      id: input.id,
      status: input.status,
    });
    return this.requestJson("PATCH", `/helix/polls?${params}`);
  }

  async createPrediction(input: PredictionInput) {
    return this.requestJson("POST", "/helix/predictions", {
      broadcaster_id: this.options.broadcasterId,
      title: input.title,
      outcomes: input.outcomes.map((title) => ({ title })),
      prediction_window: input.predictionWindowSeconds,
    });
  }

  async endPrediction(input: EndPredictionInput) {
    const params = new URLSearchParams({
      broadcaster_id: this.options.broadcasterId,
      id: input.id,
      status: input.status,
    });

    if (input.winningOutcomeId) {
      params.set("winning_outcome_id", input.winningOutcomeId);
    }

    return this.requestJson("PATCH", `/helix/predictions?${params}`);
  }

  async sendAnnouncement(input: AnnouncementInput) {
    const params = new URLSearchParams({
      broadcaster_id: this.options.broadcasterId,
      moderator_id: this.options.moderatorId,
    });
    await this.requestNoContent("POST", `/helix/chat/announcements?${params}`, {
      message: input.message,
      color: input.color ?? "primary",
    });
    return { status: "sent" as const };
  }

  async sendShoutout(input: { targetLogin: string }) {
    const target = await this.getUserByLogin(input.targetLogin);
    if (!target) {
      throw new TwitchCreatorOpsError(
        `Twitch user ${input.targetLogin} was not found.`,
        404,
      );
    }

    const params = new URLSearchParams({
      from_broadcaster_id: this.options.broadcasterId,
      to_broadcaster_id: target.id,
      moderator_id: this.options.moderatorId,
    });
    await this.requestNoContent("POST", `/helix/chat/shoutouts?${params}`);
    return { status: "sent" as const, target };
  }

  async startRaid(input: { targetLogin: string }) {
    const target = await this.getUserByLogin(input.targetLogin);
    if (!target) {
      throw new TwitchCreatorOpsError(
        `Twitch user ${input.targetLogin} was not found.`,
        404,
      );
    }

    const params = new URLSearchParams({
      from_broadcaster_id: this.options.broadcasterId,
      to_broadcaster_id: target.id,
    });
    const result = await this.requestJson("POST", `/helix/raids?${params}`);
    return {
      ...(typeof result === "object" && result !== null ? result : {}),
      target,
    };
  }

  async cancelRaid() {
    const params = new URLSearchParams({
      broadcaster_id: this.options.broadcasterId,
    });
    await this.requestNoContent("DELETE", `/helix/raids?${params}`);
    return { status: "canceled" as const };
  }

  async getUserByLogin(login: string): Promise<TwitchUser | undefined> {
    const params = new URLSearchParams({ login });
    const body = (await this.requestJson("GET", `/helix/users?${params}`)) as {
      data?: TwitchUser[];
    };
    return body.data?.[0];
  }

  private async requestJson(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ) {
    const response = await this.request(method, path, body);
    if (!response.ok) {
      throw await TwitchCreatorOpsError.fromResponse(response);
    }
    return response.status === 204 ? {} : response.json();
  }

  private async requestNoContent(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ) {
    const response = await this.request(method, path, body);
    if (!response.ok) {
      throw await TwitchCreatorOpsError.fromResponse(response);
    }
  }

  private async request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 10_000,
    );

    try {
      const accessToken = await this.getAccessToken();
      this.options.logger.info({ method, path }, "Twitch creator ops request");
      return await fetch(`${this.apiBaseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: createTwitchHeaders({
          clientId: this.options.clientId,
          accessToken,
        }),
        body: body ? JSON.stringify(stripUndefined(body)) : undefined,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getAccessToken() {
    return this.options.accessTokenProvider
      ? this.options.accessTokenProvider()
      : this.options.accessToken;
  }
}

export class TwitchCreatorOpsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TwitchCreatorOpsError";
  }

  static async fromResponse(response: Response) {
    const body = await response.text();
    return new TwitchCreatorOpsError(
      `Twitch creator ops request failed: ${response.status} ${body}`,
      response.status,
    );
  }
}

const stripUndefined = (input: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
