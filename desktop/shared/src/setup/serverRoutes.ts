import { botSetupRoutes } from "./serverBotSetupRoutes";
import { commandRoutes } from "./serverCommandRoutes";
import { coreRoutes } from "./serverCoreRoutes";
import { discordRoutes } from "./serverDiscordRoutes";
import { giveawayLifecycleRoutes } from "./serverGiveawayLifecycleRoutes";
import { giveawayMetaRoutes } from "./serverGiveawayMetaRoutes";
import { giveawayWinnerRoutes } from "./serverGiveawayWinnerRoutes";
import { moderationRoutes } from "./serverModerationRoutes";
import { operatorRoutes } from "./serverOperatorRoutes";
import { relayRoutes } from "./serverRelayRoutes";
import { runtimeRoutes } from "./serverRuntimeRoutes";
import { staticRoutes } from "./serverStaticRoutes";
import { timerRoutes } from "./serverTimerRoutes";
import { createSetupRouteDispatcher } from "./serverRouter";

export const setupRoutes = [
  ...botSetupRoutes,
  ...commandRoutes,
  ...coreRoutes,
  ...discordRoutes,
  ...giveawayLifecycleRoutes,
  ...giveawayMetaRoutes,
  ...giveawayWinnerRoutes,
  ...moderationRoutes,
  ...operatorRoutes,
  ...relayRoutes,
  ...runtimeRoutes,
  ...staticRoutes,
  ...timerRoutes,
];

export const dispatchSetupRequest = createSetupRouteDispatcher(setupRoutes);
