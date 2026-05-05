# VaexCore Suite Protocol

The three apps coordinate through local files under:

`~/Library/Application Support/vaexcore/suite`

Studio, Pulse, and Console remain independent apps. This protocol is the local contract that lets any one app launch the full suite, discover app health, pass workflow commands, and publish shared timeline activity.

## Files

- `vaexcore-studio.json`, `vaexcore-pulse.json`, `vaexcore-console.json`: app discovery heartbeats.
- `session.json`: active suite session, owned by Studio.
- `commands/<target-app>/*.json`: one-shot command queue.
- `handoffs/pulse-recording-intake.json`: latest Studio recording handoff for Pulse.
- `timeline.jsonl`: append-only shared timeline.

## App IDs

- `vaexcore-studio`
- `vaexcore-pulse`
- `vaexcore-console`

## Command Names

- `focus-review`: Pulse opens the review workspace.
- `focus-suite`: Pulse opens the suite panel.
- `focus-ops`: Console focuses Live Ops.
- `open-review`: Pulse consumes a Studio recording handoff payload.

## Timeline Shape

Every timeline line is JSON with `schemaVersion`, `eventId`, `sourceApp`, `sourceAppName`, `kind`, `title`, `detail`, `createdAt`, and `metadata`.
