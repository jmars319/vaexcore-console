# Bot Live Validation Runbook

This runbook covers the final hosted OAuth and live validation actions for Twitch Chat Bot identity and Discord slash commands. It assumes Relay is already deployed at `https://relay.vaexil.tv`.

Do not paste real secrets into docs, screenshots, support bundles, or chat. Use the Console UI and `wrangler secret put` prompts for secret values.

## Phase 5 Status Check

Run this before changing live provider settings:

```bash
npm run bot:readiness
```

Expected pre-credential blockers:

- Hosted Relay pairing may be missing.
- Twitch bot grant is pending.
- Twitch broadcaster grant is pending.
- Chat Bot identity live test is not recorded.
- Discord Worker secrets may be missing.
- Discord slash commands may not be registered.
- Local Discord server setup may still need a bot token, server ID, and announcement channel.

`bot:readiness` is read-only. It checks saved local Console pairing, Relay health, Twitch Relay readiness, Discord Relay readiness, local Discord setup, and the next actions without printing secret values.

## Phase 6: Twitch Chat Bot Identity

1. Open Console `Settings`.
2. Click `Connect hosted Twitch`.
3. In the browser session logged into `vaexcorebot`, approve the bot grant scopes:

- `user:bot`
- `user:read:chat`
- `user:write:chat`

4. Return to Console and click `Authorize broadcaster`.
5. In a browser session logged into the broadcaster account, approve the broadcaster grant scope:

- `channel:bot`

6. Return to Console and click `Check Relay`.
7. Confirm Relay readiness shows bot grant, broadcaster grant, and separate bot account checks as passing.
8. Click `Register Twitch EventSub`.
9. Click `Send Relay test message`.
10. Confirm the message appears in the target Twitch chat as `vaexcorebot`.
11. Confirm Twitch's chat user list labels `vaexcorebot` as a Chat Bot.
12. Only after the user-list check passes, click `Mark Chat Bot identity live-tested` in Console.
13. Run:

```bash
npm run bot:readiness
```

14. Confirm the Twitch section has no remaining TODO items except unrelated Discord/local setup items.

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
6. Review the planned categories, channels, optional stream alerts role, and optional Staff privacy action.
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
- Keep `Local Console` available for users who prefer local-only operation; it is not the Twitch Chat Bot identity path.
- Treat `/live`, `/late`, `/cancelled`, and `/scheduled` as guarded operator actions, not public auto-post shortcuts.
