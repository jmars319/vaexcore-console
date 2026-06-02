import assert from "node:assert/strict";
import {
  assertStudioMarkerMetadataContract,
  studioConsoleMarkerMetadata,
} from "../desktop/shared/src/studio/markerMetadata.ts";
import {
  buildConsoleChatStudioMarker,
  buildConsoleGiveawayStudioMarker,
} from "../desktop/shared/src/studio/markerPayloads.ts";
import type { Giveaway } from "../desktop/shared/src/modules/giveaways/giveaways.types.ts";

const manualMarker = studioConsoleMarkerMetadata(
  "console.chat.marker",
  {
    command: "vcmark",
    userLogin: "caster",
  },
  {
    workflow: "manual-chat-marker",
    createdAt: "2026-05-06T12:00:00Z",
  },
);

assertStudioMarkerMetadataContract(manualMarker, "console.chat.marker");
assert.equal(manualMarker.command, "vcmark");
assert.deepEqual(manualMarker.source, {
  appId: "vaexcore-console",
  appName: "Vaexcore Console by Tenra",
  workflow: "manual-chat-marker",
});

const giveawayMarker = studioConsoleMarkerMetadata(
  "console.giveaway.draw",
  {
    giveaway: {
      id: "giveaway_123",
      title: "Launch Night",
      status: "drawing",
    },
  },
  {
    createdAt: "2026-05-06T12:05:00Z",
  },
);

assertStudioMarkerMetadataContract(giveawayMarker, "console.giveaway.draw");
assert.deepEqual(giveawayMarker.source, {
  appId: "vaexcore-console",
  appName: "Vaexcore Console by Tenra",
  workflow: "console-event-marker",
});
assert.deepEqual(giveawayMarker.giveaway, {
  id: "giveaway_123",
  title: "Launch Night",
  status: "drawing",
});

const chatMarker = buildConsoleChatStudioMarker({
  rawLabel: "round one clutch",
  message: {
    id: "message-123",
    source: "twitch",
    userLogin: "caster",
    userDisplayName: "Caster",
    receivedAt: new Date("2026-05-06T12:10:00Z"),
  },
});

assert.equal(chatMarker.label, "round one clutch");
assert.equal(chatMarker.source_app, "vaexcore-console");
assert.equal(chatMarker.source_event_id, "chat:message-123");
assertStudioMarkerMetadataContract(
  chatMarker.metadata ?? {},
  "console.chat.marker",
);
assert.equal(chatMarker.metadata?.command, "vcmark");
assert.equal(chatMarker.metadata?.receivedAt, "2026-05-06T12:10:00.000Z");

const giveawayFixture: Giveaway = {
  id: 42,
  title: "Launch Night",
  keyword: "enter",
  status: "closed",
  winner_count: 2,
  item_name: "Space Keys",
  item_edition: "Deluxe",
  game_name: "Orbital Drift",
  marketplace_name: "Steam",
  marketplace_note: "",
  platform_mode: "fixed_platform",
  supported_platforms_json: "[]",
  prize_type: "deluxe_game_key",
  minimum_follow_age_days: 0,
  must_be_present_to_win: 1,
  response_window_minutes: 5,
  one_entry_per_person: 1,
  allow_extra_entries: 0,
  previous_winner_restriction_mode: "none",
  age_guidance_text: "",
  region_availability_disclaimer: "",
  entry_window_minutes: 15,
  entries_close_at: "2026-05-06T12:30:00Z",
  timer_started_at: "2026-05-06T12:00:00Z",
  operator_twitch_user_id: "caster-1",
  operator_login: "caster",
  draw_seed: "seed",
  draw_result_json: "{}",
  last_draw_at: "2026-05-06T12:35:00Z",
  created_at: "2026-05-06T11:50:00Z",
  opened_at: "2026-05-06T12:00:00Z",
  closed_at: "2026-05-06T12:30:00Z",
  ended_at: null,
};
const giveawayPayload = buildConsoleGiveawayStudioMarker(
  "draw",
  giveawayFixture,
  {
    sourceEventSuffix: "winners-7-9",
    statusTimestamp: "2026-05-06T12:35:00Z",
    metadata: {
      winners: [
        {
          id: 7,
          login: "winner",
        },
      ],
    },
  },
);

assert.equal(giveawayPayload.source_app, "vaexcore-console");
assert.equal(
  giveawayPayload.source_event_id,
  "vaexcore-console:giveaway:42:draw:winners-7-9",
);
assertStudioMarkerMetadataContract(
  giveawayPayload.metadata ?? {},
  "console.giveaway.draw",
);
assert.equal(
  (giveawayPayload.metadata?.giveaway as Record<string, unknown>).winnerCount,
  2,
);
assert.deepEqual(giveawayPayload.metadata?.winners, [
  {
    id: 7,
    login: "winner",
  },
]);

assert.throws(
  () =>
    assertStudioMarkerMetadataContract(
      {
        ...manualMarker,
        contract: "wrong.contract",
      },
      "console.chat.marker",
    ),
  /wrong contract name/,
);
assert.throws(
  () =>
    assertStudioMarkerMetadataContract(
      {
        ...manualMarker,
        source: {
          appId: "vaexcore-studio",
          appName: "vaexcore studio",
          workflow: "manual-chat-marker",
        },
      },
      "console.chat.marker",
    ),
  /wrong source app/,
);

console.log("console studio marker metadata smoke passed");
