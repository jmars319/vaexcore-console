function moderationActionSelect(id) {
  return h("select", { id, onChange: updateModerationDraft }, [
    option("warn", "warn"),
    option("delete", "delete"),
    option("timeout", "timeout"),
  ]);
}
function renderGiveaways() {
  const giveaway = state.giveaway;
  const summary = giveaway?.summary || state.status?.giveaway || {};
  return [
    sectionHeader(
      "Giveaways",
      "Operate entries, winner selection, and manual prize delivery from one place.",
    ),
    card("", [
      callout(
        "vaexcore console does not store or reveal giveaway prizes. Delivery remains manual.",
        "warn",
      ),
      statusGrid([
        ...giveawayRows(summary),
        [
          "Delivery",
          summary.manualCodeDeliveryRequired
            ? "manual delivery required"
            : "none",
          !summary.manualCodeDeliveryRequired,
        ],
      ]),
      h("p", {
        className: "warn",
        text: (summary.endWarnings || []).join(" "),
      }),
    ]),
    card("Readiness Checklist", [list(giveawayChecklist(), "muted")]),
    renderGiveawayReminderCard(),
    renderGiveawayTemplatesCard(),
    renderGiveawayRecapCard(),
    renderGiveawayOutboundCard(),
    card("Structured Game-Key Giveaway", [
      h("div", { className: "grid three" }, [
        formRow(
          "Title",
          h("input", { id: "giveawayTitle", onInput: updateGiveawayDraft }),
        ),
        formRow(
          "Keyword",
          h("input", { id: "giveawayKeyword", onInput: updateGiveawayDraft }),
        ),
        formRow(
          "Number of winners",
          h("input", {
            id: "winnerCount",
            type: "number",
            min: "1",
            onInput: updateGiveawayDraft,
          }),
        ),
        formRow(
          "Entry window minutes",
          h("input", {
            id: "entryWindowMinutes",
            type: "number",
            min: "1",
            onInput: updateGiveawayDraft,
          }),
        ),
        formRow(
          "Item name",
          h("input", { id: "itemName", onInput: updateGiveawayDraft }),
        ),
        formRow(
          "Game name",
          h("input", { id: "gameName", onInput: updateGiveawayDraft }),
        ),
        formRow(
          "Item edition",
          h("input", { id: "itemEdition", onInput: updateGiveawayDraft }),
        ),
        formRow(
          "Prize type",
          h("select", { id: "prizeType", onChange: updateGiveawayDraft }, [
            option("standard_game_key", "standard game key"),
            option("deluxe_game_key", "deluxe game key"),
            option("dlc_key", "dlc key"),
            option("other", "other"),
          ]),
        ),
        formRow(
          "Platform mode",
          h("select", { id: "platformMode", onChange: updateGiveawayDraft }, [
            option("winner_selects_after_win", "winner selects after win"),
            option("fixed_platform", "fixed platform"),
          ]),
        ),
        formRow(
          "Supported platforms",
          h("input", {
            id: "supportedPlatforms",
            onInput: updateGiveawayDraft,
          }),
        ),
        formRow(
          "Minimum follow age days",
          h("input", {
            id: "minimumFollowAgeDays",
            type: "number",
            min: "0",
            onInput: updateGiveawayDraft,
          }),
        ),
        formRow(
          "Response window minutes",
          h("input", {
            id: "responseWindowMinutes",
            type: "number",
            min: "1",
            onInput: updateGiveawayDraft,
          }),
        ),
        formRow(
          "Previous winner restriction",
          h(
            "select",
            {
              id: "previousWinnerRestrictionMode",
              onChange: updateGiveawayDraft,
            },
            [
              option("base_game_blocks_deluxe", "base game blocks deluxe"),
              option("exact_item_only", "exact item only"),
              option("none", "none"),
            ],
          ),
        ),
        formRow(
          "Marketplace",
          h("input", { id: "marketplaceName", onInput: updateGiveawayDraft }),
        ),
        formRow(
          "Marketplace note",
          h("input", { id: "marketplaceNote", onInput: updateGiveawayDraft }),
        ),
        formRow(
          "Age guidance",
          h("input", { id: "ageGuidanceText", onInput: updateGiveawayDraft }),
        ),
        formRow(
          "Region availability note",
          h("input", {
            id: "regionAvailabilityDisclaimer",
            onInput: updateGiveawayDraft,
          }),
        ),
      ]),
      callout(
        "Marketplace disclosure stays neutral: Marketplace: Eneba. Key purchased after winner confirms platform/region. Not sponsored. No affiliate link.",
        "muted",
      ),
      h("div", { className: "actions" }, [
        actionButton("Start giveaway", {
          id: "gstart",
          onClick: startGiveaway,
        }),
        actionButton("Save config", {
          id: "gconfig",
          variant: "secondary",
          onClick: saveGiveawayConfig,
        }),
        actionButton("Start/reset timer", {
          id: "gtimerStart",
          variant: "secondary",
          onClick: () =>
            runGiveawayAction("timer", {
              action: "reset",
              minutes: Number(field("entryWindowMinutes").value || 10),
            }),
        }),
        actionButton("Stop timer", {
          id: "gtimerStop",
          variant: "secondary",
          onClick: () => runGiveawayAction("timer", { action: "stop" }),
        }),
        h("a", {
          className: "button secondary",
          href: "/giveaway-overlay",
          target: "_blank",
          rel: "noreferrer",
          text: "Open OBS overlay",
        }),
        actionButton("Send last call", {
          id: "glastcall",
          busyKey: "glast-call",
          variant: "secondary",
          onClick: () => runGiveawayAction("last-call"),
        }),
        actionButton("Close entries", {
          id: "gclose",
          variant: "secondary",
          onClick: () => runGiveawayAction("close"),
        }),
      ]),
    ]),
    card("Winner Operations", [
      h("div", { className: "grid three" }, [
        formRow(
          "Draw count",
          h("input", {
            id: "drawCount",
            type: "number",
            min: "1",
            onInput: updateGiveawayDraft,
          }),
        ),
        formRow(
          "Reroll winner",
          h("select", { id: "rerollSelect", onChange: updateGiveawayDraft }),
        ),
        formRow(
          "Claim winner",
          h("select", { id: "claimSelect", onChange: updateGiveawayDraft }),
        ),
        formRow(
          "Deliver winner",
          h("select", { id: "deliverSelect", onChange: updateGiveawayDraft }),
        ),
        formRow(
          "Confirm winner",
          h("select", { id: "confirmSelect", onChange: updateGiveawayDraft }),
        ),
        formRow(
          "Expire winner",
          h("select", { id: "expireSelect", onChange: updateGiveawayDraft }),
        ),
        formRow(
          "Purchase winner",
          h("select", {
            id: "purchaseStatusWinnerSelect",
            onChange: updateGiveawayDraft,
          }),
        ),
        formRow(
          "Selected platform",
          h("input", { id: "selectedPlatform", onInput: updateGiveawayDraft }),
        ),
        formRow(
          "Region/country",
          h("input", { id: "regionCountry", onInput: updateGiveawayDraft }),
        ),
        formRow(
          "Delivery method",
          h("input", { id: "deliveryMethod", onInput: updateGiveawayDraft }),
        ),
        formRow(
          "Marketplace used",
          h("input", { id: "marketplaceUsed", onInput: updateGiveawayDraft }),
        ),
        formRow(
          "Purchase status",
          h("select", { id: "purchaseStatus", onChange: updateGiveawayDraft }, [
            option("not_purchased", "not purchased"),
            option("pending_purchase", "pending purchase"),
            option("purchased", "purchased"),
            option("delivered", "delivered"),
            option(
              "activation_confirmed_optional",
              "activation confirmed optional",
            ),
          ]),
        ),
      ]),
      h("div", { className: "actions" }, [
        actionButton("Draw winners", {
          id: "gdraw",
          variant: "secondary",
          onClick: () =>
            runGiveawayAction(
              "draw",
              { count: Number(field("drawCount").value || 1) },
              "Draw winners now?",
            ),
        }),
        actionButton("Reroll", {
          id: "greroll",
          variant: "secondary",
          onClick: () =>
            runGiveawayAction(
              "reroll",
              { username: field("rerollSelect").value },
              "Reroll this winner?",
            ),
        }),
        actionButton("Confirm winner", {
          id: "gconfirm",
          variant: "secondary",
          onClick: confirmWinner,
        }),
        actionButton("Mark expired", {
          id: "gexpire",
          variant: "secondary",
          onClick: () =>
            runGiveawayAction("expire", {
              username: field("expireSelect").value,
            }),
        }),
        actionButton("Set purchase status", {
          id: "gpurchaseStatus",
          variant: "secondary",
          onClick: setWinnerPurchaseStatus,
        }),
        actionButton("Mark claimed", {
          id: "gclaim",
          variant: "secondary",
          onClick: () =>
            runGiveawayAction("claim", {
              username: field("claimSelect").value,
            }),
        }),
        actionButton("Mark delivered", {
          id: "gdeliver",
          variant: "secondary",
          onClick: () =>
            runGiveawayAction("deliver", {
              username: field("deliverSelect").value,
            }),
        }),
        actionButton("Copy winners", {
          id: "copyWinners",
          variant: "secondary",
          onClick: copyWinnerList,
        }),
        actionButton("Copy/export results", {
          id: "exportGiveawayResults",
          variant: "secondary",
          onClick: exportGiveawayResults,
        }),
        actionButton("Mark all delivered", {
          id: "gdeliverAll",
          variant: "secondary",
          onClick: () =>
            runGiveawayAction(
              "deliver-all",
              {},
              "Mark all active winners delivered?",
            ),
        }),
      ]),
      h("div", { className: "actions destructive-actions" }, [
        actionButton("End giveaway", {
          id: "gend",
          variant: "danger",
          onClick: endGiveaway,
        }),
      ]),
    ]),
    h("div", { className: "columns" }, [
      card("Entrants", [renderEntrantsTable()]),
      card("Winners", [renderWinnersTable()]),
    ]),
    message(),
  ];
}
function renderChatTools() {
  return [
    sectionHeader(
      "Chat Tools",
      "Send operator macros and verify outbound chat without changing giveaway state.",
    ),
    renderOperatorMessagesCard(),
    renderBotConfigBundleCard(),
    card("Outbound Chat", [
      formRow(
        "Message text",
        h("textarea", {
          id: "chatMessage",
          placeholder: "Message to send to Twitch chat",
        }),
      ),
      h("div", { className: "actions" }, [
        actionButton("Send message to chat", {
          id: "sendChat",
          onClick: () =>
            runAction("sendChat", () =>
              api.chatSend(field("chatMessage").value),
            ),
        }),
        actionButton("Send !ping / test ping", {
          id: "ping",
          variant: "secondary",
          onClick: () => runAction("ping", () => api.chatSend("!ping")),
        }),
        actionButton("Send setup test message", {
          id: "test",
          variant: "secondary",
          onClick: sendSetupTest,
        }),
      ]),
    ]),
    card("Command Echo", [
      h("p", {
        text: "Chat echo mirrors selected UI actions into Twitch chat. Echo messages use the normal outbound queue and rate limit.",
      }),
      h("label", { className: "inline-check" }, [
        h("input", { id: "echoToChat", type: "checkbox" }),
        "Echo equivalent operator commands to chat",
      ]),
    ]),
    renderOutboundHistoryCard(),
    message(),
  ];
}

function renderOperatorMessagesCard() {
  const templates = state.operatorMessages || [];

  return card("Operator Macros", [
    callout(
      "Reusable local chat macros only. They do not store prize codes and every send uses the normal outbound queue, history, and recovery flow.",
      "muted",
    ),
    h(
      "div",
      { className: "template-list" },
      templates.map((template) =>
        h("div", { className: "template-row operator-template-row" }, [
          h("span", {}, [
            h("strong", { text: template.label }),
            h("small", { text: template.description }),
            template.requiresConfirmation
              ? h("small", { className: "warn", text: "Requires confirmation" })
              : null,
          ]),
          h("textarea", {
            id: `operator-template-${template.id}`,
            "data-id": template.id,
            onInput: updateOperatorTemplateDraft,
          }),
          h("div", { className: "actions inline-actions" }, [
            actionButton("Send", {
              id: `operator-send-${template.id}`,
              variant: template.requiresConfirmation ? "danger" : "secondary",
              busyKey: "sendOperatorMessage",
              onClick: () =>
                sendOperatorMessage(
                  template.id,
                  template.label,
                  Boolean(template.requiresConfirmation),
                ),
            }),
          ]),
        ]),
      ),
    ),
    h("div", { className: "actions" }, [
      actionButton("Save operator macros", {
        id: "saveOperatorMessages",
        variant: "secondary",
        onClick: saveOperatorMessages,
      }),
      actionButton("Reset operator macros", {
        id: "resetOperatorMessages",
        variant: "secondary",
        onClick: resetOperatorMessages,
      }),
    ]),
  ]);
}
