# Console Operator Training

This guide is the practical training path for using Console as the local Twitch
and Discord operator surface. It complements the full operator manual and live
validation runbook.

Console remains operator-controlled. Relay handles hosted callbacks and
transport. Provider writes and announcements stay gated by local confirmation.

## First Run

1. Install dependencies.
2. Run local validation.
3. Open the setup dashboard.
4. Complete provider setup only when Twitch, Discord, and Relay credentials are
   intentionally available.

```bash
npm install
npm run check:env
npm run dev:local
npm run setup
```

Use local mode before connecting to Twitch. Live validation should happen only
after the bot account, broadcaster account, scopes, and Relay URL are verified.

## Twitch Setup

Use the Provider Setup Wizard:

1. Pair with Relay.
2. Complete bot OAuth.
3. Complete broadcaster OAuth.
4. Confirm token freshness and scopes in the Bot Identity Dashboard.
5. Register or verify EventSub.
6. Run the live validation path only when an intentional stream-night or test
   channel is available.

Required bot scopes:

- `user:read:chat`
- `user:write:chat`

Optional moderation scopes can be absent, but Console must show warning-only or
blocked moderation behavior instead of failing silently.

## Discord Setup

Use the Provider Setup Wizard:

1. Pair the Discord install through Relay.
2. Confirm the Discord application interaction endpoint is Relay.
3. Register slash commands.
4. Verify `/suggest`, announcement, and setup-status flows in the sandbox before
   live use.
5. Review queued Discord actions in Console before posting anything externally.

## Go-Live Routine

Before a live stream:

1. Choose the local operator role.
2. Confirm Relay transport health.
3. Confirm bot identity, broadcaster identity, token freshness, and scopes.
4. Run command sandbox tests for the commands that will be used.
5. Review moderation and event safety rules.
6. Review announcement queue behavior.
7. Complete the Go Live Checklist.
8. Send a controlled `!ping` or equivalent chat confirmation.

Do not rely on Console for live operation until the checklist explains no
remaining blocker for the intended workflow.

## Local Operator Roles

Roles are local operational labels, not authentication:

- Owner: all local actions are visible.
- Admin: setup and operational actions are visible, with risky actions gated.
- Moderator: stream-night actions are visible, provider setup remains limited.
- Viewer: read-only posture for review and training.

Use role labels to avoid accidental changes during demos, rehearsals, or shared
screen sessions.

## Event Replay And Sandbox

Use event replay to inspect Relay chat events, Discord interactions, suggestions,
announcement actions, outbound chat status, and provider errors. Replay is
read-only.

Use the command sandbox for:

- Chat commands.
- Slash commands.
- Giveaways.
- Timers.
- Announcement drafts.
- Moderation simulations.

Sandbox success is not live-provider proof. Live provider proof still requires
Relay status and intentional Twitch/Discord validation.

## Crash And Error Reports

Attach:

- Diagnostics support bundle.
- Setup mode, operator role, provider setup step, and disabled reason.
- Recent redacted activity timeline.
- App version, commit, platform, packaging type, and whether the app was local,
  web, or packaged desktop.
- Relay operations report only after redaction review.

Do not attach:

- Twitch tokens.
- Discord bot tokens.
- Relay pairing tokens.
- `.env` files.
- Raw provider payloads.

## Accessibility And Keyboard Baseline

- Setup and go-live steps must show clear disabled reasons.
- Role-gated actions must explain which role or readiness state is required.
- Sandbox forms and queue approval controls must be keyboard reachable.
- Event replay entries must be readable as text and not color-only.
- Confirmation dialogs for chat sends, announcements, archive, and moderation
  actions must keep focus on the decision.
