import { writeFileSync } from "node:fs";
import { join } from "node:path";

export function createSetupUiSmokeFixtures({
  Database,
  tempDir,
  smokeDbPath,
  assert,
}) {
  function writeLocalSecretsFixture(secrets) {
    writeFileSync(
      join(tempDir, "local.secrets.json"),
      `${JSON.stringify(secrets, null, 2)}\n`,
      {
        mode: 0o600,
      },
    );
  }

  function insertExternalOutboundFixture() {
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
          retry_after_ms,
          next_attempt_at,
          queue_depth,
          category,
          action,
          importance,
          giveaway_id,
          resent_from
        ) VALUES (
          @id,
          @source,
          @status,
          @message,
          @attempts,
          @queuedAt,
          @updatedAt,
          @reason,
          @failureCategory,
          @retryAfterMs,
          @nextAttemptAt,
          @queueDepth,
          @category,
          @action,
          @importance,
          @giveawayId,
          @resentFrom
        )
      `,
    ).run({
      id: "external-bot-outbound",
      source: "bot",
      status: "failed",
      message:
        "Giveaway started: External Smoke. Type !enter to enter. Winners: 1.",
      attempts: 4,
      queuedAt: now,
      updatedAt: now,
      reason: "external standalone bot write",
      failureCategory: "network",
      retryAfterMs: null,
      nextAttemptAt: null,
      queueDepth: null,
      category: "giveaway",
      action: "start",
      importance: "critical",
      giveawayId: null,
      resentFrom: null,
    });
    db.close();
  }

  function assertReminderSettingsFixture(expected) {
    const db = new Database(smokeDbPath, { readonly: true });
    const row = db
      .prepare(
        "SELECT enabled, interval_minutes FROM giveaway_reminder_settings WHERE id = 1",
      )
      .get();
    db.close();

    assert(Boolean(row), "giveaway reminder settings are persisted");
    assert(
      row.enabled === expected.enabled,
      "giveaway reminder enabled state persists",
    );
    assert(
      row.interval_minutes === expected.intervalMinutes,
      "giveaway reminder interval persists",
    );
  }

  return {
    assertReminderSettingsFixture,
    insertExternalOutboundFixture,
    writeLocalSecretsFixture,
  };
}
