import assert from "node:assert/strict";
import test from "node:test";
import { fuzailMigration, PostgresPaymentEventRepository } from "./postgres.ts";

test("exports the PostgreSQL payment-event and outbox adapter", () => {
  assert.equal(fuzailMigration, "packages/database/migrations/001_fuzail_ledger_outbox.sql");
  assert.equal(typeof PostgresPaymentEventRepository, "function");
});
