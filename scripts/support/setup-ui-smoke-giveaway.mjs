export async function assertGiveawayAndOutboundWorkflow({
  assert,
  json,
  expectOk,
  assertReminderSettingsFixture,
  insertExternalOutboundFixture,
}) {
  const templates = await json("/api/giveaway/templates");
  assert(templates.ok === true, "giveaway template route exists");
  assert(
    templates.templates.some((template) => template.action === "start"),
    "giveaway templates include start action",
  );
  const savedTemplates = await json("/api/giveaway/templates", {
    method: "POST",
    body: { templates: { start: "Custom start for {title}: !{keyword}" } },
  });
  assert(
    savedTemplates.templates.some(
      (template) => template.action === "start" && template.customized,
    ),
    "giveaway templates can be customized",
  );
  const resetTemplates = await json("/api/giveaway/templates/reset", {
    method: "POST",
  });
  assert(
    resetTemplates.templates.every((template) => !template.customized),
    "giveaway templates can reset to defaults",
  );

  const reminder = await json("/api/giveaway/reminder");
  assert(reminder.reminder.enabled === false, "giveaway reminder defaults off");
  const savedReminder = await json("/api/giveaway/reminder", {
    method: "POST",
    body: { enabled: true, intervalMinutes: 2 },
  });
  assert(savedReminder.reminder.enabled === true, "reminder can be enabled");
  assertReminderSettingsFixture({ enabled: 1, intervalMinutes: 2 });
  const disabledReminder = await json("/api/giveaway/reminder", {
    method: "POST",
    body: { enabled: false, intervalMinutes: 2 },
  });
  assert(disabledReminder.reminder.enabled === false, "reminder can disable");
  assertReminderSettingsFixture({ enabled: 0, intervalMinutes: 2 });

  const outboundInitial = await json("/api/outbound-messages");
  assert(outboundInitial.ok === true, "outbound message history route exists");
  assert(
    "criticalFailed" in outboundInitial.summary,
    "outbound summary tracks critical failures",
  );
  const outboundResendEmpty = await json("/api/outbound-messages/resend", {
    method: "POST",
  });
  assert(
    outboundResendEmpty.ok === false,
    "outbound resend reports no failed message clearly",
  );
  insertExternalOutboundFixture();
  const outboundAfterExternalWrite = await json("/api/outbound-messages");
  assert(
    outboundAfterExternalWrite.messages.some(
      (message) => message.id === "external-bot-outbound",
    ),
    "setup server refreshes outbound history written by bot",
  );
  assert(
    outboundAfterExternalWrite.messages.some(
      (message) => message.failureCategory === "network",
    ),
    "outbound history returns failure category",
  );
  const statusAfterFailure = await json("/api/status");
  assert(
    statusAfterFailure.runtime.queueHealth.status === "blocked",
    "critical outbound failure blocks queue health",
  );
  assert(
    statusAfterFailure.runtime.outboundRecovery.needed === true,
    "outbound recovery activates after critical failure",
  );
  const panicResendWithoutValidation = await json(
    "/api/giveaway/critical/resend",
    { method: "POST" },
  );
  assert(
    panicResendWithoutValidation.ok === false,
    "panic resend fails clearly until chat is validated",
  );

  const viewerDenied = await json("/api/command/simulate", {
    method: "POST",
    body: {
      actor: "viewer",
      role: "viewer",
      command: '!gstart codes=1 keyword=enter title="Smoke"',
      echoToChat: true,
    },
  });
  assert(viewerDenied.ok === true, "viewer simulated command returns envelope");
  assert(
    viewerDenied.routerResult === "denied",
    "viewer protected command is denied",
  );
  assert(viewerDenied.echoQueued === false, "denied command does not echo");

  const broadcasterStatus = await json("/api/command/simulate", {
    method: "POST",
    body: { actor: "broadcaster", role: "broadcaster", command: "!gstatus" },
  });
  assert(
    broadcasterStatus.routerResult === "handled",
    "broadcaster command routes through CommandRouter",
  );

  const commandStart = await json("/api/command/simulate", {
    method: "POST",
    body: {
      actor: "broadcaster",
      role: "broadcaster",
      command: '!gstart codes=1 keyword=raffle title="Chat Announce"',
    },
  });
  assert(
    commandStart.replies.some((reply) => reply.includes("Type !raffle")),
    "giveaway start announces entry command",
  );
  const commandEnter = await json("/api/command/simulate", {
    method: "POST",
    body: { actor: "alice", role: "viewer", command: "!raffle" },
  });
  assert(
    commandEnter.routerResult === "handled",
    "custom giveaway keyword routes through fallback",
  );
  const duplicateEnter = await json("/api/command/simulate", {
    method: "POST",
    body: { actor: "alice", role: "viewer", command: "!raffle" },
  });
  assert(
    duplicateEnter.replies.some((reply) => reply.includes("already entered")),
    "duplicate giveaway entry is acknowledged",
  );
  const commandClose = await json("/api/command/simulate", {
    method: "POST",
    body: { actor: "broadcaster", role: "broadcaster", command: "!gclose" },
  });
  assert(
    commandClose.replies.some((reply) => reply.includes("Entries closed")),
    "giveaway close announces entry count",
  );
  const commandDraw = await json("/api/command/simulate", {
    method: "POST",
    body: { actor: "broadcaster", role: "broadcaster", command: "!gdraw 1" },
  });
  assert(
    commandDraw.replies.some((reply) => reply.includes("Winner: alice")),
    "giveaway draw announces winner",
  );
  const commandEnd = await json("/api/command/simulate", {
    method: "POST",
    body: { actor: "broadcaster", role: "broadcaster", command: "!gend" },
  });
  assert(
    commandEnd.replies.some((reply) => reply.includes("Final winner: alice")),
    "giveaway end announces final winner",
  );

  await expectOk("/api/giveaway/start", {
    title: "Smoke Giveaway",
    keyword: "enter",
    winnerCount: 2,
  });
  const startedGiveaway = await json("/api/giveaway");
  assert(
    startedGiveaway.summary.operatorState === "entries open",
    "live state shows entries open after start",
  );
  const statusSendWithoutValidation = await json("/api/giveaway/status/send", {
    method: "POST",
  });
  assert(
    statusSendWithoutValidation.ok === false,
    "status-to-chat fails clearly until chat is validated",
  );
  const missingStartAnnouncement = await json("/api/giveaway");
  assert(
    missingStartAnnouncement.assurance.blockContinue === true,
    "missing critical announcement blocks continue warning",
  );
  const resendMissingStart = await json("/api/giveaway/announcement/resend", {
    method: "POST",
    body: { action: "start" },
  });
  assert(
    resendMissingStart.ok === false,
    "phase resend fails clearly until chat is validated",
  );
  await expectOk("/api/giveaway/last-call");
  await expectOk("/api/giveaway/add-entrant", {
    login: "alice",
    displayName: "Alice",
  });
  await expectOk("/api/giveaway/add-entrant", {
    login: "bob",
    displayName: "Bob",
  });
  const reminderWithoutChat = await json("/api/giveaway/reminder/send", {
    method: "POST",
  });
  assert(
    reminderWithoutChat.ok === false,
    "manual reminder fails clearly without chat",
  );
  await expectOk("/api/giveaway/close");
  const closedGiveaway = await json("/api/giveaway");
  assert(
    closedGiveaway.summary.operatorState === "ready to draw",
    "live state shows ready to draw after close",
  );
  await expectOk("/api/giveaway/draw", { count: 2 });

  const giveaway = await json("/api/giveaway");
  assert(giveaway.entries.length === 2, "giveaway entrants load");
  assert(giveaway.winners.length === 2, "giveaway winners load");
  assert(
    giveaway.summary.operatorState === "delivery pending",
    "live state shows delivery pending after draw",
  );

  const firstWinner = giveaway.winners[0]?.login;
  assert(Boolean(firstWinner), "winner login exists");
  await expectOk("/api/giveaway/claim", { username: firstWinner });
  await expectOk("/api/giveaway/deliver", { username: firstWinner });
  await expectOk("/api/giveaway/deliver-all");
  const deliveredState = await json("/api/giveaway");
  assert(
    deliveredState.summary.undeliveredWinnersCount === 0,
    "bulk delivery marks remaining winners delivered",
  );
  assert(
    deliveredState.summary.operatorState === "safe to end",
    "live state shows safe to end after delivery",
  );

  const auditLogs = await json("/api/audit-logs");
  assert(auditLogs.logs.length > 0, "audit logs load");

  await expectOk("/api/giveaway/end");
  const endedGiveaway = await json("/api/giveaway");
  assert(
    endedGiveaway.recap.available === true,
    "post-giveaway recap is available after end",
  );
  assert(
    endedGiveaway.summary.operatorState === "no giveaway",
    "active giveaway state clears after end",
  );
  const lifecycle = await json("/api/giveaway/run-test", {
    method: "POST",
    body: { confirmed: true },
  });
  assert(lifecycle.ok === true, "lifecycle test works");
  await expectOk("/api/giveaway/end");
}
