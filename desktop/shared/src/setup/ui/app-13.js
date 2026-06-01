function renderAuditLog() {
  return [
    sectionHeader(
      "Post-Stream Log",
      "Post-stream review and latest 100 local audit entries.",
      actionButton("Refresh audit log", {
        id: "refreshAudit",
        onClick: refreshAuditLogs,
      }),
    ),
    renderPostStreamReviewCard(),
    card("", [
      dataTable(
        ["Timestamp", "Actor", "Action", "Target", "Metadata"],
        state.auditLogs.map((log) => [
          log.created_at,
          log.actor_twitch_user_id,
          log.action,
          log.target || "",
          summarizeMetadata(log.metadata_json),
        ]),
      ),
    ]),
  ];
}

function renderPostStreamReviewCard() {
  const review = postStreamReviewData();
  const failures = review.outbound.failures.slice(0, 8);

  return card("Post-Stream Review", [
    statusGrid([
      [
        "Giveaway",
        review.giveaway.available ? `#${review.giveaway.id}` : "none",
        review.giveaway.available,
      ],
      ["Entries", review.giveaway.entries, true],
      ["Winners", review.giveaway.winners.length, true],
      [
        "Pending Delivery",
        review.giveaway.pendingDelivery,
        review.giveaway.pendingDelivery === 0,
      ],
      [
        "Blocking Critical",
        review.outbound.blockingCritical,
        review.outbound.blockingCritical === 0,
      ],
      [
        "Critical Pending",
        review.outbound.pendingCritical,
        review.outbound.pendingCritical === 0,
      ],
      [
        "Critical Failed",
        review.outbound.criticalFailed,
        review.outbound.criticalFailed === 0,
      ],
      ["Outbound Failed", review.outbound.failed, review.outbound.failed === 0],
      ["Retries", review.outbound.retries, true],
      [
        "Bot Errors",
        review.runtime.errorCount,
        review.runtime.errorCount === 0,
      ],
    ]),
    callout(review.nextAction, review.tone),
    review.giveaway.winners.length
      ? dataTable(
          ["Winner", "Login", "Delivered"],
          review.giveaway.winners.map((winner) => [
            winner.displayName,
            winner.login,
            winner.delivered ? "yes" : "pending",
          ]),
        )
      : callout("No winner rows available for the latest giveaway.", "muted"),
    failures.length
      ? dataTable(
          ["Updated", "Action", "Category", "Attempts", "Message"],
          failures.map((item) => [
            item.updatedAt || "",
            item.action || "message",
            failureCategoryChip(item.failureCategory),
            item.attempts || 0,
            formatMessagePreview(item.message),
          ]),
        )
      : callout("No outbound failures are currently tracked.", "ok"),
    h("div", { className: "actions" }, [
      actionButton("Copy review", {
        id: "copyPostStreamReview",
        variant: "secondary",
        busyKey: "copyPostStreamReview",
        onClick: copyPostStreamReview,
      }),
      actionButton("Export review JSON", {
        id: "exportPostStreamReview",
        variant: "secondary",
        busyKey: "exportPostStreamReview",
        onClick: exportPostStreamReviewJson,
      }),
    ]),
  ]);
}

function connectButton(config, variant = "secondary", forceDisabled = false) {
  const disabled =
    forceDisabled ||
    missingConfigFields(config).some((item) =>
      ["Client ID", "Client Secret", "Redirect URI", "Bot Login"].includes(
        item,
      ),
    );
  const label = config?.botLogin
    ? `Connect Twitch as ${config.botLogin}`
    : "Connect Twitch as Bot Login";
  const title = oauthAccountInstruction(config);
  const link = h("a", {
    className: `button ${variant}${disabled ? " disabled" : ""}`,
    "data-action": "connect-twitch",
    href: disabled ? "#" : "/auth/twitch/start",
    title: disabled
      ? "Save Client ID, Client Secret, Redirect URI, and Bot Login first."
      : title,
    text: label,
  });
  if (disabled) {
    link.title =
      "Save Client ID, Client Secret, Redirect URI, and Bot Login first.";
  }
  return link;
}

function oauthAccountInstruction(config = {}) {
  const bot = config.botLogin || "the Bot Login account";
  const broadcaster =
    config.broadcasterLogin || "the Broadcaster Login channel";

  if (
    config.botLogin &&
    config.broadcasterLogin &&
    config.botLogin === config.broadcasterLogin
  ) {
    return `Log into Twitch as ${bot}. This account is both the bot and broadcaster.`;
  }

  return `Log into Twitch as the Bot Login account (${bot}), not the Broadcaster Login (${broadcaster}), unless they are the same account.`;
}

function oauthAccountCallout(config = {}) {
  return callout(oauthAccountInstruction(config), "info");
}

function renderEntrantsTable() {
  const entries = [...(state.giveaway?.entries || [])].sort((a, b) =>
    String(a.entered_at).localeCompare(String(b.entered_at)),
  );
  const filtered = entries.filter((entry) =>
    entry.login.includes(state.entrantFilter.toLowerCase()),
  );
  return h("div", {}, [
    h("div", { className: "toolbar" }, [
      formRow(
        "Search login",
        h("input", {
          id: "entrantFilter",
          placeholder: "filter by login",
          onInput: (event) => {
            state.entrantFilter = event.target.value;
            render();
          },
        }),
      ),
      h("span", {
        className: "count",
        text: `${filtered.length} of ${entries.length} visible`,
      }),
    ]),
    dataTable(
      ["User", "Eligibility", "Follow age", "Entered", "Action"],
      filtered.map((entry) => [
        `${entry.display_name} @${entry.login}`,
        entry.eligibility_status || "eligible",
        entry.follow_age_days
          ? `${entry.follow_age_days} day(s)`
          : entry.followed_at
            ? "verified"
            : "",
        entry.entered_at,
        actionButton("Remove", {
          variant: "secondary",
          onClick: () => removeEntrant(entry.login),
        }),
      ]),
    ),
  ]);
}

function renderWinnersTable() {
  const winners = filterWinners(state.giveaway?.winners || []);
  return h("div", {}, [
    h("div", { className: "toolbar" }, [
      formRow(
        "Filter",
        h(
          "select",
          {
            id: "winnerFilter",
            onChange: (event) => {
              state.winnerFilter = event.target.value;
              render();
            },
          },
          [
            option("all", "all"),
            option("pending", "pending delivery"),
            option("delivered", "delivered"),
            option("rerolled", "rerolled"),
          ],
        ),
      ),
      h("span", { className: "count", text: `${winners.length} visible` }),
    ]),
    dataTable(
      [
        "User",
        "Status",
        "Response deadline",
        "Platform",
        "Region",
        "Purchase",
        "Drawn",
        "Delivered",
      ],
      winners.map((winner) => [
        `${winner.display_name} @${winner.login}`,
        winner.status || winnerStatus(winner),
        winner.response_expires_at || "",
        winner.selected_platform || "",
        winner.region_country || "",
        winner.purchase_status || "not_purchased",
        winner.drawn_at,
        winner.delivered_at || "",
      ]),
    ),
  ]);
}

function dataTable(headers, rows) {
  if (!rows.length) {
    return h("div", { className: "table-wrap" }, [
      h("div", { className: "empty", text: "No rows to show." }),
    ]);
  }

  return h("div", { className: "table-wrap" }, [
    h("table", {}, [
      h("thead", {}, [
        h(
          "tr",
          {},
          headers.map((header) => h("th", { text: header })),
        ),
      ]),
      h(
        "tbody",
        {},
        rows.map((row) =>
          h(
            "tr",
            {},
            row.map((cell) =>
              h("td", {}, cell?.nodeType ? [cell] : [String(cell ?? "")]),
            ),
          ),
        ),
      ),
    ]),
  ]);
}

function list(items, tone) {
  return h(
    "ul",
    {},
    items.map((item) => h("li", { className: tone, text: item })),
  );
}

function option(value, label) {
  return h("option", { value, text: label });
}

function giveawayRows(summary = {}) {
  const config = summary.config || {};
  const timer = summary.timer || {};
  return [
    ["Status", summary.status || "none"],
    ["Title", summary.title || "none"],
    [
      "Prize",
      [config.gameName, config.itemEdition].filter(Boolean).join(" - ") ||
        config.itemName ||
        "none",
    ],
    ["Keyword", summary.keyword || "enter"],
    ["Winners", `${summary.winnersDrawn || 0}/${summary.winnerCount || 0}`],
    ["Entries", summary.entryCount || 0],
    [
      "Timer",
      timer.running ? formatRemaining(timer.remainingMs) : "not running",
    ],
    ["Pending", summary.pendingConfirmationCount || 0],
    ["Expired", summary.expiredWinnerCount || 0],
    [
      "Enough Entrants",
      summary.enoughEntrantsForFullDraw ? "yes" : "no",
      summary.enoughEntrantsForFullDraw,
    ],
    [
      "Undelivered",
      summary.undeliveredWinnersCount || 0,
      Number(summary.undeliveredWinnersCount || 0) === 0,
    ],
    ["Rerolled", summary.rerolledCount || 0],
  ];
}

function formatRemaining(ms = 0) {
  const seconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function currentLaunchPreparation() {
  return (
    state.launchPreparation ||
    state.status?.launchPreparation ||
    state.diagnostics?.launchPreparation ||
    null
  );
}

function visibleValidationChecks() {
  if (state.validationChecks.length) return state.validationChecks;

  const launch = currentLaunchPreparation();
  if (launch?.validation?.checks?.length) return launch.validation.checks;
  if (
    ["setup_required", "error"].includes(launch?.status) &&
    launch?.checks?.length
  )
    return launch.checks;
  return [];
}

function renderSettingsLaunchNotice() {
  const launch = currentLaunchPreparation();

  if (!launch || ["pending", "ready"].includes(launch.status)) {
    return null;
  }

  if (
    isRelayChatbotMode() &&
    ["setup_required", "error"].includes(launch.status)
  ) {
    return callout(
      "Local Twitch OAuth launch checks are incomplete, but Relay chatbot mode is selected. Use the hosted Relay Setup Guide for Chat Bot readiness; the local Connect Twitch flow remains available as a fallback.",
      "info",
    );
  }

  const tone = launchTone(launch);
  const summary = launch.summary || "Automatic launch checks need attention.";
  const nextAction =
    launch.nextAction && launch.nextAction !== summary
      ? ` ${launch.nextAction}`
      : "";

  return callout(`${summary}${nextAction}`, tone);
}

function launchTone(launch = currentLaunchPreparation()) {
  if (!launch) return "muted";
  if (launch.status === "ready") return "ok";
  if (launch.status === "setup_required" || launch.status === "error")
    return "bad";
  if (launch.status === "running" || launch.status === "attention")
    return "warn";
  return "muted";
}

function syncLaunchPreparation(payload = {}) {
  const launch =
    payload.launchPreparation ||
    payload.diagnostics?.launchPreparation ||
    (payload.status && payload.step && Array.isArray(payload.checks)
      ? payload
      : null);
  if (!launch) return;

  state.launchPreparation = launch;

  if (launch.validation?.checks?.length) {
    state.validationChecks = launch.validation.checks;
  }

  if (launch.preflight?.checks?.length) {
    state.preflightResult = launch.preflight;
  }

  if (launch.setupReady) {
    state.validSetup = true;
  } else if (["setup_required", "error"].includes(launch.status)) {
    state.validSetup = false;
  }
}

function getReadiness() {
  const runtime = state.status?.runtime || {};
  const launch = currentLaunchPreparation();
  const blockers = [];

  if (launch?.status === "running") {
    blockers.push("Automatic launch checks are still running");
  } else if (!isTwitchSetupReady()) {
    blockers.push("Open Configuration Settings -> Setup Guide");
  }
  if (!runtime.tokenValid || !runtime.requiredScopesPresent) {
    blockers.push(
      launch?.nextAction ||
        "Reconnect Twitch if automatic launch validation cannot confirm the saved token",
    );
  }
  if (!runtime.queueReady)
    blockers.push(
      "Start the setup console again if queue readiness does not recover",
    );
  if (
    runtime.outboundRecovery?.needed &&
    runtime.outboundRecovery.severity === "critical"
  ) {
    blockers.push(
      `Resolve critical outbound chat failure: ${runtime.outboundRecovery.nextAction}`,
    );
  }
  if (!runtime.eventSubConnected || !runtime.chatSubscriptionActive)
    blockers.push("Start bot process");
  if (!runtime.liveChatConfirmed) blockers.push("Type !ping in chat");

  const nextAction =
    blockers[0] ||
    (state.status?.giveaway?.status === "none"
      ? "Giveaway controls ready"
      : nextGiveawayAction(state.status.giveaway));

  return {
    ready: blockers.length === 0,
    blockers,
    nextAction,
  };
}
