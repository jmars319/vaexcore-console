import type { ChatMessage } from "../../core/chatMessage";
import type { DbClient } from "../../db/client";
import {
  planModerationEnforcement,
  recordModerationEnforcement,
  shouldSendModerationWarning,
} from "./moderation.enforcement";
import { evaluateModerationMessage } from "./moderation.evaluation";
import { listModerationRecentHits } from "./moderation.hits";
import {
  deleteModerationAllowedLink,
  deleteModerationBlockedLink,
  grantModerationLinkPermit,
  listModerationAllowedLinks,
  listModerationBlockedLinks,
  listModerationLinkPermits,
  saveModerationAllowedLink,
  saveModerationBlockedLink,
  setModerationAllowedLinkEnabled,
  setModerationBlockedLinkEnabled,
} from "./moderation.links";
import {
  getModerationSettings,
  saveModerationSettings,
} from "./moderation.settings";
import { getModerationState } from "./moderation.state";
import {
  deleteModerationTerm,
  listModerationTerms,
  saveModerationTerm,
  setModerationTermEnabled,
} from "./moderation.terms";
import {
  createModerationServiceContext,
  type ModerationEnforcementCapabilities,
  type ModerationEnforcementOutcome,
  type ModerationEvaluation,
  type ModerationServiceContext,
  type ModerationServiceOptions,
} from "./moderation.types";

export type {
  ModerationAction,
  ModerationAllowedLink,
  ModerationBlockedLink,
  ModerationEnforcementCapabilities,
  ModerationEnforcementOutcome,
  ModerationEnforcementPlan,
  ModerationEvaluation,
  ModerationFilterType,
  ModerationHit,
  ModerationLinkPermit,
  ModerationSettings,
  ModerationTerm,
} from "./moderation.types";

export class ModerationService {
  private readonly context: ModerationServiceContext;

  constructor(db: DbClient, options: ModerationServiceOptions) {
    this.context = createModerationServiceContext(db, options);
  }

  getState() {
    return getModerationState(this.context);
  }

  getSettings() {
    return getModerationSettings(this.context);
  }

  saveSettings(input: unknown, actor: ChatMessage) {
    saveModerationSettings(this.context, input, actor);
    return this.getState();
  }

  listTerms() {
    return listModerationTerms(this.context);
  }

  saveTerm(input: unknown, actor: ChatMessage) {
    saveModerationTerm(this.context, input, actor);
    return this.getState();
  }

  setTermEnabled(id: number, enabled: boolean, actor: ChatMessage) {
    setModerationTermEnabled(this.context, id, enabled, actor);
    return this.getState();
  }

  deleteTerm(id: number, actor: ChatMessage) {
    deleteModerationTerm(this.context, id, actor);
    return this.getState();
  }

  listAllowedLinks() {
    return listModerationAllowedLinks(this.context);
  }

  saveAllowedLink(input: unknown, actor: ChatMessage) {
    saveModerationAllowedLink(this.context, input, actor);
    return this.getState();
  }

  setAllowedLinkEnabled(id: number, enabled: boolean, actor: ChatMessage) {
    setModerationAllowedLinkEnabled(this.context, id, enabled, actor);
    return this.getState();
  }

  deleteAllowedLink(id: number, actor: ChatMessage) {
    deleteModerationAllowedLink(this.context, id, actor);
    return this.getState();
  }

  listBlockedLinks() {
    return listModerationBlockedLinks(this.context);
  }

  saveBlockedLink(input: unknown, actor: ChatMessage) {
    saveModerationBlockedLink(this.context, input, actor);
    return this.getState();
  }

  setBlockedLinkEnabled(id: number, enabled: boolean, actor: ChatMessage) {
    setModerationBlockedLinkEnabled(this.context, id, enabled, actor);
    return this.getState();
  }

  deleteBlockedLink(id: number, actor: ChatMessage) {
    deleteModerationBlockedLink(this.context, id, actor);
    return this.getState();
  }

  listLinkPermits(limit = 25) {
    return listModerationLinkPermits(this.context, limit);
  }

  grantLinkPermit(input: unknown, actor: ChatMessage) {
    grantModerationLinkPermit(this.context, input, actor);
    return this.getState();
  }

  getRecentHits(limit = 50) {
    return listModerationRecentHits(this.context, limit);
  }

  evaluate(
    message: ChatMessage,
    options: { record?: boolean; consumePermits?: boolean } = {},
  ): ModerationEvaluation {
    return evaluateModerationMessage(this.context, message, options);
  }

  planEnforcement(
    message: ChatMessage,
    hit: NonNullable<ModerationEvaluation["hit"]>,
    capabilities: ModerationEnforcementCapabilities,
  ) {
    return planModerationEnforcement(message, hit, capabilities);
  }

  recordEnforcement(
    message: ChatMessage,
    hit: NonNullable<ModerationEvaluation["hit"]>,
    outcome: ModerationEnforcementOutcome,
  ) {
    recordModerationEnforcement(this.context, message, hit, outcome);
  }

  shouldWarn(
    message: ChatMessage,
    hit: NonNullable<ModerationEvaluation["hit"]>,
  ) {
    return shouldSendModerationWarning(this.context, message, hit);
  }
}
