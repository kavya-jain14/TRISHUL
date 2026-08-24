import type { Pool } from "pg";
import { SyntheticLedger, type TraceResult } from "../../ledger/src/ledger.ts";
import { traceSeedSchema, transactionEventSchema, type TraceSeed, type TransactionEvent } from "../../ledger/src/schema.ts";

type EventRow = {
  eventId: string;
  transactionId: string;
  idempotencyKey: string;
  sequence: number;
  occurredAt: string | Date;
  fromAccountId: string;
  toAccountId: string;
  amountPaise: number;
  channel: string;
  locationId: string | null;
  provenance: unknown;
  intelligence: unknown;
  source: string;
};

const EVENT_COLUMNS = `event_id AS "eventId", transaction_id AS "transactionId",
  idempotency_key AS "idempotencyKey", sequence, occurred_at AS "occurredAt",
  from_account_id AS "fromAccountId", to_account_id AS "toAccountId",
  amount_paise::integer AS "amountPaise", channel, location_id AS "locationId",
  provenance, intelligence, source`;

function mapEvent(row: EventRow): TransactionEvent {
  const { locationId, occurredAt, ...event } = row;
  return transactionEventSchema.parse({
    ...event,
    occurredAt: new Date(occurredAt).toISOString(),
    ...(locationId === null ? {} : { locationId })
  });
}

export class PostgresTraceRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async listForTransaction(transactionId: string): Promise<readonly TransactionEvent[]> {
    const result = await this.#pool.query<EventRow>(
      `SELECT ${EVENT_COLUMNS} FROM transaction_events
       WHERE transaction_id = $1 ORDER BY occurred_at, sequence, event_id`,
      [transactionId]
    );
    return result.rows.map(mapEvent);
  }

  async trace(rawSeed: unknown): Promise<TraceResult> {
    const seed: TraceSeed = traceSeedSchema.parse(rawSeed);
    const result = await this.#pool.query<EventRow>(
      `WITH RECURSIVE traced AS (
         SELECT event_id, transaction_id, idempotency_key, sequence, occurred_at,
           from_account_id, to_account_id, amount_paise, channel, location_id,
           provenance, intelligence, source, 0 AS depth
         FROM transaction_events WHERE transaction_id = $1
         UNION
         SELECT candidate.event_id, candidate.transaction_id, candidate.idempotency_key,
           candidate.sequence, candidate.occurred_at, candidate.from_account_id,
           candidate.to_account_id, candidate.amount_paise, candidate.channel,
           candidate.location_id, candidate.provenance, candidate.intelligence,
           candidate.source, prior.depth + 1
         FROM transaction_events AS candidate
         JOIN traced AS prior
           ON candidate.from_account_id = prior.to_account_id
          AND candidate.occurred_at >= prior.occurred_at
         WHERE prior.depth < $2
       )
       SELECT DISTINCT ON (event_id) ${EVENT_COLUMNS}
       FROM traced ORDER BY event_id, depth`,
      [seed.transactionId, seed.maxHops]
    );
    const ledger = new SyntheticLedger();
    for (const event of result.rows.map(mapEvent)) ledger.append(event);
    return ledger.trace(seed);
  }
}
