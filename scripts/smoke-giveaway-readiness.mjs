import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
/* Local smoke isolation */
const tempDir = mkdtempSync(join(tmpdir(), "vaexcore-giveaway-smoke-"));
const smokeDbPath = join(tempDir, "data/vaexcore.sqlite");
process.env.VAEXCORE_CONFIG_DIR = tempDir;
process.env.DATABASE_URL = `file:${smokeDbPath}`;

const { startSetupServer } = await import(
  pathToFileURL(resolve("dist-bundle/setup-server.js")).href
);

const handle = await startSetupServer({ port: 3436 });
const baseUrl = handle.url;

try {
  await runSmoke();
  console.log("giveaway readiness smoke passed");
} finally {
  await handle.stop();
  rmSync(tempDir, { recursive: true, force: true });
}

/* Giveaway readiness boundary */
async function runSmoke() {
  const initial = await json("/api/giveaway");
  assert(initial.ok === true, "giveaway state route returns ok");
  assert(initial.summary.status === "none", "giveaway starts inactive");
  assert(initial.entries.length === 0, "inactive giveaway has no entrants");
  assert(initial.winners.length === 0, "inactive giveaway has no winners");

  const templates = await json("/api/giveaway/templates");
  for (const action of [
    "start",
    "entry",
    "last-call",
    "close",
    "draw",
    "reroll",
    "end",
  ]) {
    assert(
      templates.templates.some((template) => template.action === action),
      `${action} template exists`,
    );
  }

  const denied = await simulate({
    actor: "viewer",
    role: "viewer",
    command: '!gstart codes=1 keyword=raffle title="Denied"',
    echoToChat: true,
  });
  assert(denied.routerResult === "denied", "viewer cannot start giveaway");
  assert(denied.echoQueued === false, "denied command does not echo to chat");

  const commandStart = await simulate({
    actor: "broadcaster",
    role: "broadcaster",
    command: '!gstart codes=1 keyword=raffle title="Command Smoke"',
  });
  assert(
    commandStart.routerResult === "handled",
    "broadcaster command starts giveaway",
  );
  assert(
    commandStart.replies.some((reply) =>
      reply.includes("Type !raffle to enter"),
    ),
    "start command announces entry instructions",
  );

  const operatorEntry = await simulate({
    actor: "broadcaster",
    role: "broadcaster",
    command: "!raffle",
  });
  assert(
    operatorEntry.replies.some((reply) =>
      reply.toLowerCase().includes("operator cannot enter"),
    ),
    "giveaway operator cannot enter their own giveaway",
  );

  const commandEntry = await simulate({
    actor: "alice",
    role: "viewer",
    command: "!raffle",
  });
  assert(
    commandEntry.routerResult === "handled",
    "custom keyword routes through command fallback",
  );
  assert(
    commandEntry.replies.some((reply) => reply.includes("Thanks alice")),
    "entry command thanks entrant",
  );

  const commandDuplicate = await simulate({
    actor: "alice",
    role: "viewer",
    command: "!raffle",
  });
  assert(
    commandDuplicate.replies.some((reply) => reply.includes("already entered")),
    "duplicate entry is acknowledged",
  );

  const commandClose = await simulate({
    actor: "broadcaster",
    role: "broadcaster",
    command: "!gclose",
  });
  assert(
    commandClose.replies.some((reply) => reply.includes("Entries closed")),
    "close command announces entry count",
  );

  const commandDraw = await simulate({
    actor: "broadcaster",
    role: "broadcaster",
    command: "!gdraw 1",
  });
  assert(
    commandDraw.replies.some((reply) => reply.includes("Winner: alice")),
    "draw command announces winner",
  );

  const commandEnd = await simulate({
    actor: "broadcaster",
    role: "broadcaster",
    command: "!gend",
  });
  assert(
    commandEnd.replies.some((reply) => reply.includes("Final winner: alice")),
    "end command announces final winner",
  );

  const openDraw = await post("/api/giveaway/draw", { count: 1 });
  assert(openDraw.ok === false, "draw is rejected when no giveaway exists");

  const timerSmoke = await expectOk("/api/giveaway/start", {
    title: "Entry Timer Smoke",
    keyword: "timer",
    winnerCount: 1,
    entryWindowMinutes: 1,
  });
  await expectOk("/api/giveaway/add-entrant", {
    login: "invalid",
    displayName: "Invalid Entrant",
  });
  const removed = await expectOk("/api/giveaway/remove-entrant", {
    username: "invalid",
    reason: "manual smoke removal",
  });
  assert(removed.result.removed === "invalid", "entrant can be removed");
  let timerState = await json("/api/giveaway");
  assert(
    timerState.entries.some(
      (entry) =>
        entry.login === "invalid" && entry.eligibility_status === "removed",
    ),
    "removed entrant remains visible with removed status",
  );
  assert(timerState.summary.entryCount === 0, "removed entrant is not counted");
  assert(
    timerState.summary.eligibility.removedEntries === 1,
    "removed entrant is counted in eligibility summary",
  );
  forceEntryTimerExpired(timerSmoke.state.giveaway.id);
  timerState = await json("/api/giveaway");
  assert(
    timerState.summary.status === "closed",
    "entry timer auto-closes entries",
  );
  assert(
    timerState.summary.timer.running === false,
    "entry timer stops after auto-close",
  );
  await expectOk("/api/giveaway/end");

  await expectOk("/api/giveaway/start", {
    title: "Sniper Elite: Resistance Giveaway",
    keyword: "raid",
    winnerCount: 2,
    itemName: "Sniper Elite: Resistance",
    itemEdition: "Standard Edition",
    gameName: "Sniper Elite: Resistance",
    marketplaceName: "Eneba",
    marketplaceNote: "Key sourced after winner confirms platform/region.",
    platformMode: "winner_selects_after_win",
    supportedPlatforms: [
      "Steam",
      "Xbox",
      "PlayStation",
      "Epic",
      "Other / manual",
    ],
    prizeType: "standard_game_key",
    minimumFollowAgeDays: 7,
    responseWindowMinutes: 7,
    entryWindowMinutes: 10,
  });
  const started = await json("/api/giveaway");
  assert(started.summary.status === "open", "API start opens giveaway");
  assert(
    started.summary.operatorState === "entries open",
    "operator state shows entries open",
  );
  assert(started.summary.keyword === "raid", "keyword is stored");
  assert(started.summary.winnerCount === 2, "winner count is stored");
  assert(
    started.summary.config.gameName === "Sniper Elite: Resistance",
    "structured game name is stored",
  );
  assert(
    started.summary.config.marketplaceName === "Eneba",
    "marketplace disclosure source is stored",
  );
  assert(
    started.summary.timer.running === true,
    "entry timer starts with the giveaway",
  );
  assert(
    started.summary.rules.some((rule) => rule.includes("Followed for 7+ days")),
    "rule summary includes follow-age requirement",
  );
  const overlayState = await json("/api/giveaway/overlay");
  assert(overlayState.ok === true, "giveaway overlay state route exists");
  assert(
    overlayState.marketplace.name === "Eneba",
    "overlay exposes marketplace disclosure source",
  );
  assert(
    overlayState.marketplace.disclosure === "Not sponsored. No affiliate link.",
    "overlay includes non-sponsored disclosure",
  );
  assert(
    started.assurance.available === true,
    "chat assurance is available for open giveaway",
  );
  assert(
    started.assurance.blockContinue === true,
    "missing critical start announcement is visible when chat is not configured",
  );

  insertOutboundFixture({
    id: "pending-critical-start",
    status: "queued",
    action: "start",
    importance: "critical",
    giveawayId: started.giveaway.id,
    message:
      "Giveaway started: Tonight Readiness. Type !raid to enter. Winners: 2.",
  });
  const pendingStart = await json("/api/giveaway");
  assert(
    pendingStart.assurance.summary.pendingCritical === 1,
    "pending critical announcement is counted",
  );
  assert(
    pendingStart.assurance.summary.blockingCritical === 1,
    "pending critical announcement blocks continuation",
  );
  assert(
    pendingStart.assurance.blockContinue === true,
    "pending critical announcement keeps guardrail active",
  );
  assert(
    pendingStart.assurance.nextAction.includes("Wait for Start announcement"),
    "pending critical announcement explains wait action",
  );
  assert(
    pendingStart.assurance.phases.some(
      (phase) =>
        phase.id === "start" &&
        phase.queueStatus === "queued" &&
        phase.blocksContinue,
    ),
    "phase row exposes queued critical delivery state",
  );

  const duplicateStart = await post("/api/giveaway/start", {
    title: "Second Giveaway",
    keyword: "again",
    winnerCount: 1,
  });
  assert(
    duplicateStart.ok === false,
    "start is rejected while giveaway already exists",
  );

  const drawWhileOpen = await post("/api/giveaway/draw", { count: 1 });
  assert(
    drawWhileOpen.ok === false,
    "draw is rejected until giveaway is closed",
  );

  const tooNew = await expectOk("/api/giveaway/add-entrant", {
    login: "too_new",
    displayName: "Too New",
    followAgeDays: 1,
  });
  assert(
    tooNew.result.status === "ineligible",
    "under-minimum follow age is rejected",
  );
  assert(
    tooNew.result.reason.includes("below 7"),
    "under-minimum follow rejection explains the 7-day rule",
  );

  const unverified = await expectOk("/api/giveaway/add-entrant", {
    login: "unverified",
    displayName: "Unverified",
    followVerified: false,
  });
  assert(
    unverified.result.status === "ineligible",
    "unverified follow age is rejected",
  );
  assert(
    unverified.result.reason.toLowerCase().includes("unverified"),
    "unverified follow rejection is explicit",
  );

  const aliceEntry = await expectOk("/api/giveaway/add-entrant", {
    login: "alice",
    displayName: "Alice",
  });
  assert(aliceEntry.result.status === "entered", "7+ day follower can enter");
  const bobEntry = await expectOk("/api/giveaway/add-entrant", {
    login: "bob",
    displayName: "Bob",
    role: "mod",
    followAgeDays: 8,
  });
  assert(bobEntry.result.status === "entered", "mods can enter");
  await expectOk("/api/giveaway/add-entrant", {
    login: "carol",
    displayName: "Carol",
  });
  await expectOk("/api/giveaway/add-entrant", {
    login: "alice",
    displayName: "Alice",
  });
  const withEntrants = await json("/api/giveaway");
  assert(
    withEntrants.entries.length === 3,
    "duplicate entrants do not inflate entry count",
  );
  assert(withEntrants.summary.entryCount === 3, "entry count is eligible-only");

  await expectOk("/api/giveaway/last-call");
  await expectOk("/api/giveaway/close");
  const closed = await json("/api/giveaway");
  assert(closed.summary.status === "closed", "close preserves active giveaway");
  assert(
    closed.summary.operatorState === "ready to draw",
    "closed giveaway is ready to draw",
  );
  assert(
    closed.summary.enoughEntrantsForFullDraw === true,
    "readiness reports enough entrants for full draw",
  );

  const draw = await expectOk("/api/giveaway/draw", { count: 2 });
  assert(
    draw.result.winners.length === 2,
    "draw selects requested winner count",
  );
  const drawn = await json("/api/giveaway");
  assert(
    drawn.winners.filter((winner) => !winner.rerolled_at).length === 2,
    "active winners render after draw",
  );
  assert(Boolean(drawn.summary.draw.seed), "draw seed is exposed for audit");
  assert(
    Array.isArray(drawn.summary.draw.result?.candidateLogins),
    "draw candidate log is exposed for audit",
  );
  assert(
    Array.isArray(drawn.summary.draw.result?.selectedLogins),
    "draw selected log is exposed for audit",
  );
  assert(
    drawn.summary.operatorState === "delivery pending",
    "drawn giveaway requires delivery",
  );

  const activeWinners = drawn.winners.filter((winner) => !winner.rerolled_at);
  const firstWinner = activeWinners[0]?.login;
  const secondWinner = activeWinners[1]?.login;
  assert(Boolean(firstWinner), "first winner login is available");
  assert(Boolean(secondWinner), "second winner login is available");

  const confirmed = await expectOk("/api/giveaway/confirm", {
    username: firstWinner,
    selectedPlatform: "Steam",
    regionCountry: "US",
    deliveryMethod: "Discord DM",
    marketplaceUsed: "Eneba",
    purchaseStatus: "pending_purchase",
  });
  assert(
    confirmed.result.winner.status === "confirmed",
    "admin confirmation marks winner confirmed",
  );
  assert(
    confirmed.result.winner.selected_platform === "Steam",
    "admin confirmation records platform",
  );
  assert(
    confirmed.result.winner.region_country === "US",
    "admin confirmation records region",
  );
  assert(
    confirmed.result.winner.delivery_method === "Discord DM",
    "admin confirmation records delivery method",
  );
  assert(
    confirmed.result.winner.marketplace_used === "Eneba",
    "admin confirmation records marketplace used",
  );
  await expectOk("/api/giveaway/purchase-status", {
    username: firstWinner,
    purchaseStatus: "purchased",
  });
  await expectOk("/api/giveaway/claim", { username: firstWinner });
  await expectOk("/api/giveaway/deliver", { username: firstWinner });

  forceWinnerResponseExpired(drawn.giveaway.id, secondWinner);
  const expiredState = await json("/api/giveaway");
  const expiredWinner = expiredState.winners.find(
    (winner) => winner.login === secondWinner && !winner.rerolled_at,
  );
  assert(
    expiredWinner?.status === "expired",
    "response timer marks pending winner expired",
  );
  assert(
    expiredState.summary.expiredWinnerCount === 1,
    "expired winner is counted in summary",
  );

  const reroll = await expectOk("/api/giveaway/reroll", {
    username: secondWinner,
  });
  assert(
    Boolean(reroll.result.replacement),
    "reroll selects replacement when eligible entrant exists",
  );

  const afterReroll = await json("/api/giveaway");
  assert(afterReroll.summary.rerolledCount === 1, "reroll count is tracked");
  assert(
    afterReroll.winners.filter((winner) => !winner.rerolled_at).length === 2,
    "active winner count remains stable after reroll",
  );

  await expectOk("/api/giveaway/deliver-all");
  const delivered = await json("/api/giveaway");
  assert(
    delivered.summary.undeliveredWinnersCount === 0,
    "deliver all clears pending delivery",
  );
  assert(
    delivered.summary.safeToEnd === true,
    "giveaway reports safe to end after delivery",
  );

  const auditBeforeEnd = await json("/api/audit-logs");
  assert(
    auditBeforeEnd.logs.some((log) => log.action === "giveaway.draw"),
    "draw audit log is written",
  );
  assert(
    auditBeforeEnd.logs.some((log) => log.action === "giveaway.reroll"),
    "reroll audit log is written",
  );

  await expectOk("/api/giveaway/end");
  const ended = await json("/api/giveaway");
  assert(ended.summary.status === "none", "active giveaway clears after end");
  assert(ended.recap.available === true, "post-giveaway recap is available");
  assert(ended.recap.status === "ended", "recap records ended status");
  assert(ended.recap.activeWinnerCount === 2, "recap records active winners");
  assert(
    ended.recap.pendingDeliveryCount === 0,
    "recap records clean delivery state",
  );

  await expectOk("/api/giveaway/start", {
    title: "Unrelated Game Giveaway",
    keyword: "other",
    winnerCount: 1,
    itemName: "Different Game",
    itemEdition: "Standard Edition",
    gameName: "Different Game",
    previousWinnerRestrictionMode: "base_game_blocks_deluxe",
  });
  const unrelatedEntry = await expectOk("/api/giveaway/add-entrant", {
    login: firstWinner,
    displayName: firstWinner,
    followAgeDays: 90,
  });
  assert(
    unrelatedEntry.result.status === "entered",
    "previous winner can enter unrelated item giveaway",
  );
  await expectOk("/api/giveaway/end");

  await expectOk("/api/giveaway/start", {
    title: "Sniper Elite: Resistance Deluxe",
    keyword: "deluxe",
    winnerCount: 1,
    itemName: "Sniper Elite: Resistance",
    itemEdition: "Digital Deluxe Edition",
    gameName: "Sniper Elite: Resistance",
    prizeType: "deluxe_game_key",
    previousWinnerRestrictionMode: "base_game_blocks_deluxe",
  });
  const blockedUpgrade = await expectOk("/api/giveaway/add-entrant", {
    login: firstWinner,
    displayName: firstWinner,
    followAgeDays: 90,
  });
  assert(
    blockedUpgrade.result.status === "ineligible",
    "standard winner is blocked from deluxe of same base game",
  );
  assert(
    blockedUpgrade.result.reason.includes("base game"),
    "duplicate base-game rejection is explicit",
  );
  await expectOk("/api/giveaway/end");

  const outbound = await json("/api/outbound-messages");
  assert(outbound.ok === true, "outbound history route remains available");
  assert(
    "criticalFailed" in outbound.summary,
    "outbound summary includes critical failure count",
  );

  const lifecycle = await post("/api/giveaway/run-test", { confirmed: false });
  assert(
    lifecycle.ok === false,
    "lifecycle test requires explicit confirmation",
  );
  const confirmedLifecycle = await expectOk("/api/giveaway/run-test", {
    confirmed: true,
  });
  assert(
    confirmedLifecycle.draw.winners.length > 0,
    "confirmed lifecycle test draws winners",
  );
  await expectOk("/api/giveaway/end");

  const finalState = await json("/api/giveaway");
  assert(
    finalState.summary.status === "none",
    "smoke finishes with no active giveaway",
  );
}

/* Smoke helper boundary */
async function simulate(body) {
  const result = await post("/api/command/simulate", body);
  assert(result.ok === true, "command simulate returns ok envelope");
  return result;
}

async function expectOk(path, body = {}) {
  const result = await post(path, body);
  assert(result.ok === true, `${path} returns ok`);
  return result;
}

async function post(path, body = {}) {
  return json(path, { method: "POST", body });
}

async function json(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  assert(response.ok, `${path} returned ${response.status}`);
  return response.json();
}

/* Outbound fixture boundary */
function insertOutboundFixture(record) {
  const db = new Database(smokeDbPath);
  const now = new Date().toISOString();

  db.prepare(
    `
      INSERT INTO outbound_messages (
        id,
        source,
        status,
        message,
        attempts,
        queued_at,
        updated_at,
        reason,
        failure_category,
        category,
        action,
        importance,
        giveaway_id
      ) VALUES (
        @id,
        'setup',
        @status,
        @message,
        @attempts,
        @queuedAt,
        @updatedAt,
        @reason,
        @failureCategory,
        'giveaway',
        @action,
        @importance,
        @giveawayId
      )
    `,
  ).run({
    ...record,
    attempts: record.attempts ?? 0,
    queuedAt: now,
    updatedAt: now,
    reason: record.reason ?? "",
    failureCategory: record.failureCategory ?? "none",
  });
  db.close();
}

/* Timer fixture boundary */
function forceEntryTimerExpired(giveawayId) {
  const db = new Database(smokeDbPath);
  const now = new Date(Date.now() - 60_000).toISOString();

  try {
    db.prepare(
      "UPDATE giveaways SET entries_close_at = ?, timer_started_at = COALESCE(timer_started_at, ?) WHERE id = ?",
    ).run(now, now, giveawayId);
  } finally {
    db.close();
  }
}

function forceWinnerResponseExpired(giveawayId, login) {
  const db = new Database(smokeDbPath);
  const now = new Date(Date.now() - 60_000).toISOString();

  try {
    db.prepare(
      `
        UPDATE giveaway_winners
        SET response_expires_at = ?
        WHERE giveaway_id = ?
          AND lower(login) = lower(?)
          AND rerolled_at IS NULL
      `,
    ).run(now, giveawayId, login);
  } finally {
    db.close();
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Giveaway smoke failed: ${message}`);
  }
}
