import assert from "node:assert/strict";
import {
  assertStudioMarkerMetadataContract,
  studioConsoleMarkerMetadata
} from "../desktop/shared/src/studio/markerMetadata.ts";

const manualMarker = studioConsoleMarkerMetadata(
  "console.chat.marker",
  {
    command: "vcmark",
    userLogin: "caster"
  },
  {
    workflow: "manual-chat-marker",
    createdAt: "2026-05-06T12:00:00Z"
  }
);

assertStudioMarkerMetadataContract(manualMarker, "console.chat.marker");
assert.equal(manualMarker.command, "vcmark");
assert.deepEqual(manualMarker.source, {
  appId: "vaexcore-console",
  appName: "vaexcore console",
  workflow: "manual-chat-marker"
});

const giveawayMarker = studioConsoleMarkerMetadata(
  "console.giveaway.draw",
  {
    giveaway: {
      id: "giveaway_123",
      title: "Launch Night",
      status: "drawing"
    }
  },
  {
    createdAt: "2026-05-06T12:05:00Z"
  }
);

assertStudioMarkerMetadataContract(giveawayMarker, "console.giveaway.draw");
assert.deepEqual(giveawayMarker.source, {
  appId: "vaexcore-console",
  appName: "vaexcore console",
  workflow: "console-event-marker"
});
assert.deepEqual(giveawayMarker.giveaway, {
  id: "giveaway_123",
  title: "Launch Night",
  status: "drawing"
});

assert.throws(
  () => assertStudioMarkerMetadataContract(
    {
      ...manualMarker,
      contract: "wrong.contract"
    },
    "console.chat.marker"
  ),
  /wrong contract name/
);
assert.throws(
  () => assertStudioMarkerMetadataContract(
    {
      ...manualMarker,
      source: {
        appId: "vaexcore-studio",
        appName: "vaexcore studio",
        workflow: "manual-chat-marker"
      }
    },
    "console.chat.marker"
  ),
  /wrong source app/
);

console.log("console studio marker metadata smoke passed");
