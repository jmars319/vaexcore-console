import type { FeatureGateStore } from "../../core/featureGates";
import type { DbClient } from "../../db/client";

export const moderationLimits = {
  termLength: 80,
  domainLength: 120,
  detailLength: 180,
  hitLimit: 100,
  linkPermitLimit: 100,
  repeatMemoryMax: 50,
  globalRepeatMemoryMax: 300,
  warningCooldownMs: 60_000,
  timeoutMinSeconds: 10,
  timeoutMaxSeconds: 1200,
  escalationMinWindowSeconds: 30,
  escalationMaxWindowSeconds: 3600,
  escalationMaxHitCount: 25,
  botShieldMinScore: 30,
  botShieldMaxScore: 100,
} as const;

export type ModerationFilterType =
  | "blocked_term"
  | "link"
  | "caps"
  | "repeat"
  | "symbols"
  | "bot_shield";

export type ModerationAction = "warn" | "delete" | "timeout";

export type ModerationSettings = {
  blockedTermsEnabled: boolean;
  linkFilterEnabled: boolean;
  capsFilterEnabled: boolean;
  repeatFilterEnabled: boolean;
  symbolFilterEnabled: boolean;
  botShieldEnabled: boolean;
  action: ModerationAction;
  blockedTermsAction: ModerationAction;
  linkFilterAction: ModerationAction;
  capsFilterAction: ModerationAction;
  repeatFilterAction: ModerationAction;
  symbolFilterAction: ModerationAction;
  botShieldAction: ModerationAction;
  botShieldScoreThreshold: number;
  timeoutSeconds: number;
  warningMessage: string;
  capsMinLength: number;
  capsRatio: number;
  repeatWindowSeconds: number;
  repeatLimit: number;
  symbolMinLength: number;
  symbolRatio: number;
  escalationEnabled: boolean;
  escalationWindowSeconds: number;
  escalationDeleteAfter: number;
  escalationTimeoutAfter: number;
  exemptBroadcaster: boolean;
  exemptModerators: boolean;
  exemptVips: boolean;
  exemptSubscribers: boolean;
  updatedAt: string;
};

export type ModerationTerm = {
  id: number;
  term: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ModerationHit = {
  id: number;
  filterType: string;
  action: ModerationAction;
  userKey: string;
  userLogin: string;
  messagePreview: string;
  detail: string;
  createdAt: string;
};

export type ModerationAllowedLink = {
  id: number;
  domain: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ModerationBlockedLink = {
  id: number;
  domain: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ModerationLinkPermit = {
  id: number;
  userLogin: string;
  expiresAt: string;
  usedAt: string;
  createdAt: string;
  createdBy: string;
  active: boolean;
};

export type ModerationSettingsRow = {
  blocked_terms_enabled: number;
  link_filter_enabled: number;
  caps_filter_enabled: number;
  repeat_filter_enabled: number;
  symbol_filter_enabled: number;
  bot_shield_enabled: number;
  action: ModerationAction;
  blocked_terms_action: ModerationAction;
  link_filter_action: ModerationAction;
  caps_filter_action: ModerationAction;
  repeat_filter_action: ModerationAction;
  symbol_filter_action: ModerationAction;
  bot_shield_action: ModerationAction;
  bot_shield_score_threshold: number;
  timeout_seconds: number;
  warning_message: string;
  caps_min_length: number;
  caps_ratio: number;
  repeat_window_seconds: number;
  repeat_limit: number;
  symbol_min_length: number;
  symbol_ratio: number;
  escalation_enabled: number;
  escalation_window_seconds: number;
  escalation_delete_after: number;
  escalation_timeout_after: number;
  exempt_broadcaster: number;
  exempt_moderators: number;
  exempt_vips: number;
  exempt_subscribers: number;
  updated_at: string;
};

export type ModerationTermRow = {
  id: number;
  term: string;
  enabled: number;
  created_at: string;
  updated_at: string;
};

export type ModerationHitRow = {
  id: number;
  filter_type: string;
  action: ModerationAction;
  user_key: string;
  user_login: string;
  message_preview: string;
  detail: string;
  created_at: string;
};

export type ModerationAllowedLinkRow = {
  id: number;
  domain: string;
  enabled: number;
  created_at: string;
  updated_at: string;
};

export type ModerationBlockedLinkRow = {
  id: number;
  domain: string;
  enabled: number;
  created_at: string;
  updated_at: string;
};

export type ModerationLinkPermitRow = {
  id: number;
  user_login: string;
  expires_at: string;
  used_at: string;
  created_at: string;
  created_by: string;
};

export type ModerationMemoryEntry = {
  normalizedText: string;
  userKey: string;
  at: number;
};

export type ChatterContext = {
  firstTimeChatter: boolean;
  sameUserRepeatCount: number;
  rapidUserMessageCount: number;
  globalCopyPasteUserCount: number;
};

export type ModerationEvaluation = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  allowedLinks?: string[];
  botShield?: {
    score: number;
    threshold: number;
    reasons: string[];
    firstTimeChatter: boolean;
    silent: boolean;
  };
  consumedPermit?: {
    id: number;
    userLogin: string;
    expiresAt: string;
  };
  hit?: {
    filterTypes: ModerationFilterType[];
    action: ModerationAction;
    filterActions: Array<{
      filterType: ModerationFilterType;
      action: ModerationAction;
    }>;
    matches: Array<{
      filterType: ModerationFilterType;
      action: ModerationAction;
      detail: string;
    }>;
    escalation?: {
      hitsInWindow: number;
      windowSeconds: number;
      action: ModerationAction;
      reason: string;
    };
    detail: string;
    warningMessage: string;
    silent?: boolean;
    timeoutSeconds?: number;
  };
};

export type ModerationEnforcementCapabilities = {
  canDeleteMessages: boolean;
  canTimeoutUsers: boolean;
  deleteUnavailableReason?: string;
  timeoutUnavailableReason?: string;
};

export type ModerationEnforcementPlan =
  | {
      status: "skipped" | "blocked";
      action: ModerationAction;
      reason: string;
      durationSeconds?: number;
    }
  | {
      status: "ready";
      action: "delete" | "timeout";
      reason: string;
      durationSeconds?: number;
    };

export type ModerationEnforcementOutcome = {
  action: ModerationAction;
  status: "skipped" | "blocked" | "succeeded" | "failed";
  reason: string;
  durationSeconds?: number;
  statusCode?: number;
};

export type ModerationServiceOptions = {
  featureGates: FeatureGateStore;
  commandPrefix?: string;
  exemptCommandNames?: () => string[];
};

export type ModerationServiceContext = {
  db: DbClient;
  options: ModerationServiceOptions;
  recentByUser: Map<string, ModerationMemoryEntry[]>;
  recentGlobal: ModerationMemoryEntry[];
  seenUserKeys: Set<string>;
  lastWarningAt: Map<string, number>;
};

export const createModerationServiceContext = (
  db: DbClient,
  options: ModerationServiceOptions,
): ModerationServiceContext => ({
  db,
  options,
  recentByUser: new Map(),
  recentGlobal: [],
  seenUserKeys: new Set(),
  lastWarningAt: new Map(),
});
