function renderSetupGuide(mode = selectedSetupMode(), options = {}) {
  if (mode === "relay-assisted") {
    return renderRelaySetupGuide(options);
  }

  if (mode === "advanced") {
    return renderRelaySetupGuide({ showAdvancedUrls: true });
  }

  return renderLocalSetupGuide();
}

function renderLocalSetupGuide() {
  const config = state.config || {};
  const progress = getSetupProgress();
  const activeStep =
    progress.steps.find((step) => !step.complete)?.id || "final";
  const missingCredentialNames = missingCredentialLabels(config);
  const credentialsMissing = !progress.credentialsEntered;
  const missingUsernames = !progress.usernamesEntered;
  const canConnect = progress.credentialsEntered && progress.usernamesEntered;
  const canValidate = progress.twitchConnected && progress.usernamesEntered;
  const canTest = progress.validationPassed;

  return card("Setup Guide", [
    h("div", { id: "setupGuide", className: "setup-guide" }, [
      h(
        "div",
        { className: "setup-progress" },
        progress.steps.map((step) =>
          h(
            "div",
            { className: `setup-check ${step.complete ? "complete" : ""}` },
            [
              h("span", {
                className: "checkmark",
                text: step.complete ? "[x]" : "[ ]",
              }),
              h("span", { text: step.label }),
            ],
          ),
        ),
      ),
      callout(
        "Account roles: create the Twitch Developer App from any Twitch account you control. It does not need to be Bot Login or Broadcaster Login. That app only provides the Client ID and Client Secret. Broadcaster Login is the channel you are testing. Bot Login is the account that sends chat messages and must be the account signed in when you click Connect Twitch. For the first full Suite test, use the same Twitch account for Broadcaster Login and Bot Login so chat OAuth and stream-key import both work from one connection.",
        "info",
      ),
      setupStep({
        id: "app",
        number: 1,
        title: "Create Twitch Developer App",
        active: activeStep === "app",
        complete: progress.appCreated,
        children: [
          h("p", {
            text: "You need to create a Twitch application so vaexcore console can connect to your account.",
          }),
          callout(
            "This step is app registration, not bot identity. Use any Twitch account you control. Bot Login, Broadcaster Login, or a third account are all acceptable here; the OAuth step later decides which account becomes the bot.",
            "info",
          ),
          h("a", {
            className: "button secondary",
            href: "https://dev.twitch.tv/console/apps",
            target: "_blank",
            rel: "noreferrer",
            text: "Open Twitch Developer Console",
          }),
          h("ul", {}, [
            h("li", { text: "Click Register Your Application." }),
            h("li", { text: "Name: anything, for example vaexcore console." }),
            h("li", {}, [
              "OAuth Redirect URL: ",
              h("code", { text: defaultRedirectUri }),
            ]),
            h("li", {
              text: "Use one redirect URL only. Do not leave an extra blank redirect URL row.",
            }),
            h("li", { text: "Category: Application Integration." }),
          ]),
          callout(
            "The redirect URL must match exactly. If Twitch shows an HTTPS warning, remove any blank extra redirect URL row and keep only the localhost URL above.",
            "warn",
          ),
        ],
      }),
      setupStep({
        id: "credentials",
        number: 2,
        title: "Enter App Credentials",
        active: activeStep === "credentials",
        complete: progress.credentialsEntered,
        children: [
          h("p", {
            text: "After creating the app, copy your Client ID and Client Secret here.",
          }),
          h("div", { className: "field-ref-row" }, [
            fieldRef("Client ID", "clientId", !config.hasClientId),
            fieldRef("Client Secret", "clientSecret", !config.hasClientSecret),
            fieldRef("Redirect URI", "redirectUri", !config.redirectUri),
          ]),
          h("p", {
            className: progress.credentialsEntered ? "ok" : "warn",
            text: progress.credentialsEntered
              ? "Credentials complete."
              : `Missing ${missingCredentialNames.join(", ")}.`,
          }),
        ],
      }),
      setupStep({
        id: "users",
        number: 3,
        title: "Enter Twitch Usernames",
        active: activeStep === "users",
        complete: progress.usernamesEntered,
        disabled: credentialsMissing,
        children: [
          h("p", {
            text: "Enter the Twitch account that will run the bot and the channel it will operate in.",
          }),
          callout(
            "Recommended for the first real test: make Broadcaster Login and Bot Login the same Twitch account. Separate bot accounts are supported for chat, but the current local Suite cannot import the broadcaster's stream key from a separate bot account token.",
            "warn",
          ),
          h("p", {
            text: "Bot Login must be the account that grants OAuth in the next step; Broadcaster Login is the channel.",
          }),
          h("div", { className: "field-ref-row" }, [
            fieldRef(
              "Broadcaster login",
              "broadcasterLogin",
              !config.broadcasterLogin,
            ),
            fieldRef("Bot login", "botLogin", !config.botLogin),
          ]),
          h("p", {
            className: progress.usernamesEntered ? "ok" : "warn",
            text: progress.usernamesEntered
              ? "Usernames filled."
              : "Broadcaster login or Bot login is empty.",
          }),
        ],
      }),
      setupStep({
        id: "connect",
        number: 4,
        title: "Connect Twitch",
        active: activeStep === "connect",
        complete: progress.twitchConnected,
        disabled: !canConnect,
        children: [
          h("p", {
            text: "Click Connect Twitch while logged into the Bot Login account to authorize vaexcore console for chat and optional scoped moderation actions.",
          }),
          callout(
            "OAuth rule: Connect Twitch as Bot Login for chat. If you also need Studio to import the Twitch stream key from Console, Bot Login must be the broadcaster account in this local build.",
            "warn",
          ),
          callout(
            "Hosted Relay mode owns the Twitch Developer App and keeps service secrets off this machine. Use this local path only when intentionally self-hosting or testing with a user-token bot.",
            "info",
          ),
          oauthAccountCallout(config),
          h("div", { className: "actions" }, [
            connectButton(config, "secondary", !canConnect),
            config.hasAccessToken
              ? actionButton("Disconnect Twitch", {
                  id: "guideDisconnectTwitch",
                  variant: "secondary",
                  busyKey: "disconnectTwitch",
                  onClick: disconnectTwitch,
                })
              : null,
          ]),
          statusGrid([
            [
              "Connected",
              config.hasAccessToken ? "yes" : "no",
              config.hasAccessToken,
            ],
            [
              "OAuth account",
              config.botLogin || "Bot Login",
              Boolean(config.botLogin),
            ],
            [
              "Refresh token",
              config.hasRefreshToken ? "available" : "missing",
              config.hasRefreshToken,
            ],
            [
              "Bot account detected",
              config.hasBotUserId ? config.botLogin || "yes" : "not yet",
              config.hasBotUserId,
            ],
            [
              "user:read:chat",
              hasScope("user:read:chat") ? "granted" : "missing",
              hasScope("user:read:chat"),
            ],
            [
              "user:write:chat",
              hasScope("user:write:chat") ? "granted" : "missing",
              hasScope("user:write:chat"),
            ],
            [
              "channel:read:stream_key",
              hasScope("channel:read:stream_key") ? "granted" : "missing",
              hasScope("channel:read:stream_key"),
            ],
            [
              "moderator:manage:chat_messages",
              hasScope("moderator:manage:chat_messages")
                ? "granted"
                : "optional",
              true,
            ],
            [
              "moderator:manage:banned_users",
              hasScope("moderator:manage:banned_users")
                ? "granted"
                : "optional",
              true,
            ],
          ]),
          config.hasAccessToken
            ? callout(
                "vaexcore console will refresh expired Twitch access tokens automatically. If refresh fails, disconnect and reconnect Twitch.",
                "info",
              )
            : null,
          botLoginReconnectCallout(config),
          state.oauthNotice
            ? callout(state.oauthNotice.text, state.oauthNotice.tone)
            : null,
          canConnect
            ? null
            : callout(
                "Enter credentials and usernames before connecting Twitch.",
                "warn",
              ),
        ],
      }),
      setupStep({
        id: "validate",
        number: 5,
        title: "Automatic Validation",
        active: activeStep === "validate",
        complete: progress.validationPassed,
        disabled: !canValidate,
        children: [
          h("p", {
            text: "vaexcore console validates saved Twitch setup on launch and after Twitch connects.",
          }),
          h("div", { className: "actions" }, [
            actionButton("Rerun validation", {
              id: "guideValidate",
              variant: "secondary",
              onClick: validateSetup,
            }),
          ]),
          renderValidationSummary(),
          canValidate
            ? null
            : callout(
                "Connect Twitch before automatic validation can complete.",
                "warn",
              ),
        ],
      }),
      setupStep({
        id: "test",
        number: 6,
        title: "Test Chat",
        active: activeStep === "test",
        complete: progress.testMessageSent,
        disabled: !canTest,
        children: [
          h("p", {
            text: "Send a test message to confirm the bot can speak in chat.",
          }),
          h("div", { className: "actions" }, [
            actionButton("Send test message", {
              id: "guideTest",
              variant: "secondary",
              onClick: sendSetupTest,
            }),
          ]),
          h("p", {
            className: progress.testMessageSent ? "ok" : "muted",
            text: progress.testMessageSent
              ? "Test message sent successfully."
              : "No test message sent in this session.",
          }),
          canTest
            ? null
            : callout(
                "Wait for automatic validation before sending a test message.",
                "warn",
              ),
        ],
      }),
      setupStep({
        id: "final",
        number: 7,
        title: "Final Step",
        active: activeStep === "final",
        complete: isTwitchSetupReady(),
        disabled: !progress.validationPassed,
        children: [
          h("p", {
            text: "Start the live bot listener and confirm it responds in chat.",
          }),
          h("div", { className: "actions" }, [
            actionButton("Start Bot", {
              id: "guideBotStart",
              variant: "secondary",
              onClick: startBot,
            }),
            actionButton("Stop Bot", {
              id: "guideBotStop",
              variant: "secondary",
              onClick: stopBot,
            }),
          ]),
          h("p", {}, [
            "CLI after using the packaged desktop app setup: ",
            h("code", { text: "npm run dev:app-config" }),
          ]),
          h("p", {}, [
            "CLI after using project-local setup or .env: ",
            h("code", { text: "npm run dev" }),
          ]),
          h("p", {}, [
            "Instruction: type ",
            h("code", { text: "!ping" }),
            " in your Twitch chat.",
          ]),
          h("p", {
            className: "ok",
            text: "Success condition: LIVE CHAT CONFIRMED",
          }),
        ],
      }),
    ]),
  ]);
}
