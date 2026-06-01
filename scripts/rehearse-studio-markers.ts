import assert from "node:assert/strict";

import { StudioClient } from "../desktop/shared/src/studio/client.ts";
import {
  buildConsoleChatStudioMarker,
  buildConsoleGiveawayStudioMarker,
} from "../desktop/shared/src/studio/markerPayloads.ts";
import type { Giveaway } from "../desktop/shared/src/modules/giveaways/giveaways.types.ts";

const client = new StudioClient({
  enabled: true,
  apiUrl: process.env.VAEXCORE_STUDIO_API_URL ?? "http://127.0.0.1:51287",
  token: process.env.VAEXCORE_STUDIO_API_TOKEN,
});

const health = await client.health();
assert.equal(health.service, "vaexcore studio");
assert.equal(health.ok, true);

const chatMarker = buildConsoleChatStudioMarker({
  rawLabel: "marker rehearsal chat moment",
  message: {
    id: "rehearsal-message-1",
    source: "twitch",
    userLogin: "caster",
    userDisplayName: "Caster",
    receivedAt: new Date("2026-05-29T12:00:00Z"),
  },
});

const firstChat = await client.createMarker(chatMarker);
const secondChat = await client.createMarker({
  ...chatMarker,
  label: "duplicate rehearsal chat moment",
});
assert.equal(secondChat.id, firstChat.id);
assert.equal(firstChat.source_app, "vaexcore-console");
assert.equal(firstChat.source_event_id, "chat:rehearsal-message-1");
assert.equal(firstChat.metadata.contract, "vaexcore.studio.marker.v1");
assert.equal(firstChat.metadata.eventType, "console.chat.marker");

const giveawayMarker = buildConsoleGiveawayStudioMarker(
  "draw",
  giveawayFixture(),
  {
    sourceEventSuffix: "winner-7",
    statusTimestamp: "2026-05-29T12:05:00Z",
    metadata: {
      winners: [{ id: 7, login: "winner" }],
    },
  },
);
const giveaway = await client.createMarker(giveawayMarker);
assert.equal(giveaway.source_app, "vaexcore-console");
assert.equal(
  giveaway.source_event_id,
  "vaexcore-console:giveaway:42:draw:winner-7",
);
assert.equal(giveaway.metadata.contract, "vaexcore.studio.marker.v1");
assert.equal(giveaway.metadata.eventType, "console.giveaway.draw");

const markers = await client.markers({
  sourceApp: "vaexcore-console",
  limit: 20,
});
const sourceEventIds = new Set(
  markers.markers.map((marker) => marker.source_event_id),
);
assert.equal(markers.markers.length, 2);
assert.equal(sourceEventIds.has("chat:rehearsal-message-1"), true);
assert.equal(
  sourceEventIds.has("vaexcore-console:giveaway:42:draw:winner-7"),
  true,
);

console.log("console studio marker rehearsal passed");

function giveawayFixture(): Giveaway {
  return {
    id: 42,
    title: "Launch Night",
    keyword: "enter",
    status: "closed",
    winner_count: 1,
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
    entries_close_at: "2026-05-29T12:04:00Z",
    timer_started_at: "2026-05-29T11:50:00Z",
    operator_twitch_user_id: "caster-1",
    operator_login: "caster",
    draw_seed: "seed",
    draw_result_json: "{}",
    last_draw_at: "2026-05-29T12:05:00Z",
    created_at: "2026-05-29T11:45:00Z",
    opened_at: "2026-05-29T11:50:00Z",
    closed_at: "2026-05-29T12:04:00Z",
    ended_at: null,
  };
}
