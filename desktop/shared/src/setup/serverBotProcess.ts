import {
  MessageQueue,
  type MessageQueueEventStatus,
  type MessageQueueMetadata,
} from "../core/messageQueue";
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
  classifyOutboundMessage,
  createOutboundHistory,
  isOutboundCategory,
  isOutboundFailureCategory,
  isOutboundImportance,
  isPendingOutboundStatus,
  type OutboundMessageRecord,
} from "../core/outboundHistory";
import {
  defaultRedirectUri,
  getLocalSecretsPath,
  readLocalSecrets,
  writeLocalSecrets,
  type LocalSecrets,
} from "../config/localSecrets";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { getDiagnosticsReport } from "./serverDiagnostics";
import { parseOptionalNumber } from "./serverOperatorConfig";
import { validateSetup } from "./serverSetupStatus";
import {
  botProcess,
  chatQueue,
  databaseUrl,
  outboundHistory,
} from "./serverState";

export type BotProcessState = {
  child: ChildProcess | undefined;
  status: "stopped" | "starting" | "running" | "stopping" | "exited" | "failed";
  pid: number | undefined;
  startedAt: string;
  stoppedAt: string;
  exitCode: number | null | undefined;
  signal: NodeJS.Signals | string | null | undefined;
  eventSubConnected: boolean;
  chatSubscriptionActive: boolean;
  liveChatConfirmed: boolean;
  lastError: string;
  recentLogs: string[];
  stdoutBuffer: string;
  stderrBuffer: string;
};

export function createBotProcessState(): BotProcessState {
  return {
    child: undefined,
    status: "stopped",
    pid: undefined,
    startedAt: "",
    stoppedAt: "",
    exitCode: undefined,
    signal: undefined,
    eventSubConnected: false,
    chatSubscriptionActive: false,
    liveChatConfirmed: false,
    lastError: "",
    recentLogs: [],
    stdoutBuffer: "",
    stderrBuffer: "",
  };
}

export const startBotProcess = async () => {
  if (botProcess.child && !botProcess.child.killed) {
    return {
      ok: true,
      alreadyRunning: true,
      botProcess: getBotProcessSnapshot(),
    };
  }

  const validation = await validateSetup();
  const startReadiness = getBotStartReadiness(validation.checks);

  if (!validation.ok || !startReadiness.ok) {
    const failed = startReadiness.checks.find((check) => !check.ok);
    return {
      ok: false,
      error:
        failed?.detail ||
        "Resolve readiness blockers before starting the live bot.",
      nextAction:
        failed?.detail ||
        "Let automatic launch validation complete before starting the bot.",
      checks: startReadiness.checks,
      diagnostics: getDiagnosticsReport(),
      botProcess: getBotProcessSnapshot(),
    };
  }

  let command: ReturnType<typeof getBotRuntimeCommand>;

  try {
    command = getBotRuntimeCommand();
  } catch (error) {
    const detail = safeErrorMessage(
      error,
      "Unable to find vaexcore console live bot entrypoint.",
    );
    return {
      ok: false,
      error: detail,
      nextAction: "Run npm run build, then try Start Bot again.",
      checks: [
        ...startReadiness.checks,
        { name: "Bot runtime entrypoint", ok: false, detail },
      ],
      diagnostics: getDiagnosticsReport(),
      botProcess: getBotProcessSnapshot(),
    };
  }

  resetBotProcessForStart();

  const child = spawn(command.executable, command.args, {
    cwd: command.cwd,
    env: getBotRuntimeEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });

  botProcess.child = child;
  botProcess.pid = child.pid;
  botProcess.status = "starting";
  appendBotLog("system", `Starting live bot process: ${command.display}`);

  child.stdout.on("data", (chunk: Buffer) => handleBotOutput("stdout", chunk));
  child.stderr.on("data", (chunk: Buffer) => handleBotOutput("stderr", chunk));
  child.once("spawn", () => {
    botProcess.status = "running";
  });
  child.once("error", (error) => {
    botProcess.status = "failed";
    botProcess.lastError = safeErrorMessage(
      error,
      "Bot process failed to start.",
    );
    appendBotLog("error", botProcess.lastError);
  });
  child.once("exit", (code, signal) => {
    flushBotOutput();
    botProcess.child = undefined;
    botProcess.pid = undefined;
    botProcess.stoppedAt = new Date().toISOString();
    botProcess.exitCode = code;
    botProcess.signal = signal;
    botProcess.eventSubConnected = false;
    botProcess.chatSubscriptionActive = false;
    botProcess.status =
      botProcess.status === "stopping"
        ? "stopped"
        : code === 0
          ? "exited"
          : "failed";
    if (code !== 0 && botProcess.status === "failed") {
      botProcess.lastError = `Bot process exited with code ${code ?? "unknown"}.`;
    }
    appendBotLog("system", `Live bot process ${botProcess.status}.`);
  });

  return {
    ok: true,
    started: true,
    nextAction: "Wait for EventSub, then type !ping in Twitch chat.",
    checks: startReadiness.checks,
    botProcess: getBotProcessSnapshot(),
  };
};

export const getBotStartReadiness = (
  validationChecks: Array<{ name: string; ok: boolean; detail: string }>,
) => {
  const queue = chatQueue.snapshot();
  const checks = [
    ...validationChecks,
    {
      name: "Outbound queue",
      ok: queue.ready,
      detail: queue.ready
        ? "Outbound queue is ready."
        : "Restart the setup console if queue readiness does not recover.",
    },
  ];

  return {
    ok: checks.every((check) => check.ok),
    checks,
  };
};

export const stopBotProcess = async (options: { force?: boolean } = {}) => {
  const child = botProcess.child;

  if (!child) {
    return {
      ok: true,
      alreadyStopped: true,
      botProcess: getBotProcessSnapshot(),
    };
  }

  botProcess.status = "stopping";
  appendBotLog("system", "Stopping live bot process.");
  child.kill("SIGTERM");

  const stopped = await waitForBotExit(child, options.force ? 1500 : 10000);

  if (!stopped && options.force) {
    child.kill("SIGKILL");
    await waitForBotExit(child, 1500);
  }

  return { ok: true, stopped: true, botProcess: getBotProcessSnapshot() };
};

export const waitForBotExit = (child: ChildProcess, timeoutMs: number) =>
  new Promise<boolean>((resolve) => {
    if (!botProcess.child || botProcess.child !== child) {
      resolve(true);
      return;
    }

    const timeout = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });

export const resetBotProcessForStart = () => {
  botProcess.status = "starting";
  botProcess.pid = undefined;
  botProcess.startedAt = new Date().toISOString();
  botProcess.stoppedAt = "";
  botProcess.exitCode = undefined;
  botProcess.signal = undefined;
  botProcess.eventSubConnected = false;
  botProcess.chatSubscriptionActive = false;
  botProcess.liveChatConfirmed = false;
  botProcess.lastError = "";
  botProcess.recentLogs = [];
  botProcess.stdoutBuffer = "";
  botProcess.stderrBuffer = "";
};

export const getBotProcessSnapshot = () => ({
  status: botProcess.status,
  running: Boolean(botProcess.child),
  pid: botProcess.pid,
  startedAt: botProcess.startedAt,
  stoppedAt: botProcess.stoppedAt,
  exitCode: botProcess.exitCode,
  signal: botProcess.signal,
  eventSubConnected: botProcess.eventSubConnected,
  chatSubscriptionActive: botProcess.chatSubscriptionActive,
  liveChatConfirmed: botProcess.liveChatConfirmed,
  lastError: botProcess.lastError,
  recentLogs: botProcess.recentLogs.slice(-20),
});

export const getBotRuntimeCommand = () => {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const sharedRoot = resolve(currentDir, "../..");
  const sourceRoot = resolve(sharedRoot, "../..");
  const bundledRoot = resolve(currentDir, "..");
  const sourceIndex = join(sharedRoot, "src/index.ts");
  const tsxCli = join(sourceRoot, "node_modules/tsx/dist/cli.mjs");
  const bundledIndex = join(currentDir, "live-bot.js");

  if (
    currentDir.endsWith(join("src", "setup")) &&
    existsSync(sourceIndex) &&
    existsSync(tsxCli)
  ) {
    return {
      executable: process.execPath,
      args: [tsxCli, "desktop/shared/src/index.ts"],
      cwd: sourceRoot,
      display: "tsx desktop/shared/src/index.ts",
    };
  }

  if (existsSync(bundledIndex)) {
    return {
      executable: process.execPath,
      args: [bundledIndex],
      cwd: bundledRoot,
      display: "node dist-bundle/live-bot.js",
    };
  }

  if (existsSync(sourceIndex) && existsSync(tsxCli)) {
    return {
      executable: process.execPath,
      args: [tsxCli, "desktop/shared/src/index.ts"],
      cwd: sourceRoot,
      display: "tsx desktop/shared/src/index.ts",
    };
  }

  throw new Error("Unable to find vaexcore console live bot entrypoint.");
};

export const getBotRuntimeEnv = () => {
  const configDir = dirname(getLocalSecretsPath());
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VAEXCORE_MODE: "live",
    VAEXCORE_CONFIG_DIR: configDir,
    DATABASE_URL: databaseUrl,
  };

  if (process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = "1";
  } else {
    delete env.ELECTRON_RUN_AS_NODE;
  }

  return env;
};

export const handleBotOutput = (stream: "stdout" | "stderr", chunk: Buffer) => {
  const key = stream === "stdout" ? "stdoutBuffer" : "stderrBuffer";
  botProcess[key] += chunk.toString("utf8");
  const parts = botProcess[key].split(/\r?\n/);
  botProcess[key] = parts.pop() ?? "";

  for (const line of parts) {
    processBotLog(stream, line);
  }
};

export const flushBotOutput = () => {
  if (botProcess.stdoutBuffer) {
    processBotLog("stdout", botProcess.stdoutBuffer);
    botProcess.stdoutBuffer = "";
  }
  if (botProcess.stderrBuffer) {
    processBotLog("stderr", botProcess.stderrBuffer);
    botProcess.stderrBuffer = "";
  }
};

export const processBotLog = (
  stream: "stdout" | "stderr" | "system" | "error",
  rawLine: string,
) => {
  const line = rawLine.trim();
  if (!line) return;

  updateBotStatusFromLog(line);
  appendBotLog(stream, line);
};

export const appendBotLog = (stream: string, line: string) => {
  const safeLine = redactSecretText(line);
  botProcess.recentLogs.push(
    `${new Date().toISOString()} ${stream}: ${safeLine}`,
  );

  if (botProcess.recentLogs.length > 100) {
    botProcess.recentLogs.splice(0, botProcess.recentLogs.length - 100);
  }
};

export const updateBotStatusFromLog = (line: string) => {
  try {
    const parsed = JSON.parse(line) as {
      msg?: string;
      operatorEvent?: string;
      code?: number;
      reason?: unknown;
      message?: unknown;
      outboundMessageId?: unknown;
      outboundStatus?: unknown;
      attempts?: unknown;
      attempt?: unknown;
      queued?: unknown;
      outboundCategory?: unknown;
      outboundAction?: unknown;
      outboundImportance?: unknown;
      failureCategory?: unknown;
      retryAfterMs?: unknown;
      nextAttemptAt?: unknown;
      giveawayId?: unknown;
      resentFrom?: unknown;
    };
    const msg = parsed.msg ?? "";
    const operatorEvent = parsed.operatorEvent ?? "";

    const outboundMessageId =
      typeof parsed.outboundMessageId === "string"
        ? parsed.outboundMessageId
        : "";
    const outboundStatus =
      typeof parsed.outboundStatus === "string" &&
      isOutboundStatus(parsed.outboundStatus)
        ? parsed.outboundStatus
        : undefined;

    if (outboundMessageId && outboundStatus) {
      outboundHistory.record({
        id: outboundMessageId,
        source: "bot",
        status: outboundStatus,
        message:
          typeof parsed.message === "string" ? parsed.message : undefined,
        attempts: parseOptionalNumber(parsed.attempts ?? parsed.attempt),
        reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
        failureCategory:
          typeof parsed.failureCategory === "string" &&
          isOutboundFailureCategory(parsed.failureCategory)
            ? parsed.failureCategory
            : undefined,
        retryAfterMs: parseOptionalNumber(parsed.retryAfterMs),
        nextAttemptAt:
          typeof parsed.nextAttemptAt === "string"
            ? parsed.nextAttemptAt
            : undefined,
        queueDepth: parseOptionalNumber(parsed.queued),
        metadata: {
          category:
            typeof parsed.outboundCategory === "string" &&
            isOutboundCategory(parsed.outboundCategory)
              ? parsed.outboundCategory
              : undefined,
          action:
            typeof parsed.outboundAction === "string"
              ? parsed.outboundAction
              : undefined,
          importance:
            typeof parsed.outboundImportance === "string" &&
            isOutboundImportance(parsed.outboundImportance)
              ? parsed.outboundImportance
              : undefined,
          giveawayId: parseOptionalNumber(parsed.giveawayId),
          resentFrom:
            typeof parsed.resentFrom === "string"
              ? parsed.resentFrom
              : undefined,
        },
      });
    }

    if (
      msg === "EventSub WebSocket opened" ||
      msg === "Startup checklist: EventSub connected"
    ) {
      botProcess.eventSubConnected = true;
    }
    if (
      operatorEvent === "chat subscription created" ||
      msg === "Startup checklist: chat subscription created"
    ) {
      botProcess.chatSubscriptionActive = true;
    }
    if (msg === "LIVE CHAT CONFIRMED") {
      botProcess.liveChatConfirmed = true;
    }
    if (msg === "EventSub WebSocket closed") {
      botProcess.eventSubConnected = false;
      botProcess.chatSubscriptionActive = false;
    }
    if (line.includes("failed") || line.includes("error")) {
      botProcess.lastError = msg || line;
    }
  } catch {
    if (line.includes("LIVE CHAT CONFIRMED")) {
      botProcess.liveChatConfirmed = true;
    }
  }
};

export const isOutboundStatus = (
  value: string,
): value is MessageQueueEventStatus =>
  ["queued", "sending", "retrying", "sent", "failed"].includes(value);
