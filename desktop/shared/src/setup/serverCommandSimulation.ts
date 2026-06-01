import type {
  Giveaway,
  GiveawayWinner,
} from "../modules/giveaways/giveaways.types";
import type { ChatMessage } from "../core/chatMessage";
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
import { CommandRouter } from "../core/commandRouter";
import { ModerationService } from "../modules/moderation/moderation.module";
import { registerCommandsModule } from "../modules/commands/commands.module";
import { registerGiveawayCommands } from "../modules/giveaways/giveaways.commands";
import { registerStudioCommands } from "../studio/studio.commands";
import { runGiveawayAction } from "./serverGiveawayActions";
import { getGiveawayState } from "./serverGiveawayState";
import {
  chatQueue,
  db,
  featureGates,
  giveawayTemplates,
  giveawaysService,
  logger,
  moderationService,
  setupRuntimeStatus,
} from "./serverState";

export const maybeEchoCommand = (
  echoToChat: boolean | undefined,
  command: string | undefined,
) => {
  let text: string;

  try {
    text = command ? sanitizeCommandText(command) : "";
  } catch (error) {
    logger.warn({ error }, "Operator command echo rejected");
    return false;
  }

  if (!echoToChat || !text) {
    return false;
  }

  try {
    chatQueue.enqueue(text);
    logger.info({ command: text }, "Operator command echo queued");
    return true;
  } catch (error) {
    logger.warn(
      { error, command: text },
      "Operator command echo failed to queue",
    );
    return false;
  }
};

export const localUiActor: ChatMessage = {
  id: "local-ui",
  text: "",
  userId: "local-ui",
  userLogin: "local-ui",
  userDisplayName: "Local UI",
  broadcasterUserId: "local-ui",
  badges: ["broadcaster"],
  isBroadcaster: true,
  isMod: true,
  isVip: false,
  isSubscriber: false,
  source: "local",
  receivedAt: new Date(),
};

export const simulatedChatActor: ChatMessage = {
  ...localUiActor,
  id: "simulated-chat",
  userId: "simulated-chat",
  userLogin: "simulated-chat",
  userDisplayName: "Simulated Chat",
};

export type LocalChatRole =
  | "viewer"
  | "subscriber"
  | "vip"
  | "mod"
  | "broadcaster";

export const createLocalChatMessage = (input: {
  login: string;
  displayName?: string;
  role: LocalChatRole;
  text: string;
  followAgeDays?: number;
  followVerified?: boolean;
}): ChatMessage => {
  const login = requireUsername(input.login);
  const isBroadcaster = input.role === "broadcaster";
  const isMod = input.role === "mod" || isBroadcaster;
  const isVip = input.role === "vip";
  const isSubscriber = input.role === "subscriber";

  return {
    id: `local-${login}-${Date.now()}`,
    text: sanitizeCommandText(input.text),
    userId: `local-${login}`,
    userLogin: login,
    userDisplayName: sanitizeDisplayName(input.displayName, login),
    broadcasterUserId: "local-broadcaster",
    badges: isBroadcaster
      ? ["broadcaster"]
      : isMod
        ? ["moderator"]
        : isVip
          ? ["vip"]
          : isSubscriber
            ? ["subscriber"]
            : [],
    isBroadcaster,
    isMod,
    isVip,
    isSubscriber,
    source: "local",
    receivedAt: new Date(),
    simulatedFollowAgeDays: input.followAgeDays,
    simulatedFollowVerified: input.followVerified,
  };
};

export const simulateCommand = async (body: {
  actor?: string;
  role?: "viewer" | "mod" | "broadcaster";
  command?: string;
  echoToChat?: boolean;
}) => {
  let command: string;

  try {
    command = sanitizeCommandText(body.command);
  } catch (error) {
    return {
      ok: false,
      error: safeErrorMessage(error, "Command text is required."),
      state: getGiveawayState(),
    };
  }

  const replies: string[] = [];
  const router = new CommandRouter({
    prefix: "!",
    logger,
    enqueueMessage: (message) => replies.push(message),
  });
  registerGiveawayCommands({
    router,
    service: giveawaysService,
    runtimeStatus: setupRuntimeStatus,
    messages: giveawayTemplates,
  });
  registerCommandsModule({
    router,
    db,
    featureGates,
  });
  registerStudioCommands({
    router,
    logger,
  });

  try {
    const actor = createLocalChatMessage({
      login: body.actor || "viewer",
      role: body.role ?? "viewer",
      text: command,
    });
    let moderation: ReturnType<ModerationService["evaluate"]> | undefined;

    try {
      moderation = moderationService.evaluate(actor, { consumePermits: false });
      if (moderation.hit) {
        replies.push(moderation.hit.warningMessage);
      }
    } catch (error) {
      logger.warn(
        { error: redactSecrets(error), command },
        "Moderation simulation failed open",
      );
    }

    const routerResult = await router.handle(actor);
    const echoQueued =
      routerResult === "handled"
        ? maybeEchoCommand(body.echoToChat, command)
        : false;

    return {
      ok: true,
      replies,
      moderation,
      routerResult,
      echoQueued,
      state: getGiveawayState(),
    };
  } catch (error) {
    return {
      ok: false,
      error: safeErrorMessage(error, "Simulated command failed"),
      replies,
      state: getGiveawayState(),
    };
  }
};

export const runLocalLifecycleTest = (options: {
  echoToChat: boolean;
  confirmed: boolean;
}) =>
  runGiveawayAction(async () => {
    if (!options.confirmed) {
      throw new Error("Confirm before running the local lifecycle test.");
    }

    if (giveawaysService.status()) {
      throw new Error(
        "End the active giveaway before running the local lifecycle test.",
      );
    }

    const giveaway = giveawaysService.start({
      actor: localUiActor,
      title: "Community Giveaway",
      keyword: "enter",
      winnerCount: 6,
    });

    for (const login of ["alice", "bob", "carol", "dave", "erin", "frank"]) {
      await giveawaysService.addSimulatedEntrant(
        simulatedChatActor,
        createLocalChatMessage({
          login,
          role: "viewer",
          text: "!enter",
        }),
      );
    }

    giveawaysService.close(localUiActor);
    const draw = giveawaysService.draw(localUiActor, 6);
    const firstWinner = draw.winners[0];

    if (firstWinner) {
      giveawaysService.claim(localUiActor, firstWinner.login);
      giveawaysService.deliver(localUiActor, firstWinner.login);
    }

    maybeEchoCommand(
      options.echoToChat,
      '!gstart codes=6 keyword=enter title="Community Giveaway"',
    );
    maybeEchoCommand(options.echoToChat, "!gclose");
    maybeEchoCommand(options.echoToChat, "!gdraw 6");

    if (firstWinner) {
      maybeEchoCommand(options.echoToChat, `!gclaim ${firstWinner.login}`);
      maybeEchoCommand(options.echoToChat, `!gdeliver ${firstWinner.login}`);
    }

    return { giveaway, draw };
  });

export const requireUsername = (username: string | undefined) =>
  normalizeTwitchLogin(username, "Username");
