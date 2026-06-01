import { PermissionLevel } from "../core/permissions";
import type { CommandRouter } from "../core/commandRouter";
import type { Logger } from "../core/logger";
import { loadStudioIntegrationConfig, StudioClient } from "./client";
import { buildConsoleChatStudioMarker } from "./markerPayloads";

type RegisterStudioCommandsOptions = {
  router: CommandRouter;
  logger: Logger;
};

export const registerStudioCommands = ({
  router,
  logger,
}: RegisterStudioCommandsOptions) => {
  const config = loadStudioIntegrationConfig();
  const client = new StudioClient(config);

  router.register("vcstudio", PermissionLevel.Moderator, async ({ reply }) => {
    if (!config.enabled) {
      reply(
        "Studio integration is off. Set VAEXCORE_STUDIO_INTEGRATION=true to enable it.",
      );
      return;
    }

    try {
      const health = await client.health();
      reply(`Studio connected: ${health.service} ${health.version}`);
    } catch (error) {
      logger.warn({ error }, "Studio health check failed");
      reply("Studio is not reachable from vaexcore console.");
    }
  });

  router.register(
    "vcmark",
    PermissionLevel.Moderator,
    async ({ message, rawArgs, reply }) => {
      if (!config.enabled) {
        reply("Studio marker integration is off.");
        return;
      }

      const marker = buildConsoleChatStudioMarker({
        message,
        rawLabel: rawArgs,
      });

      try {
        await client.createMarker(marker);
        reply(`Studio marker created: ${marker.label}`);
      } catch (error) {
        logger.warn(
          { error, label: marker.label },
          "Studio marker creation failed",
        );
        reply("Studio marker could not be created.");
      }
    },
  );
};
