import type { CommandRouter } from "../../core/commandRouter";
import type { Logger } from "../../core/logger";
import type { RuntimeStatus } from "../../core/runtimeStatus";
import type { DbClient } from "../../db/client";
import { registerGiveawayCommands } from "./giveaways.commands";
import {
  GiveawaysService,
  type GiveawayFollowAgeResolver,
} from "./giveaways.service";
import { createGiveawayTemplateStore } from "./giveaways.templates";

type GiveawaysModuleOptions = {
  router: CommandRouter;
  db: DbClient;
  logger: Logger;
  runtimeStatus?: RuntimeStatus;
  followAgeResolver?: GiveawayFollowAgeResolver;
};

export const registerGiveawaysModule = ({
  router,
  db,
  logger,
  runtimeStatus,
  followAgeResolver,
}: GiveawaysModuleOptions) => {
  const service = new GiveawaysService({ db, logger, followAgeResolver });
  const templates = createGiveawayTemplateStore(db);
  registerGiveawayCommands({
    router,
    service,
    runtimeStatus,
    messages: templates,
  });

  return service;
};
