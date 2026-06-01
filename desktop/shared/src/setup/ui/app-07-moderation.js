function renderModeration() {
  const settings = state.moderation?.settings || {};
  const hits = state.moderationHits || [];
  const terms = state.moderationTerms || [];
  const allowedLinks = state.moderationAllowedLinks || [];
  const blockedLinks = state.moderationBlockedLinks || [];
  const linkPermits = state.moderationLinkPermits || [];
  const enforcement = state.moderationEnforcement || {};

  return [
    sectionHeader(
      "Moderation",
      "Lightweight local filters with scoped warn, delete, and timeout actions.",
      h("div", { className: "actions section-actions" }, [
        actionButton("Refresh", {
          id: "refreshModeration",
          variant: "secondary",
          busyKey: "refresh",
          onClick: refreshAll,
        }),
      ]),
    ),
    renderFeatureGateCard("moderation_filters"),
    renderModerationSuggestionCard(),
    card("Filter Settings", [
      statusGrid([
        [
          "Filters enabled",
          state.moderationSummary.filtersEnabled || 0,
          Number(state.moderationSummary.filtersEnabled || 0) > 0,
        ],
        [
          "Blocked phrases",
          `${state.moderationSummary.enabledTerms || 0}/${state.moderationSummary.terms || 0}`,
          true,
        ],
        [
          "Allowed domains",
          `${state.moderationSummary.enabledAllowedLinks || 0}/${state.moderationSummary.allowedLinks || 0}`,
          true,
        ],
        [
          "Blocked domains",
          `${state.moderationSummary.enabledBlockedLinks || 0}/${state.moderationSummary.blockedLinks || 0}`,
          true,
        ],
        [
          "Active permits",
          state.moderationSummary.activeLinkPermits || 0,
          true,
        ],
        [
          "Enforced filters",
          state.moderationSummary.enforcementFilters || 0,
          true,
        ],
        [
          "Bot Shield",
          state.moderationSummary.botShield || "off",
          Boolean(
            state.moderationSummary.botShield &&
            state.moderationSummary.botShield !== "off",
          ),
        ],
        [
          "Escalation",
          state.moderationSummary.escalation || "off",
          Boolean(
            state.moderationSummary.escalation &&
            state.moderationSummary.escalation !== "off",
          ),
        ],
        ["Recent hits", state.moderationSummary.hits || 0, true],
      ]),
      h("h3", { text: "Actions" }),
      h("div", { className: "grid three" }, [
        formRow(
          "Blocked phrases",
          moderationActionSelect("blockedTermsAction"),
        ),
        formRow("Links", moderationActionSelect("linkFilterAction")),
        formRow("Excessive caps", moderationActionSelect("capsFilterAction")),
        formRow(
          "Repeated messages",
          moderationActionSelect("repeatFilterAction"),
        ),
        formRow("Symbol spam", moderationActionSelect("symbolFilterAction")),
        formRow("Bot Shield", moderationActionSelect("botShieldAction")),
        formRow(
          "Timeout seconds",
          h("input", {
            id: "timeoutSeconds",
            type: "number",
            min: "10",
            max: "1200",
            onInput: updateModerationDraft,
          }),
        ),
      ]),
      statusGrid([
        [
          "Delete scope",
          enforcement.deleteMessages?.available ? "available" : "unavailable",
          Boolean(enforcement.deleteMessages?.available),
        ],
        [
          "Timeout scope",
          enforcement.timeoutUsers?.available ? "available" : "unavailable",
          Boolean(enforcement.timeoutUsers?.available),
        ],
        ["Live mode", enforcement.mode || "off", enforcement.mode === "live"],
      ]),
      callout(
        enforcement.nextAction ||
          "Warn-only moderation works without optional enforcement scopes.",
        enforcement.missingScopes?.length ? "warn" : "info",
      ),
      h("div", { className: "grid three" }, [
        h("label", { className: "inline-check" }, [
          h("input", {
            id: "blockedTermsEnabled",
            type: "checkbox",
            onChange: updateModerationDraft,
          }),
          "Blocked phrases",
        ]),
        h("label", { className: "inline-check" }, [
          h("input", {
            id: "linkFilterEnabled",
            type: "checkbox",
            onChange: updateModerationDraft,
          }),
          "Links",
        ]),
        h("label", { className: "inline-check" }, [
          h("input", {
            id: "capsFilterEnabled",
            type: "checkbox",
            onChange: updateModerationDraft,
          }),
          "Excessive caps",
        ]),
        h("label", { className: "inline-check" }, [
          h("input", {
            id: "repeatFilterEnabled",
            type: "checkbox",
            onChange: updateModerationDraft,
          }),
          "Repeated messages",
        ]),
        h("label", { className: "inline-check" }, [
          h("input", {
            id: "symbolFilterEnabled",
            type: "checkbox",
            onChange: updateModerationDraft,
          }),
          "Symbol spam",
        ]),
        h("label", { className: "inline-check" }, [
          h("input", {
            id: "botShieldEnabled",
            type: "checkbox",
            onChange: updateModerationDraft,
          }),
          "Bot Shield",
        ]),
        formRow(
          "Warning message",
          h("input", {
            id: "moderationWarningMessage",
            placeholder: "@{user}, please keep chat within channel guidelines.",
            onInput: updateModerationDraft,
          }),
        ),
      ]),
      callout(
        "Bot Shield is heuristic. It scores likely follower/viewer spam using message text, risky links, promo domains, and randomized usernames; use Local Test before live enforcement.",
        "muted",
      ),
      h("div", { className: "grid three" }, [
        formRow(
          "Caps min length",
          h("input", {
            id: "capsMinLength",
            type: "number",
            min: "5",
            max: "450",
            onInput: updateModerationDraft,
          }),
        ),
        formRow(
          "Caps ratio",
          h("input", {
            id: "capsRatio",
            type: "number",
            min: "0.1",
            max: "1",
            step: "0.05",
            onInput: updateModerationDraft,
          }),
        ),
        formRow(
          "Repeat limit",
          h("input", {
            id: "repeatLimit",
            type: "number",
            min: "2",
            max: "20",
            onInput: updateModerationDraft,
          }),
        ),
        formRow(
          "Repeat window seconds",
          h("input", {
            id: "repeatWindowSeconds",
            type: "number",
            min: "5",
            max: "600",
            onInput: updateModerationDraft,
          }),
        ),
        formRow(
          "Symbol min length",
          h("input", {
            id: "symbolMinLength",
            type: "number",
            min: "5",
            max: "450",
            onInput: updateModerationDraft,
          }),
        ),
        formRow(
          "Symbol ratio",
          h("input", {
            id: "symbolRatio",
            type: "number",
            min: "0.1",
            max: "1",
            step: "0.05",
            onInput: updateModerationDraft,
          }),
        ),
        formRow(
          "Bot Shield score",
          h("input", {
            id: "botShieldScoreThreshold",
            type: "number",
            min: "30",
            max: "100",
            onInput: updateModerationDraft,
          }),
        ),
      ]),
      h("h3", { text: "Escalation" }),
      callout(
        "Optional repeat-hit escalation upgrades the same user's recent moderation hits from warn to delete to timeout. It never bypasses trusted-role exemptions or scope checks.",
        "muted",
      ),
      h("div", { className: "grid four" }, [
        h("label", { className: "inline-check editor-check" }, [
          h("input", {
            id: "escalationEnabled",
            type: "checkbox",
            onChange: updateModerationDraft,
          }),
          "Enable escalation",
        ]),
        formRow(
          "Window seconds",
          h("input", {
            id: "escalationWindowSeconds",
            type: "number",
            min: "30",
            max: "3600",
            onInput: updateModerationDraft,
          }),
        ),
        formRow(
          "Delete after hits",
          h("input", {
            id: "escalationDeleteAfter",
            type: "number",
            min: "2",
            max: "25",
            onInput: updateModerationDraft,
          }),
        ),
        formRow(
          "Timeout after hits",
          h("input", {
            id: "escalationTimeoutAfter",
            type: "number",
            min: "2",
            max: "25",
            onInput: updateModerationDraft,
          }),
        ),
      ]),
      h("h3", { text: "Trusted Roles" }),
      h("div", { className: "grid four" }, [
        h("label", { className: "inline-check" }, [
          h("input", {
            id: "exemptBroadcaster",
            type: "checkbox",
            onChange: updateModerationDraft,
          }),
          "Broadcaster",
        ]),
        h("label", { className: "inline-check" }, [
          h("input", {
            id: "exemptModerators",
            type: "checkbox",
            onChange: updateModerationDraft,
          }),
          "Moderators",
        ]),
        h("label", { className: "inline-check" }, [
          h("input", {
            id: "exemptVips",
            type: "checkbox",
            onChange: updateModerationDraft,
          }),
          "VIPs",
        ]),
        h("label", { className: "inline-check" }, [
          h("input", {
            id: "exemptSubscribers",
            type: "checkbox",
            onChange: updateModerationDraft,
          }),
          "Subscribers",
        ]),
      ]),
      callout(
        "Moderation filters fail open and never ban. Protected bot commands and active giveaway entry commands are exempt. Warnings always use the outbound queue.",
        "info",
      ),
      h("div", { className: "actions" }, [
        actionButton("Save moderation settings", {
          id: "saveModerationSettings",
          onClick: saveModerationSettings,
        }),
      ]),
    ]),
    card("Blocked Phrases", [
      h("div", { className: "grid" }, [
        formRow(
          "Phrase or word",
          h("input", {
            id: "moderationTerm",
            placeholder: "phrase",
            onInput: updateModerationTermDraft,
          }),
        ),
        h("label", { className: "inline-check editor-check" }, [
          h("input", {
            id: "moderationTermEnabled",
            type: "checkbox",
            onChange: updateModerationTermDraft,
          }),
          "Enabled",
        ]),
      ]),
      callout(
        "Plain words and phrases use boundary-aware matching. Use * only when you intentionally want wildcard matching.",
        "muted",
      ),
      h("div", { className: "actions" }, [
        actionButton("Save phrase", {
          id: "saveModerationTerm",
          variant: "secondary",
          onClick: saveModerationTerm,
        }),
      ]),
      dataTable(
        ["Phrase", "State", "Actions"],
        terms.map((term) => [
          term.term,
          statusChip(term.enabled ? "enabled" : "disabled"),
          h("div", { className: "actions inline-actions table-actions" }, [
            actionButton(term.enabled ? "Disable" : "Enable", {
              id: `moderation-term-enable-${term.id}`,
              variant: "secondary",
              busyKey: "moderationTermEnable",
              onClick: () => toggleModerationTerm(term.id, !term.enabled),
            }),
            actionButton("Delete", {
              id: `moderation-term-delete-${term.id}`,
              variant: "danger",
              busyKey: "moderationTermDelete",
              onClick: () => deleteModerationTerm(term.id, term.term),
            }),
          ]),
        ]),
      ),
    ]),
    card("Blocked Link Domains", [
      h("div", { className: "grid" }, [
        formRow(
          "Domain",
          h("input", {
            id: "moderationBlockedDomain",
            placeholder: "bad.example",
            onInput: updateModerationBlockedLinkDraft,
          }),
        ),
        h("label", { className: "inline-check editor-check" }, [
          h("input", {
            id: "moderationBlockedDomainEnabled",
            type: "checkbox",
            onChange: updateModerationBlockedLinkDraft,
          }),
          "Enabled",
        ]),
      ]),
      h("div", { className: "actions" }, [
        actionButton("Save blocked domain", {
          id: "saveModerationBlockedLink",
          variant: "secondary",
          onClick: saveModerationBlockedLink,
        }),
      ]),
      dataTable(
        ["Domain", "State", "Actions"],
        blockedLinks.map((link) => [
          link.domain,
          statusChip(link.enabled ? "enabled" : "disabled"),
          h("div", { className: "actions inline-actions table-actions" }, [
            actionButton(link.enabled ? "Disable" : "Enable", {
              id: `moderation-blocked-link-enable-${link.id}`,
              variant: "secondary",
              busyKey: "moderationBlockedLinkEnable",
              onClick: () =>
                toggleModerationBlockedLink(link.id, !link.enabled),
            }),
            actionButton("Delete", {
              id: `moderation-blocked-link-delete-${link.id}`,
              variant: "danger",
              busyKey: "moderationBlockedLinkDelete",
              onClick: () => deleteModerationBlockedLink(link.id, link.domain),
            }),
          ]),
        ]),
      ),
    ]),
    card("Allowed Link Domains", [
      h("div", { className: "grid" }, [
        formRow(
          "Domain",
          h("input", {
            id: "moderationAllowedDomain",
            placeholder: "example.com",
            onInput: updateModerationAllowedLinkDraft,
          }),
        ),
        h("label", { className: "inline-check editor-check" }, [
          h("input", {
            id: "moderationAllowedDomainEnabled",
            type: "checkbox",
            onChange: updateModerationAllowedLinkDraft,
          }),
          "Enabled",
        ]),
      ]),
      h("div", { className: "actions" }, [
        actionButton("Save allowed domain", {
          id: "saveModerationAllowedLink",
          variant: "secondary",
          onClick: saveModerationAllowedLink,
        }),
      ]),
      dataTable(
        ["Domain", "State", "Actions"],
        allowedLinks.map((link) => [
          link.domain,
          statusChip(link.enabled ? "enabled" : "disabled"),
          h("div", { className: "actions inline-actions table-actions" }, [
            actionButton(link.enabled ? "Disable" : "Enable", {
              id: `moderation-allowed-link-enable-${link.id}`,
              variant: "secondary",
              busyKey: "moderationAllowedLinkEnable",
              onClick: () =>
                toggleModerationAllowedLink(link.id, !link.enabled),
            }),
            actionButton("Delete", {
              id: `moderation-allowed-link-delete-${link.id}`,
              variant: "danger",
              busyKey: "moderationAllowedLinkDelete",
              onClick: () => deleteModerationAllowedLink(link.id, link.domain),
            }),
          ]),
        ]),
      ),
    ]),
    card("Temporary Link Permits", [
      h("div", { className: "grid three" }, [
        formRow(
          "Username",
          h("input", {
            id: "moderationPermitUser",
            placeholder: "viewer",
            onInput: updateModerationPermitDraft,
          }),
        ),
        formRow(
          "Minutes",
          h("input", {
            id: "moderationPermitMinutes",
            type: "number",
            min: "1",
            max: "120",
            onInput: updateModerationPermitDraft,
          }),
        ),
        h("div", { className: "actions align-end" }, [
          actionButton("Grant permit", {
            id: "grantModerationLinkPermit",
            variant: "secondary",
            onClick: grantModerationLinkPermit,
          }),
        ]),
      ]),
      dataTable(
        ["User", "State", "Expires", "Used", "Created by"],
        linkPermits.map((permit) => [
          permit.userLogin,
          statusChip(
            permit.active ? "active" : permit.usedAt ? "used" : "expired",
          ),
          permit.expiresAt || "",
          permit.usedAt || "not used",
          permit.createdBy || "",
        ]),
      ),
    ]),
    card("Local Test", [
      h("div", { className: "grid three" }, [
        formRow(
          "Actor",
          h("input", { id: "moderationTestActor", placeholder: "viewer" }),
        ),
        formRow(
          "Role",
          h("select", { id: "moderationTestRole" }, [
            option("viewer", "viewer"),
            option("subscriber", "subscriber"),
            option("vip", "vip"),
            option("mod", "mod"),
            option("broadcaster", "broadcaster"),
          ]),
        ),
        formRow(
          "Message",
          h("input", {
            id: "moderationTestText",
            placeholder: "test chat message",
          }),
        ),
      ]),
      h("div", { className: "actions" }, [
        actionButton("Run moderation test", {
          id: "runModerationTest",
          variant: "secondary",
          onClick: runModerationTest,
        }),
      ]),
      renderModerationTestResult(),
    ]),
    card("Recent Hits", [
      dataTable(
        ["Timestamp", "Filter", "User", "Action", "Detail", "Message"],
        hits
          .slice(0, 25)
          .map((hit) => [
            hit.createdAt || "",
            hit.filterType || "",
            hit.userLogin || "",
            hit.action || "warn",
            hit.detail || "",
            formatMessagePreview(hit.messagePreview || ""),
          ]),
      ),
    ]),
    message(),
  ];
}
