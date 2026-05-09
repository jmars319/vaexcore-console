import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { normalizeLogin, sanitizeText } from "../core/security";

const configDir = process.env.VAEXCORE_CONFIG_DIR
  ? resolve(process.env.VAEXCORE_CONFIG_DIR)
  : resolve(process.cwd(), "config");
const secretsPath = resolve(configDir, "local.secrets.json");

const localSecretsSchema = z.object({
  mode: z.enum(["local", "live"]).default("live"),
  twitch: z
    .object({
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      redirectUri: z
        .string()
        .default("http://localhost:3434/auth/twitch/callback"),
      broadcasterLogin: z.string().optional(),
      broadcasterUserId: z.string().optional(),
      botLogin: z.string().optional(),
      botUserId: z.string().optional(),
      accessToken: z.string().optional(),
      refreshToken: z.string().optional(),
      scopes: z.array(z.string()).default([]),
      tokenExpiresAt: z.string().optional(),
      tokenValidatedAt: z.string().optional(),
    })
    .default({}),
  discord: z
    .object({
      botToken: z.string().optional(),
      guildId: z.string().optional(),
      streamAnnouncementChannelId: z.string().optional(),
      generalAnnouncementChannelId: z.string().optional(),
      streamAlertsRoleId: z.string().optional(),
      setupAppliedAt: z.string().optional(),
      createdChannelIds: z.record(z.string()).default({}),
      createdRoleIds: z.record(z.string()).default({}),
    })
    .default({}),
  relay: z
    .object({
      twitchTransportMode: z
        .enum(["local-user-token", "relay-chatbot"])
        .default("local-user-token"),
      baseUrl: z.string().optional(),
      installationId: z.string().optional(),
      consoleToken: z.string().optional(),
      chatbotIdentityValidatedAt: z.string().optional(),
      chatbotIdentityValidationNote: z.string().optional(),
    })
    .default({}),
});

export type LocalSecrets = z.infer<typeof localSecretsSchema>;

export const readLocalSecrets = (): LocalSecrets => {
  if (!existsSync(secretsPath)) {
    return {
      mode: "live",
      twitch: { redirectUri: defaultRedirectUri, scopes: [] },
      discord: { createdChannelIds: {}, createdRoleIds: {} },
      relay: { twitchTransportMode: "local-user-token" },
    };
  }

  const raw = readFileSync(secretsPath, "utf8");
  return normalizeSecrets(localSecretsSchema.parse(JSON.parse(raw)));
};

export const writeLocalSecrets = (secrets: LocalSecrets) => {
  mkdirSync(dirname(secretsPath), { recursive: true });
  writeFileSync(
    secretsPath,
    `${JSON.stringify(normalizeSecrets(secrets), null, 2)}\n`,
    {
      mode: 0o600,
    },
  );
};

export const getLocalSecretsPath = () => secretsPath;

export const defaultRedirectUri = "http://localhost:3434/auth/twitch/callback";

const normalizeSecrets = (secrets: LocalSecrets): LocalSecrets => ({
  mode: secrets.mode,
  twitch: {
    ...secrets.twitch,
    clientId: sanitizeOptional(secrets.twitch.clientId, "Client ID", 120),
    clientSecret: sanitizeOptional(
      secrets.twitch.clientSecret,
      "Client secret",
      200,
    ),
    redirectUri: secrets.twitch.redirectUri || defaultRedirectUri,
    broadcasterLogin: secrets.twitch.broadcasterLogin
      ? normalizeLogin(secrets.twitch.broadcasterLogin, "Broadcaster login")
      : undefined,
    botLogin: secrets.twitch.botLogin
      ? normalizeLogin(secrets.twitch.botLogin, "Bot login")
      : undefined,
  },
  discord: {
    ...secrets.discord,
    botToken: sanitizeOptional(
      secrets.discord.botToken,
      "Discord bot token",
      240,
    ),
    guildId: sanitizeOptional(secrets.discord.guildId, "Discord server ID", 32),
    streamAnnouncementChannelId: sanitizeOptional(
      secrets.discord.streamAnnouncementChannelId,
      "Discord stream announcement channel ID",
      32,
    ),
    generalAnnouncementChannelId: sanitizeOptional(
      secrets.discord.generalAnnouncementChannelId,
      "Discord general announcement channel ID",
      32,
    ),
    streamAlertsRoleId: sanitizeOptional(
      secrets.discord.streamAlertsRoleId,
      "Discord Stream Alerts role ID",
      32,
    ),
    createdChannelIds: secrets.discord.createdChannelIds ?? {},
    createdRoleIds: secrets.discord.createdRoleIds ?? {},
  },
  relay: {
    ...secrets.relay,
    twitchTransportMode:
      secrets.relay.twitchTransportMode === "relay-chatbot"
        ? "relay-chatbot"
        : "local-user-token",
    baseUrl: secrets.relay.baseUrl
      ? sanitizeOptional(secrets.relay.baseUrl, "Relay URL", 300)
      : undefined,
    installationId: secrets.relay.installationId
      ? sanitizeOptional(
          secrets.relay.installationId,
          "Relay installation ID",
          120,
        )
      : undefined,
    consoleToken: secrets.relay.consoleToken
      ? sanitizeOptional(secrets.relay.consoleToken, "Relay console token", 240)
      : undefined,
    chatbotIdentityValidatedAt: secrets.relay.chatbotIdentityValidatedAt
      ? sanitizeOptional(
          secrets.relay.chatbotIdentityValidatedAt,
          "Relay Chat Bot validation timestamp",
          80,
        )
      : undefined,
    chatbotIdentityValidationNote: secrets.relay.chatbotIdentityValidationNote
      ? sanitizeOptional(
          secrets.relay.chatbotIdentityValidationNote,
          "Relay Chat Bot validation note",
          240,
        )
      : undefined,
  },
});

const sanitizeOptional = (
  value: string | undefined,
  field: string,
  maxLength: number,
) =>
  value
    ? sanitizeText(value, {
        field,
        maxLength,
        required: true,
      })
    : undefined;
