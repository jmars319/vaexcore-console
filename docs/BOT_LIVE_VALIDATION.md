# Bot Live Validation Runbook

This runbook covers the final credential and portal actions for Twitch Chat Bot identity and Discord slash commands. It assumes Relay is already deployed at `https://relay.vaexil.tv` and Console is paired to installation `35d25f86-db02-4613-9715-fa3c580f5e46`.

Do not paste real secrets into docs, screenshots, support bundles, or chat. Use the Console UI and `wrangler secret put` prompts for secret values.

## Phase 5 Status Check

Run this before changing live provider settings:

```bash
npm run bot:readiness
```

Expected pre-credential blockers:

- Twitch bot grant is pending.
- Twitch broadcaster grant is pending.
- Twitch transport may still be `local-user-token`.
- Chat Bot identity live test is not recorded.
- Discord Worker secrets may be missing.
- Discord slash commands may not be registered.
- Local Discord server setup may still need a bot token, server ID, and announcement channel.

`bot:readiness` is read-only. It checks saved local Console pairing, Relay health, Twitch Relay readiness, Discord Relay readiness, local Discord setup, and the next actions without printing secret values.

## Phase 6: Twitch Chat Bot Identity

1. Open the Twitch Developer Console for the Relay Twitch app.
2. Add this OAuth redirect URL exactly:

```text
https://relay.vaexil.tv/oauth/twitch/callback
```

3. Save the Twitch app settings.
4. In a browser session logged into `vaexcorebot`, open:

```text
https://relay.vaexil.tv/oauth/twitch/start?installationId=35d25f86-db02-4613-9715-fa3c580f5e46&kind=bot
```

5. Approve the bot grant scopes:

- `user:bot`
- `user:read:chat`
- `user:write:chat`

6. In a separate browser session logged into the broadcaster account, open:

```text
https://relay.vaexil.tv/oauth/twitch/start?installationId=35d25f86-db02-4613-9715-fa3c580f5e46&kind=broadcaster
```

7. Approve the broadcaster grant scope:

- `channel:bot`

8. Open Console `Settings`.
9. Confirm Relay URL, installation ID, and console token are saved.
10. Set `Twitch Chat Transport` to `relay-chatbot`.
11. Click `Check Relay`.
12. Confirm Relay readiness shows bot grant, broadcaster grant, and separate bot account checks as passing.
13. Register or refresh the Twitch EventSub chat subscription from Console if the action is available.
14. Send a test chat message through Relay.
15. Confirm the message appears in the target Twitch chat as `vaexcorebot`.
16. Confirm Twitch's chat user list labels `vaexcorebot` as a Chat Bot.
17. Only after the user-list check passes, click `Mark Chat Bot identity live-tested` in Console.
18. Run:

```bash
npm run bot:readiness
```

19. Confirm the Twitch section has no remaining TODO items except unrelated Discord/local setup items.

If Twitch still shows `vaexcorebot` as a normal user, do not mark the live test complete. Recheck the transport mode, Relay readiness, OAuth grants, and that the bot and broadcaster grants were approved by separate Twitch accounts.

## Phase 6: Discord Relay Slash Commands

1. Open the Relay project directory.
2. Set required Discord Worker secrets with placeholder-safe commands:

```bash
wrangler secret put DISCORD_BOT_TOKEN
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put DISCORD_APPLICATION_ID
wrangler secret put DISCORD_GUILD_ID
```

3. Optionally restrict announcement commands to an operator role:

```bash
wrangler secret put DISCORD_OPERATOR_ROLE_ID
```

4. Deploy or redeploy Relay if the secret update flow requires it in the current Cloudflare setup.
5. Open the Discord Developer Portal for the VaexCore Discord application.
6. Set the Interactions Endpoint URL exactly:

```text
https://relay.vaexil.tv/webhooks/discord/interactions
```

7. Save the Discord application settings. Discord should verify the endpoint signature challenge.
8. Open Console `Discord`.
9. Click `Check Relay`.
10. Confirm Discord Relay readiness shows required Worker config as present.
11. Click `Register slash commands`.
12. Test these commands in the target Discord server:

- `/setup-status`
- `/suggest`
- `/live`
- `/late`
- `/cancelled`
- `/scheduled`

13. Confirm `/suggest` creates an operator-visible suggestion in Console.
14. Confirm announcement commands queue operator-visible actions and do not bypass Console review.
15. Run:

```bash
npm run smoke:discord-relay
npm run bot:readiness
```

16. Confirm Discord Relay readiness has no remaining TODO items.

## Local Discord Setup

Relay slash commands do not replace local Discord setup. Use local setup when Console needs to create the server layout or send direct announcements through Discord REST.

1. Invite the Discord bot to the target server with the needed permissions.
2. Open Console `Discord`.
3. Save the local bot token and server ID.
4. Click `Validate bot`.
5. Click `Preview setup`.
6. Review the planned categories, channels, and optional stream alerts role.
7. Click `Apply setup`.
8. Save or verify the stream announcement channel.
9. Send a late/cancelled/scheduled test announcement if the server is ready for it.

## Final Acceptance

The bot work is functionally complete when all of these are true:

- `npm run bot:readiness` shows Twitch Chat Bot identity ready and live-tested.
- Twitch EventSub chat reaches Relay and Console.
- Relay sends Twitch chat with app-token authorization.
- Twitch user list labels `vaexcorebot` as a Chat Bot.
- Discord Worker secrets are set.
- Discord Interactions Endpoint verifies successfully.
- Discord slash commands are registered and work in the target server.
- Discord suggestions appear in Console.
- Discord announcement commands remain operator-reviewed.
- Local Discord setup can create the intended server layout and send direct announcements if enabled.

## Safety Rules

- Never commit `config/local.secrets.json`.
- Never paste Worker secrets into docs or issue comments.
- Do not mark Chat Bot identity complete until Twitch visually confirms the Chat Bot label.
- Keep `local-user-token` available only as a fallback; it is not the Twitch Chat Bot identity path.
- Treat `/live`, `/late`, `/cancelled`, and `/scheduled` as guarded operator actions, not public auto-post shortcuts.
