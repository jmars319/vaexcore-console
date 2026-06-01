import type { ChatMessage } from "../../core/chatMessage";
import { writeAuditLog } from "../../core/auditLog";
import {
  booleanValue,
  limits,
  normalizeModerationAction,
  normalizeWarningMessage,
  parseSafeInteger,
  ratioValue,
  timestamp,
} from "./moderation.normalization";
import { defaultSettings, settingsFromRow } from "./moderation.mappers";
import {
  enabledEnforcementFilterNames,
  enabledExemptionNames,
  enabledFilterNames,
} from "./moderation.summary";
import {
  moderationLimits,
  type ModerationServiceContext,
  type ModerationSettings,
  type ModerationSettingsRow,
} from "./moderation.types";

export const getModerationSettings = (
  context: ModerationServiceContext,
): ModerationSettings => {
  const row = context.db
    .prepare("SELECT * FROM moderation_settings WHERE id = 1")
    .get() as ModerationSettingsRow | undefined;

  return row ? settingsFromRow(row) : defaultSettings();
};

export const saveModerationSettings = (
  context: ModerationServiceContext,
  input: unknown,
  actor: ChatMessage,
) => {
  const current = getModerationSettings(context);
  const body = input as Partial<Record<keyof ModerationSettings, unknown>>;
  const settings: ModerationSettings = {
    blockedTermsEnabled: booleanValue(
      body.blockedTermsEnabled,
      current.blockedTermsEnabled,
    ),
    linkFilterEnabled: booleanValue(
      body.linkFilterEnabled,
      current.linkFilterEnabled,
    ),
    capsFilterEnabled: booleanValue(
      body.capsFilterEnabled,
      current.capsFilterEnabled,
    ),
    repeatFilterEnabled: booleanValue(
      body.repeatFilterEnabled,
      current.repeatFilterEnabled,
    ),
    symbolFilterEnabled: booleanValue(
      body.symbolFilterEnabled,
      current.symbolFilterEnabled,
    ),
    botShieldEnabled: booleanValue(
      body.botShieldEnabled,
      current.botShieldEnabled,
    ),
    action: "warn",
    blockedTermsAction: normalizeModerationAction(
      body.blockedTermsAction ?? current.blockedTermsAction,
      current.blockedTermsAction,
    ),
    linkFilterAction: normalizeModerationAction(
      body.linkFilterAction ?? current.linkFilterAction,
      current.linkFilterAction,
    ),
    capsFilterAction: normalizeModerationAction(
      body.capsFilterAction ?? current.capsFilterAction,
      current.capsFilterAction,
    ),
    repeatFilterAction: normalizeModerationAction(
      body.repeatFilterAction ?? current.repeatFilterAction,
      current.repeatFilterAction,
    ),
    symbolFilterAction: normalizeModerationAction(
      body.symbolFilterAction ?? current.symbolFilterAction,
      current.symbolFilterAction,
    ),
    botShieldAction: normalizeModerationAction(
      body.botShieldAction ?? current.botShieldAction,
      current.botShieldAction,
    ),
    botShieldScoreThreshold: parseSafeInteger(body.botShieldScoreThreshold, {
      field: "Bot Shield score threshold",
      fallback: current.botShieldScoreThreshold,
      min: moderationLimits.botShieldMinScore,
      max: moderationLimits.botShieldMaxScore,
    }),
    timeoutSeconds: parseSafeInteger(body.timeoutSeconds, {
      field: "Timeout seconds",
      fallback: current.timeoutSeconds,
      min: moderationLimits.timeoutMinSeconds,
      max: moderationLimits.timeoutMaxSeconds,
    }),
    warningMessage: normalizeWarningMessage(
      body.warningMessage ?? current.warningMessage,
    ),
    capsMinLength: parseSafeInteger(body.capsMinLength, {
      field: "Caps minimum length",
      fallback: current.capsMinLength,
      min: 5,
      max: limits.chatMessageLength,
    }),
    capsRatio: ratioValue(body.capsRatio, current.capsRatio, "Caps ratio"),
    repeatWindowSeconds: parseSafeInteger(body.repeatWindowSeconds, {
      field: "Repeat window",
      fallback: current.repeatWindowSeconds,
      min: 5,
      max: 600,
    }),
    repeatLimit: parseSafeInteger(body.repeatLimit, {
      field: "Repeat limit",
      fallback: current.repeatLimit,
      min: 2,
      max: 20,
    }),
    symbolMinLength: parseSafeInteger(body.symbolMinLength, {
      field: "Symbol minimum length",
      fallback: current.symbolMinLength,
      min: 5,
      max: limits.chatMessageLength,
    }),
    symbolRatio: ratioValue(
      body.symbolRatio,
      current.symbolRatio,
      "Symbol ratio",
    ),
    escalationEnabled: booleanValue(
      body.escalationEnabled,
      current.escalationEnabled,
    ),
    escalationWindowSeconds: parseSafeInteger(body.escalationWindowSeconds, {
      field: "Escalation window",
      fallback: current.escalationWindowSeconds,
      min: moderationLimits.escalationMinWindowSeconds,
      max: moderationLimits.escalationMaxWindowSeconds,
    }),
    escalationDeleteAfter: parseSafeInteger(body.escalationDeleteAfter, {
      field: "Escalation delete threshold",
      fallback: current.escalationDeleteAfter,
      min: 2,
      max: moderationLimits.escalationMaxHitCount,
    }),
    escalationTimeoutAfter: parseSafeInteger(body.escalationTimeoutAfter, {
      field: "Escalation timeout threshold",
      fallback: current.escalationTimeoutAfter,
      min: 2,
      max: moderationLimits.escalationMaxHitCount,
    }),
    exemptBroadcaster: booleanValue(
      body.exemptBroadcaster,
      current.exemptBroadcaster,
    ),
    exemptModerators: booleanValue(
      body.exemptModerators,
      current.exemptModerators,
    ),
    exemptVips: booleanValue(body.exemptVips, current.exemptVips),
    exemptSubscribers: booleanValue(
      body.exemptSubscribers,
      current.exemptSubscribers,
    ),
    updatedAt: timestamp(),
  };

  settings.escalationTimeoutAfter = Math.max(
    settings.escalationDeleteAfter,
    settings.escalationTimeoutAfter,
  );

  context.db
    .prepare(
      `
        INSERT INTO moderation_settings (
          id,
          blocked_terms_enabled,
          link_filter_enabled,
          caps_filter_enabled,
          repeat_filter_enabled,
          symbol_filter_enabled,
          bot_shield_enabled,
          action,
          blocked_terms_action,
          link_filter_action,
          caps_filter_action,
          repeat_filter_action,
          symbol_filter_action,
          bot_shield_action,
          bot_shield_score_threshold,
          timeout_seconds,
          warning_message,
          caps_min_length,
          caps_ratio,
          repeat_window_seconds,
          repeat_limit,
          symbol_min_length,
          symbol_ratio,
          escalation_enabled,
          escalation_window_seconds,
          escalation_delete_after,
          escalation_timeout_after,
          exempt_broadcaster,
          exempt_moderators,
          exempt_vips,
          exempt_subscribers,
          updated_at
        ) VALUES (
          1,
          @blockedTermsEnabled,
          @linkFilterEnabled,
          @capsFilterEnabled,
          @repeatFilterEnabled,
          @symbolFilterEnabled,
          @botShieldEnabled,
          'warn',
          @blockedTermsAction,
          @linkFilterAction,
          @capsFilterAction,
          @repeatFilterAction,
          @symbolFilterAction,
          @botShieldAction,
          @botShieldScoreThreshold,
          @timeoutSeconds,
          @warningMessage,
          @capsMinLength,
          @capsRatio,
          @repeatWindowSeconds,
          @repeatLimit,
          @symbolMinLength,
          @symbolRatio,
          @escalationEnabled,
          @escalationWindowSeconds,
          @escalationDeleteAfter,
          @escalationTimeoutAfter,
          @exemptBroadcaster,
          @exemptModerators,
          @exemptVips,
          @exemptSubscribers,
          @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          blocked_terms_enabled = excluded.blocked_terms_enabled,
          link_filter_enabled = excluded.link_filter_enabled,
          caps_filter_enabled = excluded.caps_filter_enabled,
          repeat_filter_enabled = excluded.repeat_filter_enabled,
          symbol_filter_enabled = excluded.symbol_filter_enabled,
          bot_shield_enabled = excluded.bot_shield_enabled,
          action = excluded.action,
          blocked_terms_action = excluded.blocked_terms_action,
          link_filter_action = excluded.link_filter_action,
          caps_filter_action = excluded.caps_filter_action,
          repeat_filter_action = excluded.repeat_filter_action,
          symbol_filter_action = excluded.symbol_filter_action,
          bot_shield_action = excluded.bot_shield_action,
          bot_shield_score_threshold = excluded.bot_shield_score_threshold,
          timeout_seconds = excluded.timeout_seconds,
          warning_message = excluded.warning_message,
          caps_min_length = excluded.caps_min_length,
          caps_ratio = excluded.caps_ratio,
          repeat_window_seconds = excluded.repeat_window_seconds,
          repeat_limit = excluded.repeat_limit,
          symbol_min_length = excluded.symbol_min_length,
          symbol_ratio = excluded.symbol_ratio,
          escalation_enabled = excluded.escalation_enabled,
          escalation_window_seconds = excluded.escalation_window_seconds,
          escalation_delete_after = excluded.escalation_delete_after,
          escalation_timeout_after = excluded.escalation_timeout_after,
          exempt_broadcaster = excluded.exempt_broadcaster,
          exempt_moderators = excluded.exempt_moderators,
          exempt_vips = excluded.exempt_vips,
          exempt_subscribers = excluded.exempt_subscribers,
          updated_at = excluded.updated_at
      `,
    )
    .run({
      blockedTermsEnabled: settings.blockedTermsEnabled ? 1 : 0,
      linkFilterEnabled: settings.linkFilterEnabled ? 1 : 0,
      capsFilterEnabled: settings.capsFilterEnabled ? 1 : 0,
      repeatFilterEnabled: settings.repeatFilterEnabled ? 1 : 0,
      symbolFilterEnabled: settings.symbolFilterEnabled ? 1 : 0,
      botShieldEnabled: settings.botShieldEnabled ? 1 : 0,
      blockedTermsAction: settings.blockedTermsAction,
      linkFilterAction: settings.linkFilterAction,
      capsFilterAction: settings.capsFilterAction,
      repeatFilterAction: settings.repeatFilterAction,
      symbolFilterAction: settings.symbolFilterAction,
      botShieldAction: settings.botShieldAction,
      botShieldScoreThreshold: settings.botShieldScoreThreshold,
      timeoutSeconds: settings.timeoutSeconds,
      warningMessage: settings.warningMessage,
      capsMinLength: settings.capsMinLength,
      capsRatio: settings.capsRatio,
      repeatWindowSeconds: settings.repeatWindowSeconds,
      repeatLimit: settings.repeatLimit,
      symbolMinLength: settings.symbolMinLength,
      symbolRatio: settings.symbolRatio,
      escalationEnabled: settings.escalationEnabled ? 1 : 0,
      escalationWindowSeconds: settings.escalationWindowSeconds,
      escalationDeleteAfter: settings.escalationDeleteAfter,
      escalationTimeoutAfter: settings.escalationTimeoutAfter,
      exemptBroadcaster: settings.exemptBroadcaster ? 1 : 0,
      exemptModerators: settings.exemptModerators ? 1 : 0,
      exemptVips: settings.exemptVips ? 1 : 0,
      exemptSubscribers: settings.exemptSubscribers ? 1 : 0,
      updatedAt: settings.updatedAt,
    });

  writeAuditLog(
    context.db,
    actor,
    "moderation.settings_update",
    "moderation:settings",
    {
      filtersEnabled: enabledFilterNames(settings),
      roleExemptions: enabledExemptionNames(settings),
      enforcementFilters: enabledEnforcementFilterNames(settings),
      escalationEnabled: settings.escalationEnabled,
      escalationDeleteAfter: settings.escalationDeleteAfter,
      escalationTimeoutAfter: settings.escalationTimeoutAfter,
      escalationWindowSeconds: settings.escalationWindowSeconds,
      botShieldScoreThreshold: settings.botShieldScoreThreshold,
      timeoutSeconds: settings.timeoutSeconds,
    },
  );
};
