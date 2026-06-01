import { listModerationRecentHits } from "./moderation.hits";
import {
  listModerationAllowedLinks,
  listModerationBlockedLinks,
  listModerationLinkPermits,
} from "./moderation.links";
import { getModerationSettings } from "./moderation.settings";
import {
  enabledEnforcementFilterNames,
  enabledExemptionNames,
  summarizeHitsByAction,
  summarizeHitsByFilter,
} from "./moderation.summary";
import { listModerationTerms } from "./moderation.terms";
import type { ModerationServiceContext } from "./moderation.types";

export const getModerationState = (context: ModerationServiceContext) => {
  const terms = listModerationTerms(context);
  const hits = listModerationRecentHits(context, 50);
  const settings = getModerationSettings(context);
  const allowedLinks = listModerationAllowedLinks(context);
  const blockedLinks = listModerationBlockedLinks(context);
  const linkPermits = listModerationLinkPermits(context, 25);
  const hitsByFilter = summarizeHitsByFilter(hits);
  const hitsByAction = summarizeHitsByAction(hits);

  return {
    ok: true,
    settings,
    terms,
    allowedLinks,
    blockedLinks,
    linkPermits,
    hits,
    featureGate: context.options.featureGates.get("moderation_filters"),
    summary: {
      terms: terms.length,
      enabledTerms: terms.filter((term) => term.enabled).length,
      allowedLinks: allowedLinks.length,
      enabledAllowedLinks: allowedLinks.filter((link) => link.enabled).length,
      blockedLinks: blockedLinks.length,
      enabledBlockedLinks: blockedLinks.filter((link) => link.enabled).length,
      activeLinkPermits: linkPermits.filter((permit) => permit.active).length,
      roleExemptions: enabledExemptionNames(settings).length,
      filtersEnabled: [
        settings.blockedTermsEnabled,
        settings.linkFilterEnabled,
        settings.capsFilterEnabled,
        settings.repeatFilterEnabled,
        settings.symbolFilterEnabled,
        settings.botShieldEnabled,
      ].filter(Boolean).length,
      enforcementFilters: enabledEnforcementFilterNames(settings).length,
      botShield: settings.botShieldEnabled
        ? `${settings.botShieldScoreThreshold}+ ${settings.botShieldAction}`
        : "off",
      escalation: settings.escalationEnabled
        ? `${settings.escalationDeleteAfter}/${settings.escalationTimeoutAfter} in ${settings.escalationWindowSeconds}s`
        : "off",
      timeoutSeconds: settings.timeoutSeconds,
      hits: hits.length,
      hitsByFilter,
      hitsByAction,
    },
  };
};
