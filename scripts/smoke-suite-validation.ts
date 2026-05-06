import assert from "node:assert/strict";
import { validateSuiteCommandDocument } from "../desktop/shared/src/suite/commands.ts";
import {
  validateSuiteDiscoveryDocument,
  type SuiteDiscoveryDocument
} from "../desktop/shared/src/suite/discovery.ts";

const discovery: SuiteDiscoveryDocument = {
  schemaVersion: 1,
  appId: "vaexcore-console",
  appName: "vaexcore console",
  bundleIdentifier: "com.vaexil.vaexcore.console",
  version: "0.1.2",
  pid: 1234,
  startedAt: "2026-05-06T12:00:00Z",
  updatedAt: "2026-05-06T12:00:15Z",
  apiUrl: "http://127.0.0.1:3434",
  wsUrl: null,
  healthUrl: "http://127.0.0.1:3434/api/status",
  capabilities: ["console.setup", "suite.commands"],
  launchName: "vaexcore console",
  suiteSessionId: null,
  activity: "ready",
  activityDetail: "Ready",
  localRuntime: {
    contractVersion: 1,
    mode: "local-first",
    state: "ready",
    appStorageDir: "/tmp/console",
    suiteDir: "/tmp/vaexcore/suite",
    secureStorage: "local.secrets.json",
    secretStorageState: "ready",
    durableStorage: ["sqlite"],
    networkPolicy: "localhost-only",
    dependencies: [
      {
        name: "setup-server",
        kind: "local-http-service",
        state: "reachable",
        detail: "http://127.0.0.1:3434"
      }
    ]
  }
};

assert.doesNotThrow(() => validateSuiteDiscoveryDocument(discovery));
assert.throws(
  () => validateSuiteDiscoveryDocument({
    ...discovery,
    apiUrl: "https://example.com"
  }),
  /localhost URL/
);

assert.doesNotThrow(() => validateSuiteCommandDocument({
  schemaVersion: 1,
  commandId: "focus-ops-1",
  sourceApp: "vaexcore-studio",
  sourceAppName: "vaexcore studio",
  targetApp: "vaexcore-console",
  command: "focus-ops",
  requestedAt: "2026-05-06T12:00:00Z",
  payload: {}
}));
assert.throws(
  () => validateSuiteCommandDocument({
    schemaVersion: 1,
    commandId: "focus-ops-2",
    sourceApp: "vaexcore-studio",
    sourceAppName: "vaexcore studio",
    targetApp: "vaexcore-console",
    command: "focus-ops",
    requestedAt: "2026-05-06T12:00:00Z",
    payload: "bad-payload"
  }),
  /payload must be an object/
);

console.log("console suite validation smoke passed");
