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
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  defaultRedirectUri,
  getLocalSecretsPath,
  readLocalSecrets,
  writeLocalSecrets,
  type LocalSecrets,
} from "../config/localSecrets";
import {
  validateSuiteCommandDocument,
  type SuiteCommandDocument,
} from "../suite/commands";
import {
  validateSuiteDiscoveryDocument,
  type SuiteDiscoveryDocument,
  type SuiteLocalRuntime,
} from "../suite/discovery";
import { CONSOLE_APP, SUITE_DISCOVERY_SCHEMA_VERSION } from "../suiteProtocol";
import { basename, dirname, join, resolve } from "node:path";
import { createDbClient, resolveDatabasePath } from "../db/client";
import { homedir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { getSafeConfig } from "./serverConfig";
import {
  databaseUrl,
  logger,
  suiteDiscoveryHeartbeatMs,
  suiteDiscoverySchemaVersion,
  vaexcoreSuiteAppDefinitions,
  vaexcoreSuiteApps,
} from "./serverState";

export type SuiteTimelineEvent = {
  schemaVersion: number;
  eventId: string;
  sourceApp: string;
  sourceAppName: string;
  kind: string;
  title: string;
  detail: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type SuiteAppStatus = {
  appId: string;
  appName: string;
  launchName: string;
  bundleIdentifier: string;
  installed: boolean;
  running: boolean;
  reachable: boolean;
  stale: boolean;
  discoveryFile: string;
  pid: number | null;
  apiUrl: string | null;
  healthUrl: string | null;
  updatedAt: string | null;
  capabilities: string[];
  suiteSessionId: string | null;
  activity: string | null;
  activityDetail: string | null;
  localRuntime: SuiteLocalRuntime | null;
  detail: string;
};

/* Suite timeline contract */
export const appendSuiteTimelineEvent = (
  event: Omit<SuiteTimelineEvent, "schemaVersion" | "eventId" | "createdAt">,
) => {
  const directory = suiteDiscoveryDir();
  mkdirSync(directory, { recursive: true });
  const document: SuiteTimelineEvent = {
    schemaVersion: suiteDiscoverySchemaVersion,
    eventId: `console-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
    ...event,
  };
  appendFileSync(
    join(directory, "timeline.jsonl"),
    `${JSON.stringify(document)}\n`,
  );
};

export const getSuiteStatus = () => ({
  ok: true,
  generatedAt: new Date().toISOString(),
  protocol: {
    schemaVersion: suiteDiscoverySchemaVersion,
    directory: suiteDiscoveryDir(),
    sessionFile: join(suiteDiscoveryDir(), "session.json"),
    timelineFile: join(suiteDiscoveryDir(), "timeline.jsonl"),
  },
  session: readSuiteSessionDocument(),
  apps: vaexcoreSuiteAppDefinitions.map(suiteAppStatus),
  timeline: readSuiteTimelineEvents(50),
});

export const readSuiteTimelineEvents = (
  limit: number,
): SuiteTimelineEvent[] => {
  const path = join(suiteDiscoveryDir(), "timeline.jsonl");
  if (!existsSync(path)) {
    return [];
  }

  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as SuiteTimelineEvent;
      } catch {
        return null;
      }
    })
    .filter((item): item is SuiteTimelineEvent => Boolean(item))
    .slice(-limit)
    .reverse();
};

export const formatPlatformTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const escapeAttr = escapeHtml;

export type SuiteLaunchResult = {
  appName: string;
  ok: boolean;
  detail: string;
};

/* App launch boundary */
export const launchVaexcoreSuite = async () => {
  const results = await Promise.all(
    vaexcoreSuiteApps.map((appName) =>
      appName === "vaexcore console"
        ? Promise.resolve({
            appName,
            ok: true,
            detail: "vaexcore console is already running.",
          })
        : launchDesktopApp(appName),
    ),
  );

  appendSuiteTimelineEvent({
    sourceApp: "vaexcore-console",
    sourceAppName: "vaexcore console",
    kind: "suite.launch",
    title: "Console launched suite",
    detail: results.every((result) => result.ok)
      ? "Launch requested for Studio, Pulse, and Console."
      : "One or more suite apps could not be launched.",
    metadata: { results },
  });

  return {
    ok: results.every((result) => result.ok),
    results,
  };
};

export const launchDesktopApp = (
  appName: string,
): Promise<SuiteLaunchResult> => {
  if (process.platform === "darwin") {
    return launchMacApp(appName);
  }

  if (process.platform === "win32") {
    return launchWindowsApp(appName);
  }

  return Promise.resolve({
    appName,
    ok: false,
    detail: "Suite launching is supported on macOS and Windows desktop builds.",
  });
};

export const launchMacApp = (appName: string): Promise<SuiteLaunchResult> =>
  new Promise((resolveLaunch) => {
    const child = spawn("open", ["-a", appName], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolveLaunch({
        appName,
        ok: false,
        detail: safeErrorMessage(error, "Launch failed."),
      });
    });

    child.on("close", (code) => {
      resolveLaunch({
        appName,
        ok: code === 0,
        detail:
          code === 0
            ? "Launch requested."
            : stderr.trim() || `open exited with code ${code}.`,
      });
    });
  });

export const launchWindowsApp = (appName: string): Promise<SuiteLaunchResult> =>
  new Promise((resolveLaunch) => {
    const executable = windowsAppExecutablePath(appName);
    if (!executable) {
      resolveLaunch({
        appName,
        ok: false,
        detail: `Could not find ${appName}. Install it with the Windows installer or place it in a standard vaexcore install folder.`,
      });
      return;
    }

    const child = spawn(executable, [], {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolveLaunch({
        appName,
        ok: false,
        detail: safeErrorMessage(error, "Launch failed."),
      });
    });

    child.on("close", (code) => {
      resolveLaunch({
        appName,
        ok: code === 0,
        detail:
          code === 0
            ? `Launch requested from ${executable}.`
            : stderr.trim() || `start exited with code ${code}.`,
      });
    });
  });

/* Discovery runtime boundary */
export const startSuiteDiscoveryHeartbeat = (port: number) => {
  const startedAt = new Date().toISOString();
  const write = () => {
    try {
      writeSuiteDiscoveryDocument(port, startedAt);
    } catch (error) {
      logger.warn(
        { error: redactSecrets(error) },
        "Unable to write vaexcore console suite discovery",
      );
    }
  };

  write();
  return setInterval(write, suiteDiscoveryHeartbeatMs);
};

export const writeSuiteDiscoveryDocument = (
  port: number,
  startedAt: string,
) => {
  const apiUrl = `http://127.0.0.1:${port}`;
  const directory = suiteDiscoveryDir();
  const session = readSuiteSessionDocument();
  const document: SuiteDiscoveryDocument = {
    schemaVersion: SUITE_DISCOVERY_SCHEMA_VERSION,
    appId: CONSOLE_APP.id,
    appName: CONSOLE_APP.name,
    bundleIdentifier: CONSOLE_APP.bundleId,
    version: "0.1.2",
    pid: process.pid,
    startedAt,
    updatedAt: new Date().toISOString(),
    apiUrl,
    wsUrl: null,
    healthUrl: `${apiUrl}/api/status`,
    capabilities: [
      "console.setup",
      "twitch.operations",
      "studio.chat-markers",
      "studio.giveaway-event-markers",
      "suite.commands",
      "suite.launcher",
      "suite.timeline",
      "twitch.stream_key",
      "platform.local_page",
    ],
    launchName: CONSOLE_APP.launchName,
    suiteSessionId: session?.sessionId ?? null,
    activity: "live-ops",
    activityDetail: session
      ? `Monitoring chat operations for ${session.title}`
      : "Ready for chat and stream operations",
    localRuntime: buildConsoleLocalRuntime(apiUrl),
  };

  validateSuiteDiscoveryDocument(document);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, CONSOLE_APP.discoveryFile),
    `${JSON.stringify(document, null, 2)}\n`,
  );
};

/* Local runtime contract */
export const buildConsoleLocalRuntime = (
  apiUrl?: string,
): SuiteLocalRuntime => {
  const config = getSafeConfig();
  const databasePath = resolveDatabasePath(databaseUrl);
  const appStorageDir = dirname(getLocalSecretsPath());

  return {
    contractVersion: 1,
    mode: "local-first",
    state: "ready",
    appStorageDir,
    suiteDir: suiteDiscoveryDir(),
    secureStorage: "safeStorage+plaintext fallback",
    secretStorageState: "ready",
    durableStorage: [
      "SQLite state",
      "local secrets file",
      "redacted diagnostics",
    ],
    networkPolicy: "localhost-only",
    dependencies: [
      {
        name: "setup-server",
        kind: "local-http-service",
        state: apiUrl ? "reachable" : "running",
        detail: apiUrl
          ? `Operator API is bound to ${apiUrl}.`
          : "Operator API is running locally.",
      },
      {
        name: "sqlite",
        kind: "local-database",
        state: existsSync(databasePath) ? "ready" : "initializing",
        detail: databasePath,
      },
      {
        name: "twitch",
        kind: "network-platform",
        state:
          config.mode === "local" ? "offline-rehearsal" : "operator-controlled",
        detail:
          config.mode === "local"
            ? "Console is in local mode; Twitch is not required for rehearsal."
            : "Twitch is required only for live chat operations, not local setup or rehearsal.",
      },
    ],
  };
};

export const suiteDiscoveryDir = () => join(vaexcoreSharedDataDir(), "suite");

export const vaexcoreSharedDataDir = () => {
  if (process.platform === "win32") {
    return join(
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
      "vaexcore",
    );
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "vaexcore");
  }

  return join(
    process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
    "vaexcore",
  );
};

export const readSuiteSessionDocument = (): {
  sessionId: string;
  title: string;
} | null => {
  try {
    const parsed = JSON.parse(
      readFileSync(join(suiteDiscoveryDir(), "session.json"), "utf8"),
    );
    if (
      typeof parsed?.sessionId === "string" &&
      typeof parsed?.title === "string"
    ) {
      return { sessionId: parsed.sessionId, title: parsed.title };
    }
  } catch {
    return null;
  }
  return null;
};

export const suiteAppStatus = (
  definition: (typeof vaexcoreSuiteAppDefinitions)[number],
): SuiteAppStatus => {
  const discoveryFile = join(suiteDiscoveryDir(), `${definition.appId}.json`);
  const discovery = readSuiteDiscoveryDocument(discoveryFile);
  const installed = desktopAppIsInstalled(definition.launchName);
  const pid = typeof discovery?.pid === "number" ? discovery.pid : null;
  const running = typeof pid === "number" ? processIsRunning(pid) : false;
  const stale = suiteDiscoveryIsStale(discoveryFile);
  const reachable = running && !stale && Boolean(discovery?.healthUrl);

  return {
    appId: definition.appId,
    appName: discovery?.appName || definition.appName,
    launchName: definition.launchName,
    bundleIdentifier: definition.bundleIdentifier,
    installed,
    running,
    reachable,
    stale,
    discoveryFile,
    pid,
    apiUrl: discovery?.apiUrl ?? null,
    healthUrl: discovery?.healthUrl ?? null,
    updatedAt: discovery?.updatedAt ?? null,
    capabilities: Array.isArray(discovery?.capabilities)
      ? discovery.capabilities
      : [],
    suiteSessionId: discovery?.suiteSessionId ?? null,
    activity: discovery?.activity ?? null,
    activityDetail: discovery?.activityDetail ?? null,
    localRuntime: discovery?.localRuntime ?? null,
    detail: suiteStatusDetail(
      installed,
      Boolean(discovery),
      running,
      stale,
      reachable,
    ),
  };
};

export const readSuiteDiscoveryDocument = (
  path: string,
): SuiteDiscoveryDocument | null => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SuiteDiscoveryDocument;
  } catch {
    return null;
  }
};

export const suiteDiscoveryIsStale = (path: string) => {
  try {
    return Date.now() - statSync(path).mtimeMs > 45_000;
  } catch {
    return true;
  }
};

export const processIsRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const suiteStatusDetail = (
  installed: boolean,
  discovered: boolean,
  running: boolean,
  stale: boolean,
  reachable: boolean,
) => {
  if (!installed) {
    return platformInstallHint();
  }
  if (!discovered) {
    return "No suite heartbeat has been published yet.";
  }
  if (!running) {
    return "Heartbeat exists, but the app process is not running.";
  }
  if (stale) {
    return "The suite heartbeat is stale.";
  }
  if (!reachable) {
    return "The app is running, but its local health endpoint is not reachable yet.";
  }
  return "Ready.";
};

export const desktopAppIsInstalled = (appName: string) => {
  if (process.platform === "darwin") {
    return existsSync(join("/Applications", `${appName}.app`));
  }

  if (process.platform === "win32") {
    return Boolean(windowsAppExecutablePath(appName));
  }

  return false;
};

export const platformInstallHint = () => {
  if (process.platform === "win32") {
    return "Install this app with the Windows installer or keep the portable executable in a standard vaexcore install folder.";
  }

  if (process.platform === "darwin") {
    return "Install this app in /Applications.";
  }

  return "Install this app in the platform app folder.";
};

export const windowsAppExecutablePath = (appName: string) => {
  if (process.platform !== "win32") {
    return undefined;
  }

  const executableNames = windowsAppExecutableNames(appName);
  const currentExecutable = process.argv[0];
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const localAppDataRoots = [
    process.env.LOCALAPPDATA,
    join(homedir(), "AppData", "Local"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const candidates = [
    ...localAppDataRoots.flatMap((root) =>
      executableNames.flatMap((exeName) => [
        join(root, appName, exeName),
        join(root, "Programs", appName, exeName),
      ]),
    ),
    programFiles
      ? executableNames.map((exeName) => join(programFiles, appName, exeName))
      : [],
    programFilesX86
      ? executableNames.map((exeName) =>
          join(programFilesX86, appName, exeName),
        )
      : [],
    currentExecutable &&
    executableNames.some(
      (exeName) =>
        basename(currentExecutable).toLowerCase() === exeName.toLowerCase(),
    )
      ? currentExecutable
      : undefined,
  ]
    .flat()
    .filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => existsSync(candidate));
};

export const windowsAppExecutableNames = (appName: string) => {
  switch (appName) {
    case "vaexcore studio":
      return ["vaexcore-studio.exe"];
    case "vaexcore pulse":
      return ["vaexcore-pulse.exe"];
    case "vaexcore console":
      return ["vaexcore-console.exe"];
    default:
      return [`${appName}.exe`];
  }
};

/* Command polling boundary */
export const startSuiteCommandPoller = () => {
  const read = () => {
    try {
      consumeSuiteCommands();
    } catch (error) {
      logger.warn(
        { error: redactSecrets(error) },
        "Unable to consume vaexcore console suite commands",
      );
    }
  };

  read();
  return setInterval(read, 2500);
};

export const consumeSuiteCommands = () => {
  const directory = join(suiteDiscoveryDir(), "commands", "vaexcore-console");
  if (!existsSync(directory)) {
    return;
  }

  for (const fileName of readdirSync(directory).filter((file) =>
    file.endsWith(".json"),
  )) {
    const path = join(directory, fileName);
    let command: SuiteCommandDocument;
    try {
      command = JSON.parse(readFileSync(path, "utf8")) as SuiteCommandDocument;
    } catch (error) {
      logger.warn(
        { error: redactSecrets(error), fileName },
        "Skipping unreadable vaexcore console suite command",
      );
      continue;
    }
    try {
      validateSuiteCommandDocument(command);
      unlinkSync(path);
    } catch (error) {
      logger.warn(
        { error: redactSecrets(error), fileName },
        "Skipping invalid vaexcore console suite command",
      );
      unlinkSync(path);
      continue;
    }

    appendSuiteTimelineEvent({
      sourceApp: "vaexcore-console",
      sourceAppName: "vaexcore console",
      kind: "suite.command",
      title: "Console consumed suite command",
      detail: command.command
        ? `Handled ${command.command} from ${command.sourceAppName ?? "another suite app"}.`
        : `Handled a suite command from ${command.sourceAppName ?? "another suite app"}.`,
      metadata: {
        commandId: command.commandId ?? null,
        command: command.command ?? null,
        sourceAppName: command.sourceAppName ?? null,
      },
    });

    if (command.command === "focus-ops") {
      logger.info(
        {
          commandId: command.commandId,
          sourceAppName: command.sourceAppName,
        },
        "Received suite focus request for vaexcore console",
      );
    }
  }
};
