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
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  giveawayOverlayHtml,
  redirect,
  sendHtml,
  sendPlatformHtml,
  sendStaticUiAsset,
  sendText,
  setupShellHtml,
  getSetupUiDir,
  resolveSetupUiAssetPath,
  securityHeaders,
} from "./staticUi";

export const readJson = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;

    if (totalBytes > limits.requestBodyBytes) {
      throw new Error("Request body is too large.");
    }

    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
};

export const sendJson = (
  response: ServerResponse,
  status: number,
  body: unknown,
) => {
  response.writeHead(status, {
    ...securityHeaders,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
};

export const isLocalRequest = (request: IncomingMessage) => {
  const remote = request.socket.remoteAddress;
  return (
    remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1"
  );
};

export const isAllowedHost = (hostHeader: string | undefined) => {
  if (!hostHeader) {
    return true;
  }

  const hostName = hostHeader.split(":")[0]?.replace(/^\[|\]$/g, "");
  return (
    hostName === "localhost" || hostName === "127.0.0.1" || hostName === "::1"
  );
};
