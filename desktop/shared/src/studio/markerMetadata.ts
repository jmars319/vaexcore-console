import {
  CONSOLE_APP,
  MARKER_CONTRACT_NAME,
  MARKER_CONTRACT_SCHEMA_VERSION,
} from "../suiteProtocol";

export type StudioConsoleMarkerMetadataOptions = {
  workflow?: string;
  createdAt?: string;
};

export const studioConsoleMarkerMetadata = (
  eventType: string,
  metadata: Record<string, unknown> = {},
  options: StudioConsoleMarkerMetadataOptions = {},
) => ({
  ...metadata,
  contract: MARKER_CONTRACT_NAME,
  schemaVersion: MARKER_CONTRACT_SCHEMA_VERSION,
  eventType,
  source: {
    appId: CONSOLE_APP.id,
    appName: CONSOLE_APP.name,
    workflow: options.workflow ?? "console-event-marker",
  },
  createdAt: options.createdAt ?? new Date().toISOString(),
});

export const assertStudioMarkerMetadataContract = (
  metadata: Record<string, unknown>,
  eventType: string,
) => {
  const source = metadata.source as Record<string, unknown> | undefined;
  if (metadata.contract !== MARKER_CONTRACT_NAME) {
    throw new Error("Studio marker metadata has the wrong contract name.");
  }
  if (metadata.schemaVersion !== MARKER_CONTRACT_SCHEMA_VERSION) {
    throw new Error("Studio marker metadata has the wrong schema version.");
  }
  if (metadata.eventType !== eventType) {
    throw new Error("Studio marker metadata has the wrong event type.");
  }
  if (
    source?.appId !== CONSOLE_APP.id ||
    source?.appName !== CONSOLE_APP.name
  ) {
    throw new Error("Studio marker metadata has the wrong source app.");
  }
  if (typeof source?.workflow !== "string" || source.workflow.trim() === "") {
    throw new Error("Studio marker metadata must include source.workflow.");
  }
  if (
    typeof metadata.createdAt !== "string" ||
    Number.isNaN(Date.parse(metadata.createdAt))
  ) {
    throw new Error(
      "Studio marker metadata must include a valid createdAt timestamp.",
    );
  }
};
