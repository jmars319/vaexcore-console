import { exactRoute, prefixRoute, type SetupRoute } from "./serverRouter";
import { simulateCommand } from "./serverCommandSimulation";
import {
  createCustomCommandFromPreset,
  createCustomCommandPresetPack,
  deleteCustomCommand,
  duplicateCustomCommand,
  getCustomCommands,
  importCustomCommands,
  previewCustomCommand,
  saveCustomCommand,
  setCustomCommandEnabled,
} from "./serverCommands";
import { readJson, sendJson } from "./serverHttp";
import { customCommandsService } from "./serverState";

export const commandRoutes: SetupRoute[] = [
  exactRoute("GET", "/api/commands", async ({ request, response, url }) => {
    sendJson(response, 200, getCustomCommands());
    return;
  }),
  exactRoute("POST", "/api/commands", async ({ request, response, url }) => {
    const body = await readJson(request);
    sendJson(response, 200, saveCustomCommand(body));
    return;
  }),
  exactRoute(
    "POST",
    "/api/commands/enable",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as {
        id?: number;
        enabled?: boolean;
      };
      sendJson(response, 200, setCustomCommandEnabled(body));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/commands/duplicate",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as { id?: number };
      sendJson(response, 200, duplicateCustomCommand(body.id));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/commands/delete",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as { id?: number };
      sendJson(response, 200, deleteCustomCommand(body.id));
      return;
    },
  ),
  exactRoute(
    "GET",
    "/api/commands/export",
    async ({ request, response, url }) => {
      sendJson(response, 200, customCommandsService.exportCommands());
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/commands/import",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      sendJson(response, 200, importCustomCommands(body));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/commands/preset",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as { id?: string };
      sendJson(response, 200, createCustomCommandFromPreset(body.id));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/commands/preset-pack",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as { id?: string };
      sendJson(response, 200, createCustomCommandPresetPack(body.id));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/commands/preview",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      sendJson(response, 200, previewCustomCommand(body));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/command/simulate",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as {
        actor?: string;
        role?: "viewer" | "mod" | "broadcaster";
        command?: string;
        echoToChat?: boolean;
      };
      sendJson(response, 200, await simulateCommand(body));
      return;
    },
  ),
];
