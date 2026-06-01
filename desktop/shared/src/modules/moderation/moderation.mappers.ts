import {
  clampBotShieldScoreThreshold,
  clampEscalationHitCount,
  clampEscalationWindowSeconds,
  clampTimeoutSeconds,
  normalizeStoredModerationAction,
} from "./moderation.normalization";
import type {
  ModerationAllowedLink,
  ModerationAllowedLinkRow,
  ModerationBlockedLink,
  ModerationBlockedLinkRow,
  ModerationHit,
  ModerationHitRow,
  ModerationLinkPermit,
  ModerationLinkPermitRow,
  ModerationSettings,
  ModerationSettingsRow,
  ModerationTerm,
  ModerationTermRow,
} from "./moderation.types";

export const defaultSettings = (): ModerationSettings => ({
  blockedTermsEnabled: false,
  linkFilterEnabled: false,
  capsFilterEnabled: false,
  repeatFilterEnabled: false,
  symbolFilterEnabled: false,
  botShieldEnabled: false,
  action: "warn",
  blockedTermsAction: "warn",
  linkFilterAction: "warn",
  capsFilterAction: "warn",
  repeatFilterAction: "warn",
  symbolFilterAction: "warn",
  botShieldAction: "delete",
  botShieldScoreThreshold: 70,
  timeoutSeconds: 60,
  warningMessage: "@{user}, please keep chat within channel guidelines.",
  capsMinLength: 20,
  capsRatio: 0.75,
  repeatWindowSeconds: 30,
  repeatLimit: 3,
  symbolMinLength: 12,
  symbolRatio: 0.6,
  escalationEnabled: false,
  escalationWindowSeconds: 300,
  escalationDeleteAfter: 2,
  escalationTimeoutAfter: 3,
  exemptBroadcaster: true,
  exemptModerators: true,
  exemptVips: false,
  exemptSubscribers: false,
  updatedAt: "",
});

export const settingsFromRow = (
  row: ModerationSettingsRow,
): ModerationSettings => ({
  blockedTermsEnabled: row.blocked_terms_enabled === 1,
  linkFilterEnabled: row.link_filter_enabled === 1,
  capsFilterEnabled: row.caps_filter_enabled === 1,
  repeatFilterEnabled: row.repeat_filter_enabled === 1,
  symbolFilterEnabled: row.symbol_filter_enabled === 1,
  botShieldEnabled: row.bot_shield_enabled === 1,
  action: "warn",
  blockedTermsAction: normalizeStoredModerationAction(row.blocked_terms_action),
  linkFilterAction: normalizeStoredModerationAction(row.link_filter_action),
  capsFilterAction: normalizeStoredModerationAction(row.caps_filter_action),
  repeatFilterAction: normalizeStoredModerationAction(row.repeat_filter_action),
  symbolFilterAction: normalizeStoredModerationAction(row.symbol_filter_action),
  botShieldAction: normalizeStoredModerationAction(row.bot_shield_action),
  botShieldScoreThreshold: clampBotShieldScoreThreshold(
    row.bot_shield_score_threshold,
  ),
  timeoutSeconds: clampTimeoutSeconds(row.timeout_seconds),
  warningMessage: row.warning_message,
  capsMinLength: row.caps_min_length,
  capsRatio: row.caps_ratio,
  repeatWindowSeconds: row.repeat_window_seconds,
  repeatLimit: row.repeat_limit,
  symbolMinLength: row.symbol_min_length,
  symbolRatio: row.symbol_ratio,
  escalationEnabled: row.escalation_enabled === 1,
  escalationWindowSeconds: clampEscalationWindowSeconds(
    row.escalation_window_seconds,
  ),
  escalationDeleteAfter: clampEscalationHitCount(
    row.escalation_delete_after,
    2,
  ),
  escalationTimeoutAfter: Math.max(
    clampEscalationHitCount(row.escalation_delete_after, 2),
    clampEscalationHitCount(row.escalation_timeout_after, 3),
  ),
  exemptBroadcaster: row.exempt_broadcaster === 1,
  exemptModerators: row.exempt_moderators === 1,
  exemptVips: row.exempt_vips === 1,
  exemptSubscribers: row.exempt_subscribers === 1,
  updatedAt: row.updated_at,
});

export const termFromRow = (row: ModerationTermRow): ModerationTerm => ({
  id: row.id,
  term: row.term,
  enabled: row.enabled === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const hitFromRow = (row: ModerationHitRow): ModerationHit => ({
  id: row.id,
  filterType: row.filter_type,
  action: row.action,
  userKey: row.user_key,
  userLogin: row.user_login,
  messagePreview: row.message_preview,
  detail: row.detail,
  createdAt: row.created_at,
});

export const allowedLinkFromRow = (
  row: ModerationAllowedLinkRow,
): ModerationAllowedLink => ({
  id: row.id,
  domain: row.domain,
  enabled: row.enabled === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const blockedLinkFromRow = (
  row: ModerationBlockedLinkRow,
): ModerationBlockedLink => ({
  id: row.id,
  domain: row.domain,
  enabled: row.enabled === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const linkPermitFromRow = (
  row: ModerationLinkPermitRow,
): ModerationLinkPermit => ({
  id: row.id,
  userLogin: row.user_login,
  expiresAt: row.expires_at,
  usedAt: row.used_at,
  createdAt: row.created_at,
  createdBy: row.created_by,
  active: !row.used_at && new Date(row.expires_at).getTime() > Date.now(),
});
