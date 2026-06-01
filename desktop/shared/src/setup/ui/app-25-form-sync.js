function syncFormValues() {
  const config = state.config || {};
  const relayConfig = config.relay || {};
  const discordConfig = state.discord?.config || config.discord || {};
  const selectedDiscordSetupTemplate =
    discordConfig.setupTemplate ||
    (discordConfig.setupTemplates || []).find(
      (template) => template.id === discordConfig.setupTemplateId,
    );
  const summary = state.giveaway?.summary || {};
  const selectedCommand = selectedCustomCommand();
  const currentTimer = selectedTimer();
  const moderationSettings = state.moderation?.settings || {};
  setValue("setupMode", settingsValue("setupMode", currentSetupMode(config)));
  setValue("mode", settingsValue("mode", config.mode || "live"));
  setValue(
    "redirectUri",
    settingsValue("redirectUri", config.redirectUri || defaultRedirectUri),
  );
  setValue(
    "clientId",
    settingsValue("clientId", config.hasClientId ? savedCredentialMask : ""),
  );
  setValue(
    "clientSecret",
    settingsValue(
      "clientSecret",
      config.hasClientSecret ? savedCredentialMask : "",
    ),
  );
  setValue(
    "broadcasterLogin",
    settingsValue("broadcasterLogin", config.broadcasterLogin || ""),
  );
  setValue("botLogin", settingsValue("botLogin", config.botLogin || ""));
  setValue(
    "twitchTransportMode",
    settingsValue(
      "twitchTransportMode",
      relayConfig.twitchTransportMode || "local-user-token",
    ),
  );
  setValue(
    "relayBaseUrl",
    settingsValue("relayBaseUrl", relayConfig.baseUrl || ""),
  );
  setValue(
    "relayInstallationId",
    settingsValue("relayInstallationId", relayConfig.installationId || ""),
  );
  setValue(
    "relayConsoleToken",
    settingsValue(
      "relayConsoleToken",
      relayConfig.hasConsoleToken ? savedCredentialMask : "",
    ),
  );
  setValue("twitchPollDuration", twitchOpsValue("twitchPollDuration", "120"));
  setValue(
    "twitchPredictionWindow",
    twitchOpsValue("twitchPredictionWindow", "120"),
  );
  setValue(
    "twitchAnnouncementColor",
    twitchOpsValue("twitchAnnouncementColor", "primary"),
  );
  setValue(
    "twitchPollTitle",
    twitchOpsValue("twitchPollTitle", "What should we do next?"),
  );
  setValue(
    "twitchPollChoices",
    twitchOpsValue("twitchPollChoices", "Option one\nOption two"),
  );
  setValue(
    "twitchPredictionTitle",
    twitchOpsValue("twitchPredictionTitle", "Will this run work?"),
  );
  setValue(
    "twitchPredictionOutcomes",
    twitchOpsValue("twitchPredictionOutcomes", "Yes\nNo"),
  );
  setValue("twitchPredictionId", twitchOpsValue("twitchPredictionId", ""));
  setValue(
    "twitchWinningOutcomeId",
    twitchOpsValue("twitchWinningOutcomeId", ""),
  );
  setValue(
    "twitchAnnouncementMessage",
    twitchOpsValue("twitchAnnouncementMessage", ""),
  );
  setValue("twitchTargetLogin", twitchOpsValue("twitchTargetLogin", ""));
  setValue("discordBotToken", discordValue("discordBotToken", ""));
  setValue(
    "discordGuildId",
    discordValue("discordGuildId", discordConfig.guildId || ""),
  );
  setValue(
    "discordStreamAnnouncementChannelId",
    discordValue(
      "discordStreamAnnouncementChannelId",
      discordConfig.streamAnnouncementChannelId || "",
    ),
  );
  setValue(
    "discordGeneralAnnouncementChannelId",
    discordValue(
      "discordGeneralAnnouncementChannelId",
      discordConfig.generalAnnouncementChannelId || "",
    ),
  );
  setValue(
    "discordStreamAlertsRoleId",
    discordValue(
      "discordStreamAlertsRoleId",
      discordConfig.streamAlertsRoleId || "",
    ),
  );
  setValue(
    "discordOperatorRoleId",
    discordValue("discordOperatorRoleId", discordConfig.operatorRoleId || ""),
  );
  setValue(
    "discordStaffRoleId",
    discordValue("discordStaffRoleId", discordConfig.staffRoleId || ""),
  );
  setValue(
    "discordStaffRoleSelect",
    discordValue("discordStaffRoleId", discordConfig.staffRoleId || ""),
  );
  setValue(
    "discordSetupTemplateId",
    discordValue("discordSetupTemplateId", discordConfig.setupTemplateId || ""),
  );
  setChecked(
    "discordCreateStreamAlertsRole",
    Boolean(discordValue("discordCreateStreamAlertsRole", true)),
  );
  setChecked(
    "discordApplyPermissions",
    Boolean(discordValue("discordApplyPermissions", true)),
  );
  setChecked(
    "discordPostStarterMessages",
    Boolean(
      discordValue(
        "discordPostStarterMessages",
        selectedDiscordSetupTemplate?.postStarterMessagesByDefault || false,
      ),
    ),
  );
  setChecked(
    "discordLockStaffCategory",
    Boolean(
      discordValue(
        "discordLockStaffCategory",
        discordConfig.lockStaffCategory || false,
      ),
    ),
  );
  setValue(
    "discordAnnouncementKind",
    discordValue("discordAnnouncementKind", "live"),
  );
  setValue(
    "discordAnnouncementTitle",
    discordValue("discordAnnouncementTitle", ""),
  );
  setValue(
    "discordAnnouncementStreamUrl",
    discordValue(
      "discordAnnouncementStreamUrl",
      config.broadcasterLogin
        ? `https://www.twitch.tv/${config.broadcasterLogin}`
        : "",
    ),
  );
  setValue(
    "discordAnnouncementScheduledFor",
    discordValue("discordAnnouncementScheduledFor", ""),
  );
  setValue(
    "discordAnnouncementDetail",
    discordValue("discordAnnouncementDetail", ""),
  );
  setChecked(
    "discordMentionRole",
    Boolean(discordValue("discordMentionRole", true)),
  );
  setValue(
    "commandName",
    commandValue("commandName", selectedCommand?.name || ""),
  );
  setValue(
    "commandPermission",
    commandValue("commandPermission", selectedCommand?.permission || "viewer"),
  );
  setChecked(
    "commandEnabled",
    commandValue("commandEnabled", selectedCommand?.enabled ?? true),
  );
  setValue(
    "commandGlobalCooldown",
    commandValue(
      "commandGlobalCooldown",
      selectedCommand?.globalCooldownSeconds ?? 30,
    ),
  );
  setValue(
    "commandUserCooldown",
    commandValue(
      "commandUserCooldown",
      selectedCommand?.userCooldownSeconds ?? 10,
    ),
  );
  setValue(
    "commandAliases",
    commandValue("commandAliases", (selectedCommand?.aliases || []).join("\n")),
  );
  setValue(
    "commandResponses",
    commandValue(
      "commandResponses",
      (selectedCommand?.responses || []).join("\n"),
    ),
  );
  setValue(
    "commandPreviewActor",
    field("commandPreviewActor")?.value || "viewer",
  );
  setValue(
    "commandPreviewRole",
    field("commandPreviewRole")?.value || "viewer",
  );
  setValue(
    "commandPreviewArgs",
    field("commandPreviewArgs")?.value || "target",
  );
  setValue("timerName", timerValue("timerName", currentTimer?.name || ""));
  setValue(
    "timerInterval",
    timerValue("timerInterval", currentTimer?.intervalMinutes || 5),
  );
  setValue(
    "timerMinChatMessages",
    timerValue("timerMinChatMessages", currentTimer?.minChatMessages ?? 5),
  );
  setChecked(
    "timerEnabled",
    Boolean(timerValue("timerEnabled", currentTimer?.enabled ?? false)),
  );
  setValue(
    "timerMessage",
    timerValue("timerMessage", currentTimer?.message || ""),
  );
  setChecked(
    "blockedTermsEnabled",
    Boolean(
      moderationValue(
        "blockedTermsEnabled",
        moderationSettings.blockedTermsEnabled,
      ),
    ),
  );
  setChecked(
    "linkFilterEnabled",
    Boolean(
      moderationValue(
        "linkFilterEnabled",
        moderationSettings.linkFilterEnabled,
      ),
    ),
  );
  setChecked(
    "capsFilterEnabled",
    Boolean(
      moderationValue(
        "capsFilterEnabled",
        moderationSettings.capsFilterEnabled,
      ),
    ),
  );
  setChecked(
    "repeatFilterEnabled",
    Boolean(
      moderationValue(
        "repeatFilterEnabled",
        moderationSettings.repeatFilterEnabled,
      ),
    ),
  );
  setChecked(
    "symbolFilterEnabled",
    Boolean(
      moderationValue(
        "symbolFilterEnabled",
        moderationSettings.symbolFilterEnabled,
      ),
    ),
  );
  setChecked(
    "botShieldEnabled",
    Boolean(
      moderationValue("botShieldEnabled", moderationSettings.botShieldEnabled),
    ),
  );
  setValue(
    "blockedTermsAction",
    moderationValue(
      "blockedTermsAction",
      moderationSettings.blockedTermsAction || "warn",
    ),
  );
  setValue(
    "linkFilterAction",
    moderationValue(
      "linkFilterAction",
      moderationSettings.linkFilterAction || "warn",
    ),
  );
  setValue(
    "capsFilterAction",
    moderationValue(
      "capsFilterAction",
      moderationSettings.capsFilterAction || "warn",
    ),
  );
  setValue(
    "repeatFilterAction",
    moderationValue(
      "repeatFilterAction",
      moderationSettings.repeatFilterAction || "warn",
    ),
  );
  setValue(
    "symbolFilterAction",
    moderationValue(
      "symbolFilterAction",
      moderationSettings.symbolFilterAction || "warn",
    ),
  );
  setValue(
    "botShieldAction",
    moderationValue(
      "botShieldAction",
      moderationSettings.botShieldAction || "delete",
    ),
  );
  setValue(
    "botShieldScoreThreshold",
    moderationValue(
      "botShieldScoreThreshold",
      moderationSettings.botShieldScoreThreshold || 70,
    ),
  );
  setValue(
    "timeoutSeconds",
    moderationValue("timeoutSeconds", moderationSettings.timeoutSeconds || 60),
  );
  setValue(
    "moderationWarningMessage",
    moderationValue(
      "moderationWarningMessage",
      moderationSettings.warningMessage ||
        "@{user}, please keep chat within channel guidelines.",
    ),
  );
  setValue(
    "capsMinLength",
    moderationValue("capsMinLength", moderationSettings.capsMinLength || 20),
  );
  setValue(
    "capsRatio",
    moderationValue("capsRatio", moderationSettings.capsRatio || 0.75),
  );
  setValue(
    "repeatLimit",
    moderationValue("repeatLimit", moderationSettings.repeatLimit || 3),
  );
  setValue(
    "repeatWindowSeconds",
    moderationValue(
      "repeatWindowSeconds",
      moderationSettings.repeatWindowSeconds || 30,
    ),
  );
  setValue(
    "symbolMinLength",
    moderationValue(
      "symbolMinLength",
      moderationSettings.symbolMinLength || 12,
    ),
  );
  setValue(
    "symbolRatio",
    moderationValue("symbolRatio", moderationSettings.symbolRatio || 0.6),
  );
  setChecked(
    "escalationEnabled",
    Boolean(
      moderationValue(
        "escalationEnabled",
        moderationSettings.escalationEnabled ?? false,
      ),
    ),
  );
  setValue(
    "escalationWindowSeconds",
    moderationValue(
      "escalationWindowSeconds",
      moderationSettings.escalationWindowSeconds || 300,
    ),
  );
  setValue(
    "escalationDeleteAfter",
    moderationValue(
      "escalationDeleteAfter",
      moderationSettings.escalationDeleteAfter || 2,
    ),
  );
  setValue(
    "escalationTimeoutAfter",
    moderationValue(
      "escalationTimeoutAfter",
      moderationSettings.escalationTimeoutAfter || 3,
    ),
  );
  setChecked(
    "exemptBroadcaster",
    Boolean(
      moderationValue(
        "exemptBroadcaster",
        moderationSettings.exemptBroadcaster ?? true,
      ),
    ),
  );
  setChecked(
    "exemptModerators",
    Boolean(
      moderationValue(
        "exemptModerators",
        moderationSettings.exemptModerators ?? true,
      ),
    ),
  );
  setChecked(
    "exemptVips",
    Boolean(
      moderationValue("exemptVips", moderationSettings.exemptVips ?? false),
    ),
  );
  setChecked(
    "exemptSubscribers",
    Boolean(
      moderationValue(
        "exemptSubscribers",
        moderationSettings.exemptSubscribers ?? false,
      ),
    ),
  );
  setValue(
    "moderationTerm",
    draftValue(state.moderationTermDraft, "moderationTerm", ""),
  );
  setChecked(
    "moderationTermEnabled",
    Boolean(
      draftValue(state.moderationTermDraft, "moderationTermEnabled", true),
    ),
  );
  setValue(
    "moderationAllowedDomain",
    draftValue(state.moderationAllowedLinkDraft, "moderationAllowedDomain", ""),
  );
  setChecked(
    "moderationAllowedDomainEnabled",
    Boolean(
      draftValue(
        state.moderationAllowedLinkDraft,
        "moderationAllowedDomainEnabled",
        true,
      ),
    ),
  );
  setValue(
    "moderationBlockedDomain",
    draftValue(state.moderationBlockedLinkDraft, "moderationBlockedDomain", ""),
  );
  setChecked(
    "moderationBlockedDomainEnabled",
    Boolean(
      draftValue(
        state.moderationBlockedLinkDraft,
        "moderationBlockedDomainEnabled",
        true,
      ),
    ),
  );
  setValue(
    "moderationPermitUser",
    draftValue(state.moderationPermitDraft, "moderationPermitUser", ""),
  );
  setValue(
    "moderationPermitMinutes",
    draftValue(state.moderationPermitDraft, "moderationPermitMinutes", 5),
  );
  setValue(
    "moderationTestActor",
    field("moderationTestActor")?.value || "viewer",
  );
  setValue(
    "moderationTestRole",
    field("moderationTestRole")?.value || "viewer",
  );
  setValue(
    "moderationTestText",
    field("moderationTestText")?.value || "VISIT EXAMPLE.COM NOW",
  );
  setValue(
    "giveawayTitle",
    giveawayValue("giveawayTitle", summary.title || "Community Giveaway"),
  );
  setValue(
    "giveawayKeyword",
    giveawayValue("giveawayKeyword", summary.keyword || "enter"),
  );
  setValue(
    "winnerCount",
    giveawayValue("winnerCount", summary.winnerCount || 3),
  );
  const giveawayConfig = summary.config || {};
  setValue(
    "entryWindowMinutes",
    giveawayValue(
      "entryWindowMinutes",
      giveawayConfig.entryWindowMinutes || 10,
    ),
  );
  setValue(
    "itemName",
    giveawayValue("itemName", giveawayConfig.itemName || summary.title || ""),
  );
  setValue(
    "gameName",
    giveawayValue("gameName", giveawayConfig.gameName || ""),
  );
  setValue(
    "itemEdition",
    giveawayValue(
      "itemEdition",
      giveawayConfig.itemEdition || "Standard Edition",
    ),
  );
  setValue(
    "prizeType",
    giveawayValue("prizeType", giveawayConfig.prizeType || "standard_game_key"),
  );
  setValue(
    "platformMode",
    giveawayValue(
      "platformMode",
      giveawayConfig.platformMode || "winner_selects_after_win",
    ),
  );
  setValue(
    "supportedPlatforms",
    giveawayValue(
      "supportedPlatforms",
      (
        giveawayConfig.supportedPlatforms || [
          "Steam",
          "Xbox",
          "PlayStation",
          "Epic",
          "Other / manual",
        ]
      ).join(", "),
    ),
  );
  setValue(
    "minimumFollowAgeDays",
    giveawayValue(
      "minimumFollowAgeDays",
      giveawayConfig.minimumFollowAgeDays || 7,
    ),
  );
  setValue(
    "responseWindowMinutes",
    giveawayValue(
      "responseWindowMinutes",
      giveawayConfig.responseWindowMinutes || 7,
    ),
  );
  setValue(
    "previousWinnerRestrictionMode",
    giveawayValue(
      "previousWinnerRestrictionMode",
      giveawayConfig.previousWinnerRestrictionMode || "base_game_blocks_deluxe",
    ),
  );
  setValue(
    "marketplaceName",
    giveawayValue("marketplaceName", giveawayConfig.marketplaceName || "Eneba"),
  );
  setValue(
    "marketplaceNote",
    giveawayValue(
      "marketplaceNote",
      giveawayConfig.marketplaceNote ||
        "Key sourced after winner confirms platform/region.",
    ),
  );
  setValue(
    "ageGuidanceText",
    giveawayValue(
      "ageGuidanceText",
      giveawayConfig.ageGuidanceText ||
        "Game is rated Mature. Please only enter if this is appropriate for you.",
    ),
  );
  setValue(
    "regionAvailabilityDisclaimer",
    giveawayValue(
      "regionAvailabilityDisclaimer",
      giveawayConfig.regionAvailabilityDisclaimer ||
        "Prize availability depends on platform, region, and legitimate purchasable key availability.",
    ),
  );
  setValue(
    "selectedPlatform",
    giveawayValue(
      "selectedPlatform",
      giveawayConfig.supportedPlatforms?.[0] || "Steam",
    ),
  );
  setValue("regionCountry", giveawayValue("regionCountry", ""));
  setValue(
    "deliveryMethod",
    giveawayValue("deliveryMethod", "manual after stream"),
  );
  setValue(
    "marketplaceUsed",
    giveawayValue("marketplaceUsed", config.marketplaceName || "Eneba"),
  );
  setValue("purchaseStatus", giveawayValue("purchaseStatus", "not_purchased"));
  setValue("drawCount", giveawayValue("drawCount", suggestedDrawCount()));
  for (const template of state.templates || []) {
    setValue(
      `template-${template.action}`,
      templateValue(template.action, template.template || ""),
    );
  }
  for (const template of state.operatorMessages || []) {
    setValue(
      `operator-template-${template.id}`,
      operatorTemplateValue(template.id, template.template || ""),
    );
  }
  setChecked(
    "reminderEnabled",
    Boolean(reminderValue("reminderEnabled", state.reminder?.enabled)),
  );
  setValue(
    "reminderInterval",
    reminderValue("reminderInterval", state.reminder?.intervalMinutes || 10),
  );
  setValue("simActor", field("simActor")?.value || "viewer");
  setValue("simRole", field("simRole")?.value || "viewer");
  setValue("simCommand", field("simCommand")?.value || "!gstatus");
  setValue("entrantFilter", state.entrantFilter);
  setValue("winnerFilter", state.winnerFilter);
  syncWinnerSelects();
}
