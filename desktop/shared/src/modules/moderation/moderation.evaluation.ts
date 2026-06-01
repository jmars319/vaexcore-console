import type { ChatMessage } from "../../core/chatMessage";
import { getProtectedCommandNames } from "../../core/protectedCommands";
import { sanitizeText } from "../../core/security";
import { scoreBotShieldMessage, botShieldDetail } from "./moderation.botShield";
import {
  countRecentModerationHitsForUser,
  recordModerationHit,
} from "./moderation.hits";
import {
  enabledModerationAllowedLinks,
  enabledModerationBlockedLinks,
  inspectModerationLinks,
} from "./moderation.links";
import {
  isExcessiveCaps,
  isExcessiveSymbols,
  matchBlockedTerm,
  normalizeRepeatText,
  renderWarning,
  userKey,
  unique,
} from "./moderation.normalization";
import { getModerationSettings } from "./moderation.settings";
import { isSilentBotShieldHit, strongestAction } from "./moderation.summary";
import { enabledModerationTerms } from "./moderation.terms";
import {
  moderationLimits,
  type ChatterContext,
  type ModerationAction,
  type ModerationEvaluation,
  type ModerationFilterType,
  type ModerationServiceContext,
  type ModerationSettings,
} from "./moderation.types";

type ModerationMatch = {
  type: ModerationFilterType;
  action: ModerationAction;
  detail: string;
};

export const evaluateModerationMessage = (
  context: ModerationServiceContext,
  message: ChatMessage,
  options: { record?: boolean; consumePermits?: boolean } = {},
): ModerationEvaluation => {
  const gate = context.options.featureGates.describeAccess(
    "moderation_filters",
    message.source,
  );

  if (!gate.allowed) {
    return { ok: true, skipped: true, reason: gate.reason };
  }

  if (isExemptCommand(context, message.text)) {
    trackModerationChatMemory(context, message);
    return {
      ok: true,
      skipped: true,
      reason: "Protected command or giveaway entry is exempt.",
    };
  }

  const settings = getModerationSettings(context);

  if (isExemptRole(message, settings)) {
    trackModerationChatMemory(context, message);
    return {
      ok: true,
      skipped: true,
      reason: "Trusted chat role is exempt from moderation filters.",
    };
  }

  const chatterContext = getChatterContext(context, message, settings);
  const { matches, allowedLinks, consumedPermit, botShield } = findMatches(
    context,
    message,
    settings,
    options,
    chatterContext,
  );

  trackModerationChatMemory(context, message);

  if (matches.length === 0) {
    return {
      ok: true,
      allowedLinks: allowedLinks.length ? allowedLinks : undefined,
      botShield,
      consumedPermit,
    };
  }

  const filterActions = matches.map((match) => ({
    filterType: match.type,
    action: match.action,
  }));
  const baseAction = strongestAction(
    filterActions.map((match) => match.action),
  );
  const escalation = resolveEscalation(context, message, settings, baseAction);
  const action = escalation.action;
  const detailParts = matches.map((match) => match.detail);

  if (escalation.applied) {
    detailParts.push(escalation.reason);
  }

  const silent = isSilentBotShieldHit(matches, action, escalation.applied);
  if (botShield) {
    botShield.silent = silent;
  }

  const detail = sanitizeText(detailParts.join("; "), {
    field: "Moderation detail",
    maxLength: moderationLimits.detailLength,
  });
  const warningMessage = renderWarning(
    settings.warningMessage,
    message,
    detail,
  );

  if (options.record !== false) {
    recordModerationHit(
      context,
      message,
      matches.map((match) => match.type),
      action,
      detail,
      warningMessage,
    );
  }

  return {
    ok: true,
    allowedLinks: allowedLinks.length ? allowedLinks : undefined,
    botShield,
    consumedPermit,
    hit: {
      filterTypes: matches.map((match) => match.type),
      action,
      filterActions,
      matches: matches.map((match) => ({
        filterType: match.type,
        action: match.action,
        detail: match.detail,
      })),
      escalation: escalation.applied
        ? {
            hitsInWindow: escalation.hitsInWindow,
            windowSeconds: settings.escalationWindowSeconds,
            action,
            reason: escalation.reason,
          }
        : undefined,
      detail,
      warningMessage,
      silent,
      timeoutSeconds:
        action === "timeout" ? settings.timeoutSeconds : undefined,
    },
  };
};

const findMatches = (
  context: ModerationServiceContext,
  message: ChatMessage,
  settings: ModerationSettings,
  options: { consumePermits?: boolean },
  chatterContext: ChatterContext,
) => {
  const text = message.text.trim();
  const matches: ModerationMatch[] = [];
  const allowedLinks: string[] = [];
  let consumedPermit: ModerationEvaluation["consumedPermit"] | undefined;
  let botShield: ModerationEvaluation["botShield"] | undefined;

  if (settings.blockedTermsEnabled) {
    const term = enabledModerationTerms(context)
      .map((entry) => matchBlockedTerm(text, entry.term))
      .find((entry) => Boolean(entry));

    if (term) {
      matches.push({
        type: "blocked_term",
        action: settings.blockedTermsAction,
        detail: `blocked phrase: ${term.term} (${term.mode})`,
      });
    }
  }

  if (settings.linkFilterEnabled) {
    const linkResult = inspectModerationLinks(
      context,
      message,
      options.consumePermits !== false,
    );
    allowedLinks.push(...linkResult.allowed);
    consumedPermit = linkResult.consumedPermit;

    if (linkResult.blocked.length) {
      matches.push({
        type: "link",
        action: settings.linkFilterAction,
        detail: linkResult.explicitBlocked.length
          ? `blocked domain: ${linkResult.explicitBlocked.join(", ")}`
          : `link detected: ${linkResult.blocked.join(", ")}`,
      });
    }
  }

  if (settings.capsFilterEnabled && isExcessiveCaps(text, settings)) {
    matches.push({
      type: "caps",
      action: settings.capsFilterAction,
      detail: "excessive caps",
    });
  }

  if (
    settings.repeatFilterEnabled &&
    isRepeatedMessage(context, message, settings)
  ) {
    matches.push({
      type: "repeat",
      action: settings.repeatFilterAction,
      detail: "repeated message",
    });
  }

  if (settings.symbolFilterEnabled && isExcessiveSymbols(text, settings)) {
    matches.push({
      type: "symbols",
      action: settings.symbolFilterAction,
      detail: "excessive symbols",
    });
  }

  if (settings.botShieldEnabled) {
    const botShieldScore = scoreBotShieldMessage(message, {
      allowedDomains: enabledModerationAllowedLinks(context).map(
        (entry) => entry.domain,
      ),
      blockedDomains: enabledModerationBlockedLinks(context).map(
        (entry) => entry.domain,
      ),
      chatterContext,
    });
    botShield = {
      score: botShieldScore.score,
      threshold: settings.botShieldScoreThreshold,
      reasons: botShieldScore.reasons,
      firstTimeChatter: chatterContext.firstTimeChatter,
      silent: false,
    };

    if (botShield.score >= settings.botShieldScoreThreshold) {
      const botShieldMatch = {
        type: "bot_shield" as const,
        action: settings.botShieldAction,
        detail: botShieldDetail(botShield),
      };
      botShield.silent = isSilentBotShieldHit(
        [botShieldMatch],
        settings.botShieldAction,
        false,
      );
      matches.push(botShieldMatch);
    }
  }

  return { matches, allowedLinks, consumedPermit, botShield };
};

const resolveEscalation = (
  context: ModerationServiceContext,
  message: ChatMessage,
  settings: ModerationSettings,
  baseAction: ModerationAction,
) => {
  if (!settings.escalationEnabled) {
    return {
      action: baseAction,
      applied: false,
      hitsInWindow: 0,
      reason: "",
    };
  }

  const hitsInWindow =
    countRecentModerationHitsForUser(
      context,
      message,
      settings.escalationWindowSeconds,
    ) + 1;
  const escalationAction =
    hitsInWindow >= settings.escalationTimeoutAfter
      ? "timeout"
      : hitsInWindow >= settings.escalationDeleteAfter
        ? "delete"
        : undefined;
  const action = escalationAction
    ? strongestAction([baseAction, escalationAction])
    : baseAction;
  const applied = action !== baseAction;

  return {
    action,
    applied,
    hitsInWindow,
    reason: applied
      ? `escalated to ${action}: ${hitsInWindow} hits in ${settings.escalationWindowSeconds}s`
      : "",
  };
};

const isRepeatedMessage = (
  context: ModerationServiceContext,
  message: ChatMessage,
  settings: ModerationSettings,
) => {
  const normalizedText = normalizeRepeatText(message.text);

  if (!normalizedText) {
    return false;
  }

  const now = Date.now();
  const cutoff = now - settings.repeatWindowSeconds * 1000;
  const entries = (context.recentByUser.get(userKey(message)) ?? []).filter(
    (entry) => entry.at >= cutoff,
  );
  const repeats = entries.filter(
    (entry) => entry.normalizedText === normalizedText,
  ).length;

  return repeats + 1 >= settings.repeatLimit;
};

const getChatterContext = (
  context: ModerationServiceContext,
  message: ChatMessage,
  settings: ModerationSettings,
): ChatterContext => {
  const normalizedText = normalizeRepeatText(message.text);
  const now = Date.now();
  const key = userKey(message);
  const userEntries = (context.recentByUser.get(key) ?? []).filter(
    (entry) => entry.at >= now - settings.repeatWindowSeconds * 1000,
  );
  const sameUserRepeatCount = normalizedText
    ? userEntries.filter((entry) => entry.normalizedText === normalizedText)
        .length
    : 0;
  const rapidUserMessageCount = userEntries.filter(
    (entry) => entry.at >= now - 10_000,
  ).length;
  const globalCopyPasteUserCount = normalizedText
    ? unique(
        context.recentGlobal
          .filter(
            (entry) =>
              entry.userKey !== key &&
              entry.normalizedText === normalizedText &&
              entry.at >= now - 120_000,
          )
          .map((entry) => entry.userKey),
      ).length
    : 0;

  return {
    firstTimeChatter:
      message.badges.includes("first-msg") || !context.seenUserKeys.has(key),
    sameUserRepeatCount,
    rapidUserMessageCount,
    globalCopyPasteUserCount,
  };
};

const trackModerationChatMemory = (
  context: ModerationServiceContext,
  message: ChatMessage,
) => {
  context.seenUserKeys.add(userKey(message));
  const normalizedText = normalizeRepeatText(message.text);

  if (!normalizedText) {
    return;
  }

  const entry = {
    normalizedText,
    userKey: userKey(message),
    at: Date.now(),
  };
  const entries = context.recentByUser.get(userKey(message)) ?? [];
  entries.push(entry);
  context.recentByUser.set(
    userKey(message),
    entries.slice(-moderationLimits.repeatMemoryMax),
  );
  context.recentGlobal.push(entry);
  context.recentGlobal = context.recentGlobal.slice(
    -moderationLimits.globalRepeatMemoryMax,
  );
};

const isExemptRole = (message: ChatMessage, settings: ModerationSettings) => {
  if (message.isBroadcaster && settings.exemptBroadcaster) {
    return true;
  }

  if (message.isMod && settings.exemptModerators) {
    return true;
  }

  if (message.isVip && settings.exemptVips) {
    return true;
  }

  return message.isSubscriber && settings.exemptSubscribers;
};

const isExemptCommand = (context: ModerationServiceContext, text: string) => {
  const prefix = context.options.commandPrefix ?? "!";
  const trimmed = text.trim();

  if (!trimmed.startsWith(prefix)) {
    return false;
  }

  const command = trimmed.slice(prefix.length).split(/\s+/)[0]?.toLowerCase();

  if (!command) {
    return false;
  }

  const exempt = new Set([
    ...getProtectedCommandNames(),
    ...(context.options.exemptCommandNames?.() ?? []).map((item) =>
      item.toLowerCase(),
    ),
  ]);

  return exempt.has(command);
};
