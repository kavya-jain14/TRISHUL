import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { transactionEventSchema, type TransactionEvent } from "../../ledger/src/schema.ts";

type OutboxType = "TRACE_REFRESH" | "EVIDENCE_ANCHOR";

/**
 * Production adapter for Fuzail's event path. The payment event and its trace
 * refresh job are inserted in one PostgreSQL transaction, preventing a lost job.
 */
export class PostgresPaymentEventRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async ingest(rawEvent: unknown): Promise<{ status: "APPENDED" | "IDEMPOTENT_REPLAY"; event: TransactionEvent }> {
    const event = transactionEventSchema.parse(rawEvent);
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<{ event_id: string }>(
        `INSERT INTO payment_transactions (transaction_id, created_at, source)
         VALUES ($1, $2, $3) ON CONFLICT (transaction_id) DO NOTHING`,
        [event.transactionId, event.occurredAt, event.source]
      );
      void inserted;
      const eventInsert = await client.query<{ event_id: string }>(
        `INSERT INTO transaction_events (event_id, transaction_id, idempotency_key, sequence, occurred_at, from_account_id, to_account_id, amount_paise, channel, location_id, provenance, intelligence, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13)
         ON CONFLICT (idempotency_key) DO NOTHING RETURNING event_id`,
        [event.eventId, event.transactionId, event.idempotencyKey, event.sequence, event.occurredAt, event.fromAccountId, event.toAccountId, event.amountPaise, event.channel, event.locationId ?? null, JSON.stringify(event.provenance), JSON.stringify(event.intelligence), event.source]
      );
      if (eventInsert.rowCount === 0) {
        const existing = await this.findByIdempotencyKey(client, event.idempotencyKey);
        if (existing === undefined || JSON.stringify(existing) !== JSON.stringify(event)) throw new Error(`Idempotency key ${event.idempotencyKey} was reused with a different event.`);
        await client.query("COMMIT");
        return { status: "IDEMPOTENT_REPLAY", event: existing };
      }
      await client.query(
        `INSERT INTO outbox_jobs (job_id, job_type, payload, idempotency_key, status, available_at, created_at)
         VALUES ($1, 'TRACE_REFRESH', $2::jsonb, $3, 'PENDING', $4, $4)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [randomUUID(), JSON.stringify({ transactionId: event.transactionId }), `trace-refresh:${event.eventId}`, event.occurredAt]
      );
      await client.query("COMMIT");
      return { status: "APPENDED", event };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async findByIdempotencyKey(client: PoolClient, key: string): Promise<TransactionEvent | undefined> {
    const result = await client.query<{
      eventId: string; transactionId: string; idempotencyKey: string; sequence: number; occurredAt: string;
      fromAccountId: string; toAccountId: string; amountPaise: number; channel: string; locationId: string | null;
      provenance: unknown; intelligence: unknown; source: string;
    }>(
      `SELECT event_id AS "eventId", transaction_id AS "transactionId", idempotency_key AS "idempotencyKey", sequence,
        to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "occurredAt", from_account_id AS "fromAccountId", to_account_id AS "toAccountId", amount_paise::integer AS "amountPaise",
        channel, location_id AS "locationId", provenance, intelligence, source FROM transaction_events WHERE idempotency_key = $1`, [key]
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    const { locationId, ...event } = row;
    return transactionEventSchema.parse(locationId === null ? event : { ...event, locationId });
  }
}

export const fuzailMigration = "packages/database/migrations/001_fuzail_ledger_outbox.sql";

