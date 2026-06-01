function renderBotConfigBundleCard() {
  return card("Bot Config Backup", [
    callout(
      "Exports reusable bot behavior only: commands, timers, moderation rules, operator macros, giveaway message templates, and reminder settings. Twitch secrets, OAuth tokens, active giveaways, prize data, and runtime history are excluded.",
      "info",
    ),
    h("div", { className: "actions" }, [
      actionButton("Export safe bot config", {
        id: "exportBotConfig",
        variant: "secondary",
        onClick: exportBotConfigBundle,
      }),
      actionButton("Import safe bot config", {
        id: "importBotConfig",
        variant: "secondary",
        onClick: importBotConfigBundle,
      }),
    ]),
    formRow(
      "Import JSON",
      h("textarea", {
        id: "botConfigImportJson",
        className: "command-import",
        placeholder:
          '{"version":1,"commands":[...],"timers":[...],"moderation":{...}}',
      }),
    ),
  ]);
}

function renderTwitchOps() {
  const ops = state.twitchOps || {};
  const readiness = ops.readiness || { checks: [], missingScopes: [] };
  return [
    sectionHeader(
      "Twitch Creator Ops",
      "Guarded live controls for polls, predictions, raids, shoutouts, and highlighted announcements.",
    ),
    card("Readiness", [
      statusGrid([
        [
          "Twitch identity",
          readiness.identityReady ? "ready" : "missing",
          Boolean(readiness.identityReady),
        ],
        [
          "Broadcaster",
          readiness.broadcasterLogin || "missing",
          Boolean(readiness.broadcasterLogin),
        ],
        ["Bot", readiness.botLogin || "missing", Boolean(readiness.botLogin)],
        [
          "Creator scopes",
          readiness.missingScopes?.length
            ? `${readiness.missingScopes.length} missing`
            : "ready",
          !readiness.missingScopes?.length,
        ],
      ]),
      readiness.checks?.length
        ? list(
            readiness.checks.map(
              (check) =>
                `${check.ok ? "Ready" : "Needs attention"} ${check.name}: ${check.detail}`,
            ),
            readiness.ready ? "ok" : "warn",
          )
        : null,
    ]),
    card("Polls And Predictions", [
      h("div", { className: "grid" }, [
        formRow(
          "Poll title",
          h("input", {
            id: "twitchPollTitle",
            placeholder: "What should we run next?",
            onInput: updateTwitchOpsDraft,
          }),
        ),
        formRow(
          "Poll duration seconds",
          h("input", {
            id: "twitchPollDuration",
            type: "number",
            min: "15",
            max: "1800",
            onInput: updateTwitchOpsDraft,
          }),
        ),
      ]),
      formRow(
        "Poll choices",
        h("textarea", {
          id: "twitchPollChoices",
          placeholder: "Choice one\nChoice two",
          onInput: updateTwitchOpsDraft,
        }),
      ),
      h("div", { className: "actions" }, [
        actionButton("Start poll", {
          id: "startTwitchPoll",
          variant: "danger",
          onClick: startTwitchPoll,
        }),
        actionButton("End poll", {
          id: "endTwitchPoll",
          variant: "danger",
          onClick: endTwitchPoll,
        }),
      ]),
      h("div", { className: "grid" }, [
        formRow(
          "Prediction title",
          h("input", {
            id: "twitchPredictionTitle",
            placeholder: "Will we win this round?",
            onInput: updateTwitchOpsDraft,
          }),
        ),
        formRow(
          "Prediction window seconds",
          h("input", {
            id: "twitchPredictionWindow",
            type: "number",
            min: "30",
            max: "1800",
            onInput: updateTwitchOpsDraft,
          }),
        ),
      ]),
      formRow(
        "Prediction outcomes",
        h("textarea", {
          id: "twitchPredictionOutcomes",
          placeholder: "Yes\nNo",
          onInput: updateTwitchOpsDraft,
        }),
      ),
      h("div", { className: "grid" }, [
        formRow(
          "Prediction ID",
          h("input", {
            id: "twitchPredictionId",
            onInput: updateTwitchOpsDraft,
          }),
        ),
        formRow(
          "Winning outcome ID",
          h("input", {
            id: "twitchWinningOutcomeId",
            onInput: updateTwitchOpsDraft,
          }),
        ),
      ]),
      h("div", { className: "actions" }, [
        actionButton("Start prediction", {
          id: "startTwitchPrediction",
          variant: "danger",
          onClick: startTwitchPrediction,
        }),
        actionButton("Lock prediction", {
          id: "lockTwitchPrediction",
          variant: "danger",
          onClick: () => endTwitchPrediction("LOCKED"),
        }),
        actionButton("Resolve prediction", {
          id: "resolveTwitchPrediction",
          variant: "danger",
          onClick: () => endTwitchPrediction("RESOLVED"),
        }),
        actionButton("Cancel prediction", {
          id: "cancelTwitchPrediction",
          variant: "danger",
          onClick: () => endTwitchPrediction("CANCELED"),
        }),
      ]),
    ]),
    card("Stream Actions", [
      h("div", { className: "grid" }, [
        formRow(
          "Announcement color",
          h(
            "select",
            { id: "twitchAnnouncementColor", onChange: updateTwitchOpsDraft },
            [
              option("primary", "primary"),
              option("purple", "purple"),
              option("blue", "blue"),
              option("green", "green"),
              option("orange", "orange"),
            ],
          ),
        ),
        formRow(
          "Target channel",
          h("input", {
            id: "twitchTargetLogin",
            placeholder: "target_channel",
            onInput: updateTwitchOpsDraft,
          }),
        ),
      ]),
      formRow(
        "Announcement message",
        h("textarea", {
          id: "twitchAnnouncementMessage",
          placeholder: "We are live with a special event.",
          onInput: updateTwitchOpsDraft,
        }),
      ),
      h("div", { className: "actions" }, [
        actionButton("Send announcement", {
          id: "sendTwitchAnnouncement",
          variant: "danger",
          onClick: sendTwitchAnnouncement,
        }),
        actionButton("Send shoutout", {
          id: "sendTwitchShoutout",
          variant: "danger",
          onClick: sendTwitchShoutout,
        }),
        actionButton("Start raid", {
          id: "startTwitchRaid",
          variant: "danger",
          onClick: startTwitchRaid,
        }),
        actionButton("Cancel raid", {
          id: "cancelTwitchRaid",
          variant: "danger",
          onClick: cancelTwitchRaid,
        }),
      ]),
    ]),
    card("Creator Ops Log", [
      ops.logs?.length
        ? h(
            "ul",
            {},
            ops.logs.slice(0, 12).map((log) =>
              h("li", {
                text: `${log.created_at} ${log.action}`,
              }),
            ),
          )
        : callout("No Twitch creator ops actions have been logged yet."),
    ]),
    message(),
  ];
}

function discordStaffRoleOptions() {
  return (state.discordRoles || []).filter(
    (role) => role.staffEligible && role.name !== "@everyone",
  );
}
function renderDiscord() {
  const discord = state.discord || {};
  const config = discord.config || state.config?.discord || {};
  const readiness = discord.readiness || { ready: false, checks: [] };
  const preview = state.discordSetupPreview;
  const setupTemplates = config.setupTemplates || discord.templates || [];
  const selectedSetupTemplateId = discordValue(
    "discordSetupTemplateId",
    config.setupTemplateId || setupTemplates[0]?.id || "",
  );
  const selectedSetupTemplate =
    setupTemplates.find(
      (template) => template.id === selectedSetupTemplateId,
    ) ||
    config.setupTemplate ||
    setupTemplates[0];
  const setupMode = selectedSetupMode(state.config || {});
  const showHostedDiscord = setupMode !== "local-only";
  const showLocalDiscord = setupMode !== "relay-assisted";
  const showAssistedDiscord = setupMode === "advanced";
  const useHostedSetup = showHostedDiscord && discordHostedConnected();

  return [
    sectionHeader(
      "Discord",
      "Server setup, announcements, and slash command status.",
      h("div", { className: "actions section-actions" }, [
        actionButton("Refresh", {
          id: "discordRefresh",
          variant: "secondary",
          busyKey: "refresh",
          onClick: refreshAll,
        }),
        showLocalDiscord
          ? actionButton("Validate bot", {
              id: "discordValidateBot",
              variant: "secondary",
              onClick: validateDiscordBot,
            })
          : null,
      ]),
    ),
    showHostedDiscord ? renderDiscordHostedConnectCard(discord) : null,
    showLocalDiscord
      ? card("Local Discord Readiness", [
          callout(
            "Local Discord setup uses the self-hosted bot token saved on this machine.",
            "info",
          ),
          statusGrid([
            [
              "Bot token",
              config.hasBotToken ? "saved" : "missing",
              config.hasBotToken,
            ],
            ["Server ID", config.guildId || "missing", Boolean(config.guildId)],
            [
              "Stream announcements",
              config.streamAnnouncementChannelId || "missing",
              Boolean(config.streamAnnouncementChannelId),
            ],
            [
              "Setup applied",
              config.setupAppliedAt || "not yet",
              Boolean(config.setupAppliedAt),
            ],
          ]),
          readiness.checks?.length
            ? list(
                readiness.checks.map(
                  (check) =>
                    `${check.ok ? "Ready" : "Needs setup"} ${check.name}: ${check.detail}`,
                ),
                readiness.ready ? "ok" : "warn",
              )
            : callout("Discord readiness has not loaded yet."),
          discord.validationError
            ? callout(discord.validationError, "bad")
            : discord.bot
              ? callout(`Validated as ${discord.bot.username}.`, "ok")
              : null,
        ])
      : null,
    showAssistedDiscord ? renderBotCompletionCard("discord") : null,
    showAssistedDiscord ? renderDiscordRelayPanel(discord) : null,
    showLocalDiscord
      ? advancedPanel("Advanced Self-Hosted Discord Connection", [
          h("div", { className: "grid" }, [
            formRow(
              "Bot token",
              h("input", {
                id: "discordBotToken",
                type: "password",
                autocomplete: "new-password",
                placeholder: config.hasBotToken
                  ? savedCredentialMask
                  : "Bot token",
                onInput: updateDiscordDraft,
              }),
            ),
            formRow(
              "Server ID",
              h("input", {
                id: "discordGuildId",
                placeholder: "Discord server ID",
                onInput: updateDiscordDraft,
              }),
            ),
            formRow(
              "Stream announcement channel ID",
              h("input", {
                id: "discordStreamAnnouncementChannelId",
                placeholder: "live-now channel ID",
                onInput: updateDiscordDraft,
              }),
            ),
            formRow(
              "General announcement channel ID",
              h("input", {
                id: "discordGeneralAnnouncementChannelId",
                placeholder: "announcements channel ID",
                onInput: updateDiscordDraft,
              }),
            ),
            formRow(
              "Stream Alerts role ID",
              h("input", {
                id: "discordStreamAlertsRoleId",
                placeholder: "optional role ID",
                onInput: updateDiscordDraft,
              }),
            ),
            formRow(
              "Operator role ID",
              h("input", {
                id: "discordOperatorRoleId",
                placeholder: "VaexCore Operator role ID",
                onInput: updateDiscordDraft,
              }),
            ),
            formRow(
              "Staff role ID",
              h("input", {
                id: "discordStaffRoleId",
                placeholder: "role that can view STAFF",
                onInput: updateDiscordDraft,
              }),
            ),
            formRow(
              "Staff role picker",
              h(
                "select",
                {
                  id: "discordStaffRoleSelect",
                  disabled: !discordStaffRoleOptions().length,
                  onChange: selectDiscordStaffRole,
                },
                [
                  option(
                    "",
                    discordStaffRoleOptions().length
                      ? "Select a loaded role"
                      : "Load roles first",
                  ),
                  ...discordStaffRoleOptions().map((role) =>
                    option(role.id, `${role.name} (${role.id})`),
                  ),
                ],
              ),
            ),
          ]),
          state.discordRolesStatus?.error
            ? callout(state.discordRolesStatus.error, "warn")
            : state.discordRoles?.length
              ? callout(
                  `${state.discordRoles.length} Discord roles loaded. Managed roles and @everyone are hidden from the Staff role picker.`,
                  "ok",
                )
              : null,
          callout(
            "The bot token stays in the local secrets file and is never returned by the setup API. The bot needs View Channels, Manage Channels, Manage Roles, Send Messages, and Embed Links for the full operations setup.",
            "info",
          ),
          h("div", { className: "actions" }, [
            actionButton("Save Discord settings", {
              id: "discordSave",
              onClick: saveDiscordSettings,
            }),
            actionButton("Load roles", {
              id: "discordLoadRoles",
              variant: "secondary",
              busyKey: "discordLoadRoles",
              onClick: loadDiscordRoles,
            }),
          ]),
        ])
      : null,
    showLocalDiscord || useHostedSetup
      ? card(useHostedSetup ? "Hosted Server Layout" : "Server Layout", [
          selectedSetupTemplate
            ? h("div", { className: "state-banner compact info" }, [
                h("strong", { text: selectedSetupTemplate.name }),
                h("span", {
                  text:
                    selectedSetupTemplate.recommendedFor ||
                    selectedSetupTemplate.description,
                }),
              ])
            : null,
          setupTemplates.length
            ? formRow(
                "Layout preset",
                h(
                  "select",
                  {
                    id: "discordSetupTemplateId",
                    onChange: updateDiscordDraft,
                  },
                  setupTemplates.map((template) =>
                    option(
                      template.id,
                      `${template.name} (${template.categoryCount || 0} sections, ${template.channelCount || 0} channels, ${template.roleCount || 0} roles)`,
                    ),
                  ),
                ),
              )
            : null,
          h("label", { className: "inline-check" }, [
            h("input", {
              id: "discordCreateStreamAlertsRole",
              type: "checkbox",
              onChange: updateDiscordDraft,
            }),
            "Create preset roles",
          ]),
          h("label", { className: "inline-check" }, [
            h("input", {
              id: "discordApplyPermissions",
              type: "checkbox",
              onChange: updateDiscordDraft,
            }),
            "Apply operations permission matrix",
          ]),
          h("label", { className: "inline-check" }, [
            h("input", {
              id: "discordPostStarterMessages",
              type: "checkbox",
              onChange: updateDiscordDraft,
            }),
            "Post starter messages",
          ]),
          h("label", { className: "inline-check" }, [
            h("input", {
              id: "discordLockStaffCategory",
              type: "checkbox",
              onChange: updateDiscordDraft,
            }),
            "Lock Staff category to the selected Staff role",
          ]),
          callout("Preview the plan before applying server changes.", "info"),
          h("div", { className: "actions" }, [
            actionButton("Preview setup", {
              id: "discordPreviewSetup",
              variant: "secondary",
              onClick: previewDiscordSetup,
            }),
            actionButton("Apply setup", {
              id: "discordApplySetup",
              onClick: applyDiscordSetup,
            }),
          ]),
          renderDiscordPlan(preview),
        ])
      : null,
    showLocalDiscord
      ? card("Local Stream Announcements", [
          h("div", { className: "grid" }, [
            formRow(
              "Status",
              h(
                "select",
                {
                  id: "discordAnnouncementKind",
                  onChange: updateDiscordDraft,
                },
                [
                  option("live", "Stream is live"),
                  option("late", "Running late"),
                  option("cancelled", "Cancelled"),
                  option("scheduled", "Scheduled"),
                ],
              ),
            ),
            formRow(
              "Title",
              h("input", {
                id: "discordAnnouncementTitle",
                placeholder: "Stream is live",
                onInput: updateDiscordDraft,
              }),
            ),
            formRow(
              "Stream URL",
              h("input", {
                id: "discordAnnouncementStreamUrl",
                placeholder: "https://www.twitch.tv/channel",
                onInput: updateDiscordDraft,
              }),
            ),
            formRow(
              "Scheduled time",
              h("input", {
                id: "discordAnnouncementScheduledFor",
                placeholder: "Tonight at 8 PM ET",
                onInput: updateDiscordDraft,
              }),
            ),
          ]),
          formRow(
            "Details",
            h("textarea", {
              id: "discordAnnouncementDetail",
              placeholder: "Short context for the Discord announcement",
              onInput: updateDiscordDraft,
            }),
          ),
          h("label", { className: "inline-check" }, [
            h("input", {
              id: "discordMentionRole",
              type: "checkbox",
              onChange: updateDiscordDraft,
            }),
            "Mention Stream Alerts role for live announcements",
          ]),
          h("div", { className: "actions" }, [
            actionButton("Send announcement", {
              id: "discordSendAnnouncement",
              onClick: sendDiscordStreamAnnouncement,
            }),
          ]),
        ])
      : null,
    message(),
  ];
}
