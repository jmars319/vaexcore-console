# VaexCore Suite Protocol

The three apps coordinate through local files under:

`~/Library/Application Support/vaexcore/suite`

Studio, Pulse, and Console remain independent apps. This protocol is the local contract that lets any one app launch the full suite, discover app health, pass workflow commands, publish shared timeline activity, and report whether its core workflow is locally capable without cloud services.

## Files

- `vaexcore-studio.json`, `vaexcore-pulse.json`, `vaexcore-console.json`: app discovery heartbeats.
- `session.json`: active suite session, owned by Studio.
- `commands/<target-app>/*.json`: one-shot command queue.
- `handoffs/pulse-recording-intake.json`: latest Studio recording handoff for Pulse.
- `timeline.jsonl`: append-only shared timeline.

## Local Runtime Rules

- Apps bind local APIs to loopback only.
- Apps store durable state in app-owned Application Support paths, not repo-relative paths.
- Apps publish a `localRuntime` object in their discovery heartbeat.
- Apps should keep configuration and review workflows usable when network providers are disconnected.
- Secrets must be stored in an app-owned secure store. Until Keychain migration is complete, discovery must honestly report the current secret storage state.
- Cloud or platform dependencies must be modeled as dependencies, not as requirements for local startup.

## Runtime States

- `ready`: the app can run its core local workflow.
- `degraded`: the app can run locally, but one or more optional or packaging-related dependencies need attention.
- `blocked`: the app cannot run its core local workflow.

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

## Discovery Shape

Discovery files are JSON. Existing readers must tolerate unknown fields and missing optional fields.

```ts
export interface SuiteDiscoveryDocument {
  schemaVersion: number;
  appId: "vaexcore-studio" | "vaexcore-pulse" | "vaexcore-console";
  appName: string;
  bundleIdentifier: string;
  version: string;
  pid: number;
  startedAt: string;
  updatedAt: string;
  apiUrl: string | null;
  wsUrl: string | null;
  healthUrl: string | null;
  capabilities: string[];
  launchName: string;
  suiteSessionId: string | null;
  activity: string | null;
  activityDetail: string | null;
  localRuntime?: SuiteLocalRuntime;
}

export interface SuiteLocalRuntime {
  contractVersion: 1;
  mode: "local-first";
  state: "ready" | "degraded" | "blocked";
  appStorageDir: string;
  suiteDir: string;
  secureStorage: string;
  secretStorageState: string;
  durableStorage: string[];
  networkPolicy: "localhost-only";
  dependencies: Array<{
    name: string;
    kind: string;
    state: string;
    detail: string;
  }>;
}
```
