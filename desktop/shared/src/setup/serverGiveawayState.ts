import type {
  Giveaway,
  GiveawayWinner,
} from "../modules/giveaways/giveaways.types";
import {
  GiveawaysService,
  parseSupportedPlatforms,
  type GiveawayFollowAgeResolver,
} from "../modules/giveaways/giveaways.service";
import {
  classifyOutboundMessage,
  createOutboundHistory,
  isOutboundCategory,
  isOutboundFailureCategory,
  isOutboundImportance,
  isPendingOutboundStatus,
  type OutboundMessageRecord,
} from "../core/outboundHistory";
import { formatDuration } from "./serverDiagnostics";
import { wait } from "./serverDiscordRelay";
import { canSendConfiguredChat } from "./serverGiveawayActions";
import { giveawayAnnouncementPhases } from "./serverGiveawayTemplates";
import { giveawaysService, outboundHistory } from "./serverState";
import type { GiveawayAnnouncementPhase } from "./serverGiveawayTemplates";

export const getGiveawayState = () => {
  const state = giveawaysService.getOperatorState();
  const latest = giveawaysService.getLatestGiveawayState();
  const assurance = summarizeGiveawayAssurance(latest);
  return {
    ok: true,
    ...state,
    summary: summarizeGiveawayState(state),
    recap: summarizeGiveawayRecap(latest, assurance),
    assurance,
  };
};

export const getGiveawayOverlayState = () => {
  const state = getGiveawayState();
  const activeWinners = (state.winners || []).filter(
    (winner) => !winner.rerolled_at,
  );
  const latestWinner = activeWinners[activeWinners.length - 1];
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    summary: state.summary,
    giveaway: state.giveaway
      ? {
          id: state.giveaway.id,
          title: state.giveaway.title,
          keyword: state.giveaway.keyword,
          status: state.giveaway.status,
        }
      : undefined,
    entrantCount: state.summary.entryCount,
    rules: state.summary.rules,
    marketplace: {
      name: state.summary.config.marketplaceName,
      note: "Key purchased after winner confirms platform/region.",
      disclosure: "Not sponsored. No affiliate link.",
    },
    platformNote: state.summary.config.regionAvailabilityDisclaimer,
    timer: state.summary.timer,
    responseTimer: state.summary.responseTimer,
    latestWinner: latestWinner
      ? {
          login: latestWinner.login,
          displayName: latestWinner.display_name,
          status: latestWinner.status,
          drawnAt: latestWinner.drawn_at,
          responseExpiresAt: latestWinner.response_expires_at,
          selectedPlatform: latestWinner.selected_platform,
        }
      : undefined,
  };
};

export const summarizeGiveawayState = (
  state: ReturnType<GiveawaysService["getOperatorState"]>,
) => {
  const activeWinners = state.winners.filter((winner) => !winner.rerolled_at);
  const undeliveredWinnersCount = activeWinners.filter(
    (winner) => !winner.delivered_at,
  ).length;
  const winnerCount = state.giveaway?.winner_count ?? 6;
  const liveState = giveawayLiveState(
    state,
    activeWinners,
    undeliveredWinnersCount,
  );

  return {
    status: state.giveaway?.status ?? "none",
    title: state.giveaway?.title ?? "",
    keyword: state.giveaway?.keyword ?? "enter",
    winnerCount,
    config: state.giveaway
      ? giveawayConfigSummary(state.giveaway)
      : giveawayConfigSummary(),
    entryCount: state.counts.entries,
    winnersDrawn: state.counts.activeWinners,
    rerolledCount: state.counts.rerolledWinners,
    pendingConfirmationCount: activeWinners.filter(
      (winner) => winner.status === "pending_confirmation",
    ).length,
    confirmedWinnerCount: activeWinners.filter(
      (winner) => winner.status === "confirmed",
    ).length,
    expiredWinnerCount: activeWinners.filter(
      (winner) => winner.status === "expired",
    ).length,
    enoughEntrantsForFullDraw: state.counts.entries >= winnerCount,
    undeliveredWinnersCount,
    eligibility: {
      eligibleEntries: state.entries.filter(
        (entry) => entry.eligibility_status === "eligible",
      ).length,
      removedEntries: state.entries.filter(
        (entry) => entry.eligibility_status === "removed",
      ).length,
      minimumFollowAgeDays: state.giveaway?.minimum_follow_age_days ?? 7,
    },
    timer: giveawayTimerSummary(state.giveaway),
    responseTimer: giveawayResponseTimerSummary(activeWinners),
    rules: giveawayRuleSummary(state.giveaway),
    draw: state.giveaway
      ? {
          seed: state.giveaway.draw_seed,
          result: safeJsonObject(state.giveaway.draw_result_json),
          lastDrawAt: state.giveaway.last_draw_at,
        }
      : {},
    operatorState: liveState.label,
    operatorStateDetail: liveState.detail,
    operatorStateTone: liveState.tone,
    safeToEnd: liveState.safeToEnd,
    canSendStatus: Boolean(state.giveaway),
    manualCodeDeliveryRequired: Boolean(state.giveaway),
    endWarnings: [
      state.giveaway?.status === "open" ? "Giveaway is still open." : undefined,
      undeliveredWinnersCount > 0
        ? `${undeliveredWinnersCount} winner(s) are not marked delivered.`
        : undefined,
    ].filter(Boolean),
  };
};

export const giveawayLiveState = (
  state: ReturnType<GiveawaysService["getOperatorState"]>,
  activeWinners: ReturnType<GiveawaysService["getOperatorState"]>["winners"],
  undeliveredWinnersCount: number,
) => {
  const giveaway = state.giveaway;

  if (!giveaway) {
    return {
      label: "no giveaway",
      detail: "Start a giveaway when stream operations are ready.",
      tone: "muted",
      safeToEnd: false,
    };
  }

  if (giveaway.status === "open") {
    return {
      label: "entries open",
      detail: `Viewers enter with !${giveaway.keyword}. Close entries before drawing.`,
      tone: "ok",
      safeToEnd: false,
    };
  }

  if (giveaway.status === "closed" && activeWinners.length === 0) {
    return {
      label: "ready to draw",
      detail: `${state.counts.entries} entr${state.counts.entries === 1 ? "y" : "ies"} recorded. Draw winners when ready.`,
      tone: "ok",
      safeToEnd: false,
    };
  }

  if (giveaway.status === "ended") {
    return {
      label: "giveaway ended",
      detail:
        undeliveredWinnersCount > 0
          ? `${undeliveredWinnersCount} winner(s) were still pending delivery at end.`
          : "Post-stream recap is ready.",
      tone: undeliveredWinnersCount > 0 ? "warn" : "ok",
      safeToEnd: false,
    };
  }

  if (undeliveredWinnersCount > 0) {
    return {
      label: "delivery pending",
      detail: `${undeliveredWinnersCount} active winner(s) still need manual delivery.`,
      tone: "warn",
      safeToEnd: false,
    };
  }

  return {
    label: "safe to end",
    detail: "Active winners are marked delivered.",
    tone: "ok",
    safeToEnd: true,
  };
};

export const giveawayConfigSummary = (giveaway?: Giveaway) => ({
  itemName: giveaway?.item_name ?? "",
  itemEdition: giveaway?.item_edition ?? "Standard Edition",
  gameName: giveaway?.game_name ?? "",
  marketplaceName: giveaway?.marketplace_name ?? "Eneba",
  marketplaceNote:
    giveaway?.marketplace_note ??
    "Key sourced after winner confirms platform/region.",
  platformMode: giveaway?.platform_mode ?? "winner_selects_after_win",
  supportedPlatforms: giveaway
    ? parseSupportedPlatforms(giveaway)
    : ["Steam", "Xbox", "PlayStation", "Epic", "Other / manual"],
  prizeType: giveaway?.prize_type ?? "standard_game_key",
  minimumFollowAgeDays: giveaway?.minimum_follow_age_days ?? 7,
  mustBePresentToWin: giveaway?.must_be_present_to_win !== 0,
  responseWindowMinutes: giveaway?.response_window_minutes ?? 7,
  oneEntryPerPerson: giveaway?.one_entry_per_person !== 0,
  allowExtraEntries: giveaway?.allow_extra_entries === 1,
  previousWinnerRestrictionMode:
    giveaway?.previous_winner_restriction_mode ?? "base_game_blocks_deluxe",
  ageGuidanceText:
    giveaway?.age_guidance_text ??
    "Game is rated Mature. Please only enter if this is appropriate for you.",
  regionAvailabilityDisclaimer:
    giveaway?.region_availability_disclaimer ??
    "Prize availability depends on platform, region, and legitimate purchasable key availability.",
  entryWindowMinutes: giveaway?.entry_window_minutes ?? 10,
});

export const giveawayTimerSummary = (giveaway?: Giveaway) => {
  const entriesCloseAt = giveaway?.entries_close_at ?? "";
  const remainingMs = entriesCloseAt
    ? Math.max(0, Date.parse(entriesCloseAt) - Date.now())
    : 0;

  return {
    entryWindowMinutes: giveaway?.entry_window_minutes ?? 10,
    entriesCloseAt,
    timerStartedAt: giveaway?.timer_started_at ?? "",
    running: Boolean(
      giveaway?.status === "open" && entriesCloseAt && remainingMs > 0,
    ),
    remainingMs,
  };
};

export const giveawayResponseTimerSummary = (winners: GiveawayWinner[]) => {
  const pending = winners
    .filter((winner) => winner.status === "pending_confirmation")
    .sort((a, b) =>
      String(a.response_expires_at).localeCompare(
        String(b.response_expires_at),
      ),
    )[0];
  const responseExpiresAt = pending?.response_expires_at ?? "";

  return {
    winnerLogin: pending?.login ?? "",
    responseExpiresAt,
    remainingMs: responseExpiresAt
      ? Math.max(0, Date.parse(responseExpiresAt) - Date.now())
      : 0,
  };
};

export const giveawayRuleSummary = (giveaway?: Giveaway) => {
  const config = giveawayConfigSummary(giveaway);
  return [
    `Followed for ${config.minimumFollowAgeDays}+ days`,
    "Must be present in chat to win",
    "One entry per person",
    "Platform confirmed after win",
    "Region/platform availability may vary",
    "No cash alternative",
    `Winner has ${config.responseWindowMinutes} minutes to respond`,
    config.ageGuidanceText,
    "Previous winners cannot win duplicate/base-upgrade versions of the same game",
  ];
};

export const safeJsonObject = (value: string) => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

export const summarizeGiveawayAssurance = (
  state: ReturnType<GiveawaysService["getLatestGiveawayState"]>,
) => {
  if (!state.giveaway) {
    return {
      available: false,
      blockContinue: false,
      phases: [],
      summary: {
        sent: 0,
        resent: 0,
        pending: 0,
        failed: 0,
        requiredCritical: 0,
        confirmedCritical: 0,
        pendingCritical: 0,
        missingCritical: 0,
        failedCritical: 0,
        blockingCritical: 0,
      },
      nextAction: "Start a giveaway.",
    };
  }

  const messages = giveawayOutboundMessagesFor(state.giveaway.id);
  const phases = giveawayAnnouncementPhases.map((phase) =>
    summarizeGiveawayPhase(phase, state, messages),
  );
  const failedCritical = phases.filter(
    (phase) => phase.importance === "critical" && phase.status === "failed",
  );
  const missingCritical = phases.filter(
    (phase) => phase.importance === "critical" && phase.status === "missing",
  );
  const pendingCritical = phases.filter(
    (phase) => phase.importance === "critical" && phase.status === "pending",
  );
  const requiredCritical = phases.filter(
    (phase) => phase.importance === "critical" && phase.required,
  );
  const confirmedCritical = requiredCritical.filter(
    (phase) => phase.status === "sent",
  );
  const failed = messages.filter((message) => message.status === "failed");
  const pending = messages.filter((message) =>
    isPendingOutboundStatus(message.status),
  );
  const sent = messages.filter((message) => message.status === "sent");
  const resent = messages.filter((message) => message.status === "resent");
  const blockingCritical = [
    ...failedCritical,
    ...missingCritical,
    ...pendingCritical,
  ];
  const blockContinue = blockingCritical.length > 0;
  const nextAction = failedCritical[0]
    ? `Resend failed ${failedCritical[0].label} announcement before continuing.`
    : missingCritical[0]
      ? `Send missing ${missingCritical[0].label} announcement before continuing.`
      : pendingCritical[0]
        ? `Wait for ${pendingCritical[0].label} announcement to send.`
        : "Giveaway chat assurance is clear.";

  return {
    available: true,
    giveawayId: state.giveaway.id,
    blockContinue,
    phases,
    summary: {
      sent: sent.length,
      resent: resent.length,
      pending: pending.length,
      failed: failed.length,
      requiredCritical: requiredCritical.length,
      confirmedCritical: confirmedCritical.length,
      pendingCritical: pendingCritical.length,
      missingCritical: missingCritical.length,
      failedCritical: failedCritical.length,
      blockingCritical: blockingCritical.length,
    },
    latestBlocking: blockingCritical[0]
      ? {
          label: blockingCritical[0].label,
          status: blockingCritical[0].status,
          queueStatus: blockingCritical[0].queueStatus,
          action: blockingCritical[0].action,
          reason: blockingCritical[0].reason,
        }
      : undefined,
    nextAction,
    latestFailure: failed[0]
      ? {
          action: failed[0].action,
          failureCategory: failed[0].failureCategory,
          reason: failed[0].reason,
          updatedAt: failed[0].updatedAt,
        }
      : undefined,
  };
};

export const summarizeGiveawayPhase = (
  phase: GiveawayAnnouncementPhase,
  state: ReturnType<GiveawaysService["getLatestGiveawayState"]>,
  messages: OutboundMessageRecord[],
) => {
  const latest = latestOutboundForActions(
    state.giveaway?.id,
    phase.actions,
    messages,
  );
  const required = phase.requiredWhen(state);
  const status = latest
    ? phaseStatusFromOutbound(latest)
    : required
      ? "missing"
      : "not-reached";
  const blocksContinue =
    phase.importance === "critical" &&
    required &&
    (status === "failed" || status === "missing" || status === "pending");

  return {
    id: phase.id,
    label: phase.label,
    action: latest?.action || phase.actions[0],
    importance: latest?.importance || phase.importance,
    required,
    status,
    queueStatus: latest?.status ?? status,
    outboundMessageId: latest?.id ?? "",
    attempts: latest?.attempts ?? 0,
    message: latest?.message ?? "",
    reason: latest?.reason ?? "",
    failureCategory: latest?.failureCategory ?? "none",
    retryAfterMs: latest?.retryAfterMs ?? 0,
    nextAttemptAt: latest?.nextAttemptAt ?? "",
    queueDepth: latest?.queueDepth ?? 0,
    updatedAt: latest?.updatedAt ?? "",
    ageMs: latest?.updatedAt ? Date.now() - Date.parse(latest.updatedAt) : 0,
    age: latest?.updatedAt
      ? formatDuration(Date.now() - Date.parse(latest.updatedAt))
      : "",
    blocksContinue,
    canSend: status === "failed" || status === "missing",
    safeToResend:
      (status === "failed" || status === "missing") && canSendConfiguredChat(),
    deliveryDetail: giveawayPhaseDeliveryDetail(phase, status, latest),
    recovery: giveawayPhaseRecoveryText(phase, status),
  };
};

export const phaseStatusFromOutbound = (message: OutboundMessageRecord) => {
  if (message.status === "failed") return "failed";
  if (isPendingOutboundStatus(message.status)) return "pending";
  if (message.status === "sent" || message.status === "resent") return "sent";
  return message.status;
};

export const giveawayPhaseDeliveryDetail = (
  phase: GiveawayAnnouncementPhase,
  status: string,
  latest: OutboundMessageRecord | undefined,
) => {
  if (!latest) {
    return status === "missing"
      ? `${phase.label} announcement has no outbound record.`
      : `${phase.label} announcement is not required yet.`;
  }

  if (latest.status === "sent") {
    return `Send confirmed at ${latest.updatedAt}.`;
  }

  if (latest.status === "resent") {
    return `Resent as a replacement at ${latest.updatedAt}.`;
  }

  if (latest.status === "queued") {
    return "Queued; wait for send confirmation before continuing.";
  }

  if (latest.status === "sending") {
    return "Sending now; wait for confirmation before continuing.";
  }

  if (latest.status === "retrying") {
    return latest.nextAttemptAt
      ? `Retry scheduled at ${latest.nextAttemptAt}.`
      : "Retrying after a send failure.";
  }

  if (latest.status === "failed") {
    return latest.reason || "Send failed.";
  }

  return `${phase.label} announcement status: ${latest.status}.`;
};

export const giveawayPhaseRecoveryText = (
  phase: GiveawayAnnouncementPhase,
  status: string,
) => {
  if (status === "failed") {
    return `Resend the ${phase.label} announcement if chat missed it.`;
  }

  if (status === "missing") {
    return `Send the missing ${phase.label} announcement before continuing.`;
  }

  if (status === "pending") {
    return `Wait for the ${phase.label} announcement to leave the outbound queue.`;
  }

  if (status === "sent") {
    return `${phase.label} announcement is covered.`;
  }

  return "No recovery action needed yet.";
};

export const summarizeGiveawayRecap = (
  state: ReturnType<GiveawaysService["getLatestGiveawayState"]>,
  assurance = summarizeGiveawayAssurance(state),
) => {
  if (!state.giveaway) {
    return {
      available: false,
    };
  }

  const activeWinners = state.winners.filter((winner) => !winner.rerolled_at);
  const deliveredWinners = activeWinners.filter(
    (winner) => winner.delivered_at,
  );
  const pendingDelivery = activeWinners.filter(
    (winner) => !winner.delivered_at,
  );
  const messages = outboundHistory
    .list()
    .filter(
      (message) =>
        message.category === "giveaway" &&
        Number(message.giveawayId) === Number(state.giveaway?.id),
    );
  const criticalMessages = messages.filter(
    (message) => message.importance === "critical",
  );
  const failedMessages = messages.filter(
    (message) => message.status === "failed",
  );

  return {
    available: true,
    id: state.giveaway.id,
    title: state.giveaway.title,
    status: state.giveaway.status,
    entryCount: state.counts.entries,
    activeWinnerCount: activeWinners.length,
    deliveredWinnerCount: deliveredWinners.length,
    pendingDeliveryCount: pendingDelivery.length,
    rerolledCount: state.counts.rerolledWinners,
    criticalMessageCount: criticalMessages.length,
    failedMessageCount: failedMessages.length,
    criticalFailedCount: criticalMessages.filter(
      (message) => message.status === "failed",
    ).length,
    sentMessageCount: assurance.summary.sent,
    resentMessageCount: assurance.summary.resent,
    pendingMessageCount: assurance.summary.pending,
    requiredCriticalCount: assurance.summary.requiredCritical,
    confirmedCriticalCount: assurance.summary.confirmedCritical,
    pendingCriticalCount: assurance.summary.pendingCritical,
    missingCriticalCount: assurance.summary.missingCritical,
    blockingCriticalCount: assurance.summary.blockingCritical,
    winners: activeWinners.map((winner) => ({
      login: winner.login,
      displayName: winner.display_name,
      delivered: Boolean(winner.delivered_at),
    })),
  };
};

export const giveawayOutboundMessagesFor = (giveawayId: number | undefined) =>
  outboundHistory
    .list()
    .filter(
      (message) =>
        message.category === "giveaway" &&
        giveawayId !== undefined &&
        Number(message.giveawayId) === Number(giveawayId),
    );

export const latestOutboundForActions = (
  giveawayId: number | undefined,
  actions: readonly string[],
  messages = giveawayOutboundMessagesFor(giveawayId),
) =>
  messages.find(
    (message) =>
      actions.includes(message.action) &&
      giveawayId !== undefined &&
      Number(message.giveawayId) === Number(giveawayId),
  );
