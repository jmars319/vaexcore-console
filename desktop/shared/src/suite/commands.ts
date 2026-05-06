import {
  CONSOLE_APP,
  SUITE_APPS,
  SUITE_DISCOVERY_SCHEMA_VERSION
} from "../suiteProtocol";

export type SuiteCommandDocument = {
  schemaVersion?: number;
  commandId?: string;
  sourceApp?: string;
  sourceAppName?: string;
  targetApp?: string;
  command?: string;
  requestedAt?: string;
  payload?: unknown;
};

const suiteAppIds: Set<string> = new Set(SUITE_APPS.map((app) => app.id));

export const validateSuiteCommandDocument = (document: SuiteCommandDocument) => {
  if (document.schemaVersion !== SUITE_DISCOVERY_SCHEMA_VERSION) {
    throw new Error(`Suite command schemaVersion must be ${SUITE_DISCOVERY_SCHEMA_VERSION}.`);
  }
  if (!document.sourceApp || !suiteAppIds.has(document.sourceApp)) {
    throw new Error(`Suite command sourceApp is unknown: ${document.sourceApp ?? "(missing)"}.`);
  }
  if (document.targetApp !== CONSOLE_APP.id) {
    throw new Error(`Suite command targetApp must be ${CONSOLE_APP.id}.`);
  }
  if (!document.commandId || document.commandId.trim() === "") {
    throw new Error("Suite command commandId is required.");
  }
  if (!document.command || document.command.trim() === "") {
    throw new Error("Suite command command is required.");
  }
  if (!document.requestedAt || Number.isNaN(Date.parse(document.requestedAt))) {
    throw new Error("Suite command requestedAt must be a valid timestamp.");
  }
  if (!isPlainObject(document.payload)) {
    throw new Error("Suite command payload must be an object.");
  }
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
