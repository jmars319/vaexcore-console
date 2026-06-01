import type { ChatMessage } from "../../core/chatMessage";
import {
  domainMatchesAllowed,
  findLinkDomains,
  unique,
} from "./moderation.normalization";
import {
  moderationLimits,
  type ChatterContext,
  type ModerationEvaluation,
} from "./moderation.types";

type BotShieldScore = {
  score: number;
  reasons: string[];
};

const botShieldHighConfidencePatterns = [
  /\bwant\s+to\s+(?:become|get)\s+famous\b/i,
  /\b(?:buy|cheap|free|get|boost|increase)\s+(?:twitch\s+)?(?:followers?|viewers?|views?|subs?)\b/i,
  /\b(?:followers?|viewers?|views?|subs?)\s+(?:for|at|from)\s+(?:cheap|free|sale|low\s+price)\b/i,
  /\bgrow\s+your\s+channel\b/i,
];

const botShieldPromoObjectPattern =
  /\b(?:followers?|viewers?|views?|subs?|chatters?)\b/i;
const botShieldPromoActionPattern =
  /\b(?:buy|cheap|free|boost|increase|promot(?:e|ion)|famous|viral|grow)\b/i;
const botShieldOffPlatformPattern =
  /\b(?:telegram|whatsapp|discord|dm\s+me)\b/i;
const botShieldRaidFriendlyPattern =
  /\b(?:raid|raiders?|raiding|from\s+\w{3,25}|welcome\s+in|hype|lets?\s+go|ggs?|pog)\b/i;
const botShieldShortenerDomains = new Set([
  "bit.ly",
  "buff.ly",
  "cutt.ly",
  "goo.gl",
  "is.gd",
  "lnkd.in",
  "ow.ly",
  "rb.gy",
  "rebrand.ly",
  "shorturl.at",
  "t.co",
  "tinyurl.com",
]);

export const scoreBotShieldMessage = (
  message: ChatMessage,
  options: {
    allowedDomains: string[];
    blockedDomains: string[];
    chatterContext: ChatterContext;
  },
): BotShieldScore => {
  const text = message.text.trim();
  const lower = text.toLowerCase();
  const domains = unique(findLinkDomains(text));
  const blockedDomains = domains.filter((domain) =>
    options.blockedDomains.some((entry) => domainMatchesAllowed(domain, entry)),
  );
  const allowedDomains = domains.filter(
    (domain) =>
      !blockedDomains.includes(domain) &&
      options.allowedDomains.some((entry) =>
        domainMatchesAllowed(domain, entry),
      ),
  );
  const untrustedDomains = domains.filter(
    (domain) =>
      !allowedDomains.includes(domain) && !blockedDomains.includes(domain),
  );
  const riskyDomains = unique([...blockedDomains, ...untrustedDomains]);
  const highConfidenceMatches = botShieldHighConfidencePatterns.filter(
    (pattern) => pattern.test(lower),
  ).length;
  const hasPromoPair =
    botShieldPromoObjectPattern.test(lower) &&
    botShieldPromoActionPattern.test(lower);
  const raidFriendly = isRaidFriendlyMessage(text, {
    domains,
    highConfidenceMatches,
    hasPromoPair,
  });
  let score = 0;
  const reasons: string[] = raidFriendly ? ["raid-friendly chatter"] : [];
  const add = (points: number, reason: string) => {
    score += points;
    if (!reasons.includes(reason)) {
      reasons.push(reason);
    }
  };

  if (blockedDomains.length) {
    add(60, `blocked link domain ${shortDomainList(blockedDomains)}`);
  }

  if (untrustedDomains.length) {
    add(20, `untrusted link ${shortDomainList(untrustedDomains)}`);
  }

  if (riskyDomains.length > 1) {
    add(15, "multiple risky links");
  }

  if (riskyDomains.some(isShortenerDomain)) {
    add(15, "link shortener");
  }

  if (riskyDomains.some(isLikelyPromoDomain)) {
    add(40, "promo-looking domain");
  }

  if (highConfidenceMatches > 0) {
    add(
      highConfidenceMatches > 1 ? 65 : 55,
      "known follower/viewer spam wording",
    );
  } else if (hasPromoPair) {
    add(35, "follower/viewer promotion wording");
  }

  if (hasPromoPair && riskyDomains.length) {
    add(15, "promotion paired with link");
  }

  if (hasPromoPair && botShieldOffPlatformPattern.test(lower)) {
    add(10, "off-platform promotion wording");
  }

  if (riskyDomains.length && text.length > 160) {
    add(10, "long linked promo message");
  }

  if (options.chatterContext.sameUserRepeatCount >= 2) {
    add(70, "rate-limited repeated message");
  } else if (
    options.chatterContext.sameUserRepeatCount === 1 &&
    !raidFriendly
  ) {
    add(35, "rapid repeated message");
  }

  if (options.chatterContext.rapidUserMessageCount >= 5 && !raidFriendly) {
    add(35, "rapid message burst");
  }

  if (options.chatterContext.globalCopyPasteUserCount >= 2 && !raidFriendly) {
    add(60, "copy/paste pattern across chat");
  }

  if (
    options.chatterContext.firstTimeChatter &&
    (riskyDomains.length ||
      highConfidenceMatches > 0 ||
      hasPromoPair ||
      options.chatterContext.sameUserRepeatCount > 0 ||
      options.chatterContext.globalCopyPasteUserCount >= 2)
  ) {
    add(10, "first-time chatter with risk signals");
  }

  if (looksRandomizedLogin(message.userLogin)) {
    add(10, "randomized username");
  }

  return {
    score: Math.min(moderationLimits.botShieldMaxScore, score),
    reasons,
  };
};

export const botShieldDetail = (
  score: NonNullable<ModerationEvaluation["botShield"]>,
) =>
  `bot shield score ${score.score}/${score.threshold}: ${score.reasons.join(", ") || "heuristic match"}`;

const shortDomainList = (domains: string[]) =>
  unique(domains).slice(0, 3).join(", ");

const isShortenerDomain = (domain: string) =>
  [...botShieldShortenerDomains].some((entry) =>
    domainMatchesAllowed(domain, entry),
  );

const isLikelyPromoDomain = (domain: string) =>
  /(?:buy|cheap|follow|followers|fame|promo|boost|viral|viewbot|viewers)/i.test(
    domain.replace(/[.-]/g, " "),
  );

const isRaidFriendlyMessage = (
  text: string,
  context: {
    domains: string[];
    highConfidenceMatches: number;
    hasPromoPair: boolean;
  },
) =>
  context.domains.length === 0 &&
  context.highConfidenceMatches === 0 &&
  !context.hasPromoPair &&
  text.length <= 180 &&
  botShieldRaidFriendlyPattern.test(text);

const looksRandomizedLogin = (login: string) => {
  const normalized = login.toLowerCase().replace(/^@/, "");

  if (normalized.length < 9) {
    return false;
  }

  const digits = normalized.replace(/\D/g, "").length;
  const digitRatio = digits / normalized.length;
  const alternatingChunks = normalized.match(/(?:[a-z]\d|\d[a-z]){3,}/i);

  return (digits >= 4 && digitRatio >= 0.25) || Boolean(alternatingChunks);
};
