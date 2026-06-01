import { exactRoute, prefixRoute, type SetupRoute } from "./serverRouter";
import { readJson, sendJson } from "./serverHttp";
import {
  createTimerFromPreset,
  deleteTimer,
  exportTimers,
  getTimers,
  importTimers,
  saveTimer,
  sendTimerNow,
  setTimerEnabled,
} from "./serverTimers";

export const timerRoutes: SetupRoute[] = [
  exactRoute("GET", "/api/timers", async ({ request, response, url }) => {
    sendJson(response, 200, getTimers());
    return;
  }),
  exactRoute(
    "GET",
    "/api/timers/export",
    async ({ request, response, url }) => {
      sendJson(response, 200, exportTimers());
      return;
    },
  ),
  exactRoute("POST", "/api/timers", async ({ request, response, url }) => {
    const body = await readJson(request);
    sendJson(response, 200, saveTimer(body));
    return;
  }),
  exactRoute(
    "POST",
    "/api/timers/import",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      sendJson(response, 200, importTimers(body));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/timers/preset",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as { id?: string };
      sendJson(response, 200, createTimerFromPreset(body.id));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/timers/enable",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as {
        id?: number;
        enabled?: boolean;
      };
      sendJson(response, 200, setTimerEnabled(body));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/timers/delete",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as { id?: number };
      sendJson(response, 200, deleteTimer(body.id));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/timers/send-now",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as { id?: number };
      sendJson(response, 200, await sendTimerNow(body.id));
      return;
    },
  ),
];
