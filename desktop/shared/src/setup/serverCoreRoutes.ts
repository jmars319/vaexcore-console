import { exactRoute, prefixRoute, type SetupRoute } from "./serverRouter";
import {
  createFeatureGateStore,
  type FeatureGateState,
  type FeatureGateMode,
  type FeatureKey,
} from "../core/featureGates";
import { getRecentAuditLogs, writeAuditLog } from "../core/auditLog";
import { checkSetupModeRoute, getSafeConfig } from "./serverConfig";
import { getDiagnosticsReport } from "./serverDiagnostics";
import { getSupportBundle } from "./serverSupportBundle";
import { readJson, sendJson } from "./serverHttp";
import {
  getLaunchPreparationSnapshot,
  queueLaunchPreparation,
  resetLaunchPreparation,
} from "./serverLaunchPreparation";
import {
  getFeatureGates,
  getStreamPresets,
  setFeatureGate,
} from "./serverOperatorConfig";
import { getPlatformStatus, getTwitchStreamKey } from "./serverPlatform";
import {
  getOperatorStatus,
  sendTestMessage,
  validateSetup,
} from "./serverSetupStatus";
import { giveawaysService } from "./serverState";
import { getSuiteStatus, launchVaexcoreSuite } from "./serverSuite";
import { applyStreamPreset } from "./serverTimers";
import {
  disconnectTwitch,
  getTwitchBroadcastReadiness,
  handleTwitchCallback,
  redirectToTwitch,
  saveConfig,
  saveSetupMode,
} from "./serverTwitchAuth";

export const coreRoutes: SetupRoute[] = [
  exactRoute("GET", "/api/config", async ({ request, response, url }) => {
    sendJson(response, 200, getSafeConfig());
    return;
  }),
  exactRoute("POST", "/api/config", async ({ request, response, url }) => {
    const body = await readJson(request);
    const saved = saveConfig(body);
    void queueLaunchPreparation("settings_saved");
    sendJson(response, 200, { ok: true, config: saved });
    return;
  }),
  exactRoute("POST", "/api/setup-mode", async ({ request, response, url }) => {
    const body = await readJson(request);
    const saved = saveSetupMode(body);
    void queueLaunchPreparation("setup_mode_changed");
    sendJson(response, 200, { ok: true, config: saved });
    return;
  }),
  exactRoute(
    "POST",
    "/api/setup-mode/check",
    async ({ request, response, url }) => {
      const body = await readJson(request);
      sendJson(response, 200, checkSetupModeRoute(body));
      return;
    },
  ),
  exactRoute(
    "GET",
    "/auth/twitch/start",
    async ({ request, response, url }) => {
      redirectToTwitch(response);
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/auth/twitch/disconnect",
    async ({ request, response, url }) => {
      const config = disconnectTwitch();
      resetLaunchPreparation(
        "setup_required",
        "Twitch was disconnected.",
        "Connect Twitch in Configuration Settings.",
      );
      sendJson(response, 200, { ok: true, config });
      return;
    },
  ),
  exactRoute(
    "GET",
    "/auth/twitch/callback",
    async ({ request, response, url }) => {
      await handleTwitchCallback(url, response);
      return;
    },
  ),
  exactRoute("POST", "/api/validate", async ({ request, response, url }) => {
    sendJson(response, 200, await validateSetup());
    return;
  }),
  exactRoute("POST", "/api/test-send", async ({ request, response, url }) => {
    sendJson(response, 200, await sendTestMessage());
    return;
  }),
  exactRoute("GET", "/api/status", async ({ request, response, url }) => {
    sendJson(response, 200, await getOperatorStatus());
    return;
  }),
  exactRoute(
    "GET",
    "/api/twitch/stream-key",
    async ({ request, response, url }) => {
      const result = await getTwitchStreamKey();
      sendJson(response, result.ok ? 200 : result.statusCode, result);
      return;
    },
  ),
  exactRoute(
    "GET",
    "/api/twitch/broadcast-readiness",
    async ({ request, response, url }) => {
      sendJson(response, 200, getTwitchBroadcastReadiness());
      return;
    },
  ),
  exactRoute("GET", "/api/suite/status", async ({ request, response, url }) => {
    sendJson(response, 200, getSuiteStatus());
    return;
  }),
  exactRoute(
    "GET",
    "/api/platform/status",
    async ({ request, response, url }) => {
      sendJson(response, 200, getPlatformStatus());
      return;
    },
  ),
  exactRoute(
    "GET",
    "/api/launch-preparation",
    async ({ request, response, url }) => {
      sendJson(response, 200, getLaunchPreparationSnapshot());
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/launch-preparation",
    async ({ request, response, url }) => {
      await queueLaunchPreparation("manual");
      sendJson(response, 200, getLaunchPreparationSnapshot());
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/launch-suite",
    async ({ request, response, url }) => {
      sendJson(response, 200, await launchVaexcoreSuite());
      return;
    },
  ),
  exactRoute("GET", "/api/diagnostics", async ({ request, response, url }) => {
    sendJson(response, 200, getDiagnosticsReport());
    return;
  }),
  exactRoute(
    "GET",
    "/api/support-bundle",
    async ({ request, response, url }) => {
      sendJson(response, 200, await getSupportBundle());
      return;
    },
  ),
  exactRoute(
    "GET",
    "/api/feature-gates",
    async ({ request, response, url }) => {
      sendJson(response, 200, getFeatureGates());
      return;
    },
  ),
  exactRoute(
    "GET",
    "/api/stream-presets",
    async ({ request, response, url }) => {
      sendJson(response, 200, getStreamPresets());
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/stream-presets/apply",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as {
        id?: string;
        confirmed?: boolean;
      };
      sendJson(response, 200, applyStreamPreset(body));
      return;
    },
  ),
  exactRoute(
    "POST",
    "/api/feature-gates",
    async ({ request, response, url }) => {
      const body = (await readJson(request)) as {
        key?: FeatureKey;
        mode?: FeatureGateMode;
      };
      sendJson(response, 200, setFeatureGate(body));
      return;
    },
  ),
  exactRoute("GET", "/api/audit-logs", async ({ request, response, url }) => {
    sendJson(response, 200, {
      ok: true,
      logs: giveawaysService.getRecentAuditLogs(100),
    });
    return;
  }),
];
