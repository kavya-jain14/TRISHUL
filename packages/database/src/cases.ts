import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import {
  caseStateSchema,
  createComplaintRequestSchema,
  type CaseState,
  type CreateComplaintRequest
} from "../../contracts/src/case.ts";

const caseEventInputSchema = z.object({
  caseId: z.string().min(1),
  state: caseStateSchema,
  rationale: z.string().min(1),
  sourceUrls: z.array(z.url()),
  occurredAt: z.iso.datetime({ offset: true }),
  idempotencyKey: z.string().min(1)
}).strict();

const versionedArtifactSchema = z.object({
  caseId: z.string().min(1),
  graphVersion: z.int().positive(),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime({ offset: true }),
  idempotencyKey: z.string().min(1)
}).strict();

export type PersistedCase = {
  caseId: string;
  currentState: CaseState;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type CaseRow = {
  caseId: string;
  currentState: string;
  version: number;
  createdAt: string | Date;
  updatedAt: string | Date;
};

function mapCase(row: CaseRow): PersistedCase {
  return {
    caseId: row.caseId,
    currentState: caseStateSchema.parse(row.currentState),
    version: row.version,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString()
  };
}

export class PostgresCaseRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async createFromComplaint(rawRequest: unknown): Promise<{ status: "CREATED" | "IDEMPOTENT_REPLAY"; case: PersistedCase }> {
    const request = createComplaintRequestSchema.parse(rawRequest);
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await this.#findComplaintByIdempotencyKey(client, request.idempotencyKey);
      if (existing !== undefined) {
        if (!isDeepStrictEqual(existing, request)) throw new Error(`Complaint idempotency key ${request.idempotencyKey} was reused with different content.`);
        const replayedCase = await this.#findCase(client, request.caseId);
        if (replayedCase === undefined) throw new Error(`Case ${request.caseId} is missing for an existing complaint.`);
        await client.query("COMMIT");
        return { status: "IDEMPOTENT_REPLAY", case: replayedCase };
      }

      const caseInsert = await client.query<CaseRow>(
        `INSERT INTO fraud_cases (case_id, current_state, version, created_at, updated_at)
         VALUES ($1, 'REPORTED', 1, $2, $2)
         ON CONFLICT (case_id) DO NOTHING
         RETURNING case_id AS "caseId", current_state AS "currentState", version,
           created_at AS "createdAt", updated_at AS "updatedAt"`,
        [request.caseId, request.reportedAt]
      );
      const createdCase = caseInsert.rows[0];
      if (createdCase === undefined) throw new Error(`Case ${request.caseId} already exists with another complaint.`);

      await client.query(
        `INSERT INTO complaints
          (complaint_id, case_id, transaction_id, amount_paise, reported_at, fraud_context,
           payer_reference, beneficiary_reference, source_urls, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
        [request.complaintId, request.caseId, request.transactionId, request.amountPaise,
          request.reportedAt, request.fraudContext, request.payerReference,
          request.beneficiaryReference, JSON.stringify(request.sourceUrls), request.idempotencyKey]
      );
      await client.query(
        `INSERT INTO case_events
          (event_id, case_id, state, rationale, source_urls, occurred_at, idempotency_key)
         VALUES ($1,$2,'REPORTED',$3,$4::jsonb,$5,$6)`,
        [randomUUID(), request.caseId, "Complaint accepted", JSON.stringify(request.sourceUrls),
          request.reportedAt, `case-created:${request.idempotencyKey}`]
      );
      await client.query("COMMIT");
      return { status: "CREATED", case: mapCase(createdCase) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async appendState(rawInput: unknown): Promise<{ status: "APPENDED" | "IDEMPOTENT_REPLAY"; case: PersistedCase }> {
    const input = caseEventInputSchema.parse(rawInput);
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ caseId: string; state: string; rationale: string; sourceUrls: unknown; occurredAt: string | Date }>(
        `SELECT case_id AS "caseId", state, rationale, source_urls AS "sourceUrls", occurred_at AS "occurredAt"
         FROM case_events WHERE idempotency_key = $1`,
        [input.idempotencyKey]
      );
      const event = existing.rows[0];
      if (event !== undefined) {
        const comparable = { caseId: event.caseId, state: event.state, rationale: event.rationale, sourceUrls: event.sourceUrls, occurredAt: new Date(event.occurredAt).toISOString(), idempotencyKey: input.idempotencyKey };
        if (!isDeepStrictEqual(comparable, input)) throw new Error(`Case-event idempotency key ${input.idempotencyKey} was reused with different content.`);
        const replayedCase = await this.#findCase(client, input.caseId);
        if (replayedCase === undefined) throw new Error(`Case ${input.caseId} was not found.`);
        await client.query("COMMIT");
        return { status: "IDEMPOTENT_REPLAY", case: replayedCase };
      }

      await client.query(
        `INSERT INTO case_events (event_id, case_id, state, rationale, source_urls, occurred_at, idempotency_key)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
        [randomUUID(), input.caseId, input.state, input.rationale, JSON.stringify(input.sourceUrls), input.occurredAt, input.idempotencyKey]
      );
      const updated = await client.query<CaseRow>(
        `UPDATE fraud_cases SET current_state = $2, version = version + 1, updated_at = $3
         WHERE case_id = $1
         RETURNING case_id AS "caseId", current_state AS "currentState", version,
           created_at AS "createdAt", updated_at AS "updatedAt"`,
        [input.caseId, input.state, input.occurredAt]
      );
      const row = updated.rows[0];
      if (row === undefined) throw new Error(`Case ${input.caseId} was not found.`);
      await client.query("COMMIT");
      return { status: "APPENDED", case: mapCase(row) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async appendGraphVersion(rawInput: unknown): Promise<"APPENDED" | "IDEMPOTENT_REPLAY"> {
    return this.#appendArtifact("case_graph_versions", "graph_version_id", "graph", rawInput);
  }

  async appendRiskSnapshot(rawInput: unknown): Promise<"APPENDED" | "IDEMPOTENT_REPLAY"> {
    return this.#appendArtifact("case_risk_snapshots", "risk_snapshot_id", "risk", rawInput);
  }

  async appendForecast(rawInput: unknown): Promise<"APPENDED" | "IDEMPOTENT_REPLAY"> {
    return this.#appendArtifact("case_forecasts", "forecast_id", "forecast", rawInput);
  }

  async get(caseId: string): Promise<PersistedCase | undefined> {
    return this.#findCase(this.#pool, caseId);
  }

  async #appendArtifact(table: "case_graph_versions" | "case_risk_snapshots" | "case_forecasts", idColumn: "graph_version_id" | "risk_snapshot_id" | "forecast_id", dataColumn: "graph" | "risk" | "forecast", rawInput: unknown): Promise<"APPENDED" | "IDEMPOTENT_REPLAY"> {
    const input = versionedArtifactSchema.parse(rawInput);
    const result = await this.#pool.query(
      `INSERT INTO ${table} (${idColumn}, case_id, graph_version, ${dataColumn}, created_at, idempotency_key)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT (idempotency_key) DO NOTHING`,
      [randomUUID(), input.caseId, input.graphVersion, JSON.stringify(input.data), input.createdAt, input.idempotencyKey]
    );
    if (result.rowCount === 1) return "APPENDED";
    const existing = await this.#pool.query<{ caseId: string; graphVersion: number; data: unknown; createdAt: string | Date }>(
      `SELECT case_id AS "caseId", graph_version AS "graphVersion", ${dataColumn} AS data,
        created_at AS "createdAt" FROM ${table} WHERE idempotency_key = $1`,
      [input.idempotencyKey]
    );
    const row = existing.rows[0];
    const comparable = row === undefined ? undefined : {
      caseId: row.caseId,
      graphVersion: row.graphVersion,
      data: row.data,
      createdAt: new Date(row.createdAt).toISOString(),
      idempotencyKey: input.idempotencyKey
    };
    if (!isDeepStrictEqual(comparable, input)) throw new Error(`Artifact idempotency key ${input.idempotencyKey} was reused with different content.`);
    return "IDEMPOTENT_REPLAY";
  }

  async #findComplaintByIdempotencyKey(client: PoolClient, idempotencyKey: string): Promise<CreateComplaintRequest | undefined> {
    const result = await client.query<{
      caseId: string; complaintId: string; transactionId: string; amountPaise: number; reportedAt: string | Date;
      fraudContext: string; payerReference: string; beneficiaryReference: string; sourceUrls: unknown; idempotencyKey: string;
    }>(
      `SELECT case_id AS "caseId", complaint_id AS "complaintId", transaction_id AS "transactionId",
        amount_paise::integer AS "amountPaise", reported_at AS "reportedAt", fraud_context AS "fraudContext",
        payer_reference AS "payerReference", beneficiary_reference AS "beneficiaryReference",
        source_urls AS "sourceUrls", idempotency_key AS "idempotencyKey"
       FROM complaints WHERE idempotency_key = $1`,
      [idempotencyKey]
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return createComplaintRequestSchema.parse({ ...row, reportedAt: new Date(row.reportedAt).toISOString() });
  }

  async #findCase(queryable: Pick<Pool, "query"> | Pick<PoolClient, "query">, caseId: string): Promise<PersistedCase | undefined> {
    const result = await queryable.query<CaseRow>(
      `SELECT case_id AS "caseId", current_state AS "currentState", version,
        created_at AS "createdAt", updated_at AS "updatedAt" FROM fraud_cases WHERE case_id = $1`,
      [caseId]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapCase(row);
  }
}

export const fuzailOperationsMigration = "packages/database/migrations/002_fuzail_operations.sql";
