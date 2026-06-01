import type {
  ModerationAction,
  ModerationFilterType,
  ModerationHit,
  ModerationSettings,
} from "./moderation.types";

export const enabledFilterNames = (settings: ModerationSettings) =>
  [
    settings.blockedTermsEnabled ? "blocked_terms" : undefined,
    settings.linkFilterEnabled ? "links" : undefined,
    settings.capsFilterEnabled ? "caps" : undefined,
    settings.repeatFilterEnabled ? "repeat" : undefined,
    settings.symbolFilterEnabled ? "symbols" : undefined,
    settings.botShieldEnabled ? "bot_shield" : undefined,
  ].filter(Boolean);

export const enabledExemptionNames = (settings: ModerationSettings) =>
  [
    settings.exemptBroadcaster ? "broadcaster" : undefined,
    settings.exemptModerators ? "moderators" : undefined,
    settings.exemptVips ? "vips" : undefined,
    settings.exemptSubscribers ? "subscribers" : undefined,
  ].filter(Boolean);

export const enabledEnforcementFilterNames = (settings: ModerationSettings) =>
  [
    settings.blockedTermsEnabled && settings.blockedTermsAction !== "warn"
      ? `blocked_terms:${settings.blockedTermsAction}`
      : undefined,
    settings.linkFilterEnabled && settings.linkFilterAction !== "warn"
      ? `links:${settings.linkFilterAction}`
      : undefined,
    settings.capsFilterEnabled && settings.capsFilterAction !== "warn"
      ? `caps:${settings.capsFilterAction}`
      : undefined,
    settings.repeatFilterEnabled && settings.repeatFilterAction !== "warn"
      ? `repeat:${settings.repeatFilterAction}`
      : undefined,
    settings.symbolFilterEnabled && settings.symbolFilterAction !== "warn"
      ? `symbols:${settings.symbolFilterAction}`
      : undefined,
    settings.botShieldEnabled && settings.botShieldAction !== "warn"
      ? `bot_shield:${settings.botShieldAction}`
      : undefined,
  ].filter(Boolean);

export const summarizeHitsByFilter = (hits: ModerationHit[]) =>
  hits.reduce<Record<string, number>>((summary, hit) => {
    for (const filterType of hit.filterType
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)) {
      summary[filterType] = (summary[filterType] ?? 0) + 1;
    }
    return summary;
  }, {});

export const summarizeHitsByAction = (hits: ModerationHit[]) =>
  hits.reduce<Record<string, number>>((summary, hit) => {
    summary[hit.action] = (summary[hit.action] ?? 0) + 1;
    return summary;
  }, {});

const actionRank: Record<ModerationAction, number> = {
  warn: 0,
  delete: 1,
  timeout: 2,
};

export const strongestAction = (
  actions: ModerationAction[],
): ModerationAction =>
  actions.reduce<ModerationAction>(
    (strongest, action) =>
      actionRank[action] > actionRank[strongest] ? action : strongest,
    "warn",
  );

export const isSilentBotShieldHit = (
  matches: Array<{ type: ModerationFilterType }>,
  action: ModerationAction,
  escalationApplied: boolean,
) =>
  action === "delete" &&
  !escalationApplied &&
  matches.length === 1 &&
  matches[0]?.type === "bot_shield";
