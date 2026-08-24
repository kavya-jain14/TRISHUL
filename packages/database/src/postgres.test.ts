import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fuzailMigration, PostgresPaymentEventRepository } from "./postgres.ts";
import { PostgresAlertRepository } from "./alerts.ts";
import { PostgresCaseRepository, fuzailOperationsMigration } from "./cases.ts";
import { PostgresOutboxRepository } from "./outbox.ts";

test("exports the PostgreSQL payment-event and outbox adapter", () => {
  assert.equal(fuzailMigration, "packages/database/migrations/001_fuzail_ledger_outbox.sql");
  assert.equal(typeof PostgresPaymentEventRepository, "function");
});

test("exports Phase 1 durable worker, alert, and case persistence adapters", () => {
  assert.equal(fuzailOperationsMigration, "packages/database/migrations/002_fuzail_operations.sql");
  assert.equal(typeof PostgresOutboxRepository, "function");
  assert.equal(typeof PostgresAlertRepository, "function");
  assert.equal(typeof PostgresCaseRepository, "function");
});

test("Phase 1 migration contains durable cases, alerts, leases, and dead letters", async () => {
  const migration = await readFile(fuzailOperationsMigration, "utf8");
  for (const requiredFragment of ["dead_letter_jobs", "fraud_cases", "case_graph_versions", "alerts", "lease_expires_at", "failure_count"]) {
    assert.equal(migration.includes(requiredFragment), true, `migration is missing ${requiredFragment}`);
  }
});
