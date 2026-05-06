import assert from "node:assert/strict";
import { StudioClient } from "../desktop/shared/src/studio/client.ts";

const originalFetch = globalThis.fetch;
const seenPaths: string[] = [];
let markerBody: Record<string, unknown> | null = null;

const mockFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  seenPaths.push(url.pathname);
  const headers = new Headers(init?.headers);

  assert.equal(headers.get("x-vaexcore-client-id"), "vaexcore-console");
  assert.equal(headers.get("x-vaexcore-client-name"), "vaexcore console");
  assert.equal(headers.get("x-vaexcore-token"), "studio-token");

  if (url.pathname === "/health") {
    return studioResponse({
      service: "vaexcore studio",
      version: "0.1.0",
      ok: true,
      auth_required: true,
      dev_auth_bypass: false
    });
  }

  if (url.pathname === "/marker/create") {
    markerBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(headers.get("content-type"), "application/json");
    return studioResponse({
      id: "marker_123",
      label: markerBody.label ?? null,
      source_app: markerBody.source_app ?? null,
      source_event_id: markerBody.source_event_id ?? null,
      recording_session_id: null,
      media_path: null,
      start_seconds: null,
      end_seconds: null,
      metadata: markerBody.metadata ?? {},
      created_at: "2026-05-02T12:00:00Z"
    });
  }

  return new Response("not found", { status: 404 });
};

try {
  globalThis.fetch = mockFetch;

  const client = new StudioClient({
    enabled: true,
    apiUrl: "http://studio.local",
    token: "studio-token"
  });

  const health = await client.health();
  assert.equal(health.service, "vaexcore studio");

  const marker = await client.createMarker({
    label: "chat marker",
    source_event_id: "chat:message-123",
    metadata: {
      contract: "vaexcore.studio.marker.v1",
      schemaVersion: 1,
      eventType: "console.chat.marker",
      command: "vcmark",
      source: {
        appId: "vaexcore-console",
        appName: "vaexcore console",
        workflow: "manual-chat-marker"
      },
      userLogin: "caster",
      createdAt: "2026-05-02T12:00:00Z"
    }
  });

  assert.deepEqual(seenPaths, ["/health", "/marker/create"]);
  assert.equal(marker.source_app, "vaexcore-console");
  assert.equal(marker.source_event_id, "chat:message-123");
  assert.equal(markerBody?.source_app, "vaexcore-console");
  assert.equal(markerBody?.source_event_id, "chat:message-123");
  const metadata = markerBody?.metadata as Record<string, unknown>;
  assert.equal(metadata.contract, "vaexcore.studio.marker.v1");
  assert.equal(metadata.schemaVersion, 1);
  assert.equal(metadata.eventType, "console.chat.marker");
  assert.deepEqual(metadata.source, {
    appId: "vaexcore-console",
    appName: "vaexcore console",
    workflow: "manual-chat-marker"
  });
  assert.equal(metadata.createdAt, "2026-05-02T12:00:00Z");
  assert.deepEqual(metadata, {
    contract: "vaexcore.studio.marker.v1",
    schemaVersion: 1,
    eventType: "console.chat.marker",
    command: "vcmark",
    source: {
      appId: "vaexcore-console",
      appName: "vaexcore console",
      workflow: "manual-chat-marker"
    },
    userLogin: "caster",
    createdAt: "2026-05-02T12:00:00Z"
  });
} finally {
  globalThis.fetch = originalFetch;
}

console.log("console studio integration smoke passed");

function studioResponse(data: unknown) {
  return new Response(
    JSON.stringify({
      ok: true,
      data,
      error: null
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" }
    }
  );
}
