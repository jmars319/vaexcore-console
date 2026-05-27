# vaexcore console

vaexcore console is a local Twitch operations bot and desktop control surface for stream commands, moderation, giveaways, markers, timers, and setup workflows. It is designed to keep stream operations quiet, inspectable, and operator-controlled.

Console is not a generic chatbot platform. It is a creator operations tool with live Twitch behavior, local setup flows, and integration points for the wider vaexcore suite.

## Operational Purpose

- Run reliable Twitch chat operations from a controlled local environment.
- Support commands, moderation, giveaways, timers, and marker workflows.
- Keep token setup, environment checks, and release guardrails visible.
- Integrate with vaexcore studio for local creator-tool coordination where available.

## Design Posture

- Operator control over automated behavior.
- Local setup and diagnostics before live startup.
- Warning-only fallback when optional moderation scopes are missing.
- Desktop packaging without hiding the underlying runtime constraints.
- Clear separation between setup UI, shared desktop code, and platform-specific packaging.

## Architecture

```text
desktop/
  shared/       Electron shell, setup UI, shared desktop runtime
  macOS/        macOS packaging notes and assets
  windows/      Windows packaging notes and launcher material
  linux/        Linux packaging notes

web/            Web-facing docs and future surface material
mobile/         Mobile placeholder documentation
docs/           Development guidelines, suite protocol, and operator manual
package.json    Node runtime, scripts, smoke checks, and release commands
```

## Current State

- Twitch EventSub chat connection and send-message flows are implemented.
- Local command testing is available without Twitch.
- Giveaway, moderation, timers, Twitch creator ops, Discord setup/announcements, diagnostics, setup, and release guard scripts are present.
- The macOS desktop app flow is supported with unsigned tester builds.
- Optional vaexcore studio integration is documented and remains local.
- The detailed operator setup guide has been moved out of the root README.

## Deployment Posture

Console is local creator software. Live use requires a Twitch application, correct bot token scopes, operator review of moderation settings, and local environment validation. Packaged builds are currently unsigned unless release credentials are supplied.

## Working Locally

```bash
npm install
npm run check:env
npm run dev:local
npm run dev
npm run ci
just credentials
npm run release:check
```

Use local mode before connecting to Twitch. Live mode should only run after token scopes and channel IDs have been verified.

`just credentials` is a safe visibility check for the shared JAMARQ provider env pool used by Codex and local CLIs. It prints variable names only. vaexcore console runtime secrets still belong in this repo's `.env` or the app setup store.

## Direction

- Keep Twitch automation constrained and operator-visible.
- Continue improving setup diagnostics and release guardrails.
- Maintain suite integration through explicit local protocols.
- Move detailed operator workflows into docs rather than overloading the root README.

## Related Documentation

- [Operator Manual](docs/OPERATOR_MANUAL.md)
- [Bot Live Validation Runbook](docs/BOT_LIVE_VALIDATION.md)
- [Development Guidelines](docs/development-guidelines.md)
- [Suite Protocol](docs/SUITE_PROTOCOL.md)
- [Desktop Runtime](desktop/README.md)
