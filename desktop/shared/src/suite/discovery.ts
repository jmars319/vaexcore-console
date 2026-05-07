import { CONSOLE_APP, SUITE_DISCOVERY_SCHEMA_VERSION } from "../suiteProtocol";

export type SuiteDiscoveryDocument = {
  schemaVersion?: number;
  appId?: string;
  appName?: string;
  bundleIdentifier?: string;
  version?: string;
  pid?: number;
  startedAt?: string;
  updatedAt?: string;
  apiUrl?: string | null;
  wsUrl?: string | null;
  healthUrl?: string | null;
  capabilities?: string[];
  launchName?: string;
  suiteSessionId?: string | null;
  activity?: string | null;
  activityDetail?: string | null;
  localRuntime?: SuiteLocalRuntime | null;
};

export type SuiteLocalRuntime = {
  contractVersion: 1;
  mode: "local-first";
  state: "ready" | "degraded" | "blocked";
  appStorageDir: string;
  suiteDir: string;
  secureStorage: string;
  secretStorageState: string;
  durableStorage: string[];
  networkPolicy: "localhost-only";
  dependencies: SuiteLocalRuntimeDependency[];
};

export type SuiteLocalRuntimeDependency = {
  name: string;
  kind: string;
  state: string;
  detail: string;
};

export const validateSuiteDiscoveryDocument = (
  document: SuiteDiscoveryDocument,
) => {
  if (document.schemaVersion !== SUITE_DISCOVERY_SCHEMA_VERSION) {
    throw new Error(
      `Suite discovery schemaVersion must be ${SUITE_DISCOVERY_SCHEMA_VERSION}.`,
    );
  }
  if (document.appId !== CONSOLE_APP.id) {
    throw new Error(`Suite discovery appId must be ${CONSOLE_APP.id}.`);
  }
  if (document.appName !== CONSOLE_APP.name) {
    throw new Error(`Suite discovery appName must be ${CONSOLE_APP.name}.`);
  }
  if (document.bundleIdentifier !== CONSOLE_APP.bundleId) {
    throw new Error(
      `Suite discovery bundleIdentifier must be ${CONSOLE_APP.bundleId}.`,
    );
  }
  if (document.launchName !== CONSOLE_APP.launchName) {
    throw new Error(
      `Suite discovery launchName must be ${CONSOLE_APP.launchName}.`,
    );
  }
  if (!document.version || document.version.trim() === "") {
    throw new Error("Suite discovery version is required.");
  }
  if (!document.pid || document.pid <= 0) {
    throw new Error("Suite discovery pid must be greater than 0.");
  }
  if (!document.startedAt || Number.isNaN(Date.parse(document.startedAt))) {
    throw new Error("Suite discovery startedAt must be a valid timestamp.");
  }
  if (!document.updatedAt || Number.isNaN(Date.parse(document.updatedAt))) {
    throw new Error("Suite discovery updatedAt must be a valid timestamp.");
  }
  if (
    !Array.isArray(document.capabilities) ||
    document.capabilities.length === 0
  ) {
    throw new Error("Suite discovery capabilities must not be empty.");
  }
  for (const [field, value] of Object.entries({
    apiUrl: document.apiUrl,
    wsUrl: document.wsUrl,
    healthUrl: document.healthUrl,
  })) {
    if (value && !isLocalRuntimeUrl(value)) {
      throw new Error(`Suite discovery ${field} must be a localhost URL.`);
    }
  }
  if (
    document.localRuntime?.contractVersion !== SUITE_DISCOVERY_SCHEMA_VERSION
  ) {
    throw new Error("Suite discovery localRuntime.contractVersion mismatch.");
  }
  if (!document.localRuntime?.dependencies?.length) {
    throw new Error(
      "Suite discovery localRuntime.dependencies must not be empty.",
    );
  }
};

export const isLocalRuntimeUrl = (value: string) =>
  value.startsWith("http://127.0.0.1:") ||
  value.startsWith("http://localhost:") ||
  value.startsWith("ws://127.0.0.1:") ||
  value.startsWith("ws://localhost:");
