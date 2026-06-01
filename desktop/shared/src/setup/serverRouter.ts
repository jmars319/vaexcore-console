import type { IncomingMessage, ServerResponse } from "node:http";
import { sendText } from "./staticUi";
import { isAllowedHost, isLocalRequest, sendJson } from "./serverHttp";

export type SetupRouteContext = {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
};

export type SetupRoute = {
  method: string;
  path: string;
  match: "exact" | "prefix";
  handler: (context: SetupRouteContext) => Promise<void> | void;
};

export const exactRoute = (
  method: string,
  path: string,
  handler: SetupRoute["handler"],
): SetupRoute => ({ method, path, match: "exact", handler });

export const prefixRoute = (
  method: string,
  path: string,
  handler: SetupRoute["handler"],
): SetupRoute => ({ method, path, match: "prefix", handler });

export const createSetupRouteDispatcher = (routes: SetupRoute[]) => {
  const seen = new Set<string>();
  for (const route of routes) {
    const key = `${route.method} ${route.match} ${route.path}`;
    if (seen.has(key)) throw new Error(`Duplicate setup route: ${key}`);
    seen.add(key);
  }

  return async (request: IncomingMessage, response: ServerResponse) => {
    if (!isLocalRequest(request)) {
      sendText(response, 403, "vaexcore console setup is local-only.");
      return;
    }

    if (!isAllowedHost(request.headers.host)) {
      sendText(
        response,
        403,
        "vaexcore console setup only accepts localhost requests.",
      );
      return;
    }

    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );

    const method = request.method ?? "";
    const match = routes.find(
      (route) =>
        route.method === method &&
        (route.match === "exact"
          ? url.pathname === route.path
          : url.pathname.startsWith(route.path)),
    );

    if (!match) {
      sendJson(response, 404, { ok: false, error: "Not found" });
      return;
    }

    await match.handler({ request, response, url });
  };
};
