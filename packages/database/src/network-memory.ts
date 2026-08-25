import {
  CrossCaseCorrelationSnapshotSchema,
  HistoricalCaseEvidenceSchema,
  OutcomeEventSchema,
  type CrossCaseCorrelationSnapshot,
  type HistoricalCaseEvidence,
  type HistoricalInstitutionalOutcome,
} from '@trishul/contracts';
import type { Pool } from 'pg';

const TRUSTED_OUTCOME_SOURCES = new Set(['BANK', 'PSP', 'FI', 'SIMULATOR']);

export interface CrossCaseCorrelationWrite {
  idempotencyKey: string;
  requestHash: string;
  correlation: CrossCaseCorrelationSnapshot;
}

export interface CrossCaseCorrelationWriteResult {
  status: 'CREATED' | 'IDEMPOTENT_REPLAY';
  correlation: CrossCaseCorrelationSnapshot;
}

export interface NetworkMemoryRepository {
  historicalCases(excludeCaseId: string): Promise<HistoricalCaseEvidence[]>;
  record(input: CrossCaseCorrelationWrite): Promise<CrossCaseCorrelationWriteResult>;
  latestForCase(caseId: string): Promise<CrossCaseCorrelationSnapshot | null>;
  latestSignal(
    caseId: string,
    graphVersion: number,
    accountId: string,
  ): Promise<CrossCaseSignalReference | null>;
}

export interface CrossCaseSignalReference {
  crossCaseLinkage: number;
  correlationRunId: string;
}

export class NetworkMemoryConflictError extends Error {}

interface CorrelationRow {
  requestHash: string;
  snapshot: unknown;
}

interface HistoricalCaseRow {
  externalCaseId: string;
  snapshot: unknown;
  outcomePayload: unknown | null;
}

function institutionalOutcome(payload: unknown | null): HistoricalInstitutionalOutcome {
  if (!payload) return { status: 'NO_INSTITUTIONAL_OUTCOME' };
  const parsed = OutcomeEventSchema.safeParse(payload);
  if (
    !parsed.success ||
    !TRUSTED_OUTCOME_SOURCES.has(parsed.data.provenance.sourceType) ||
    (parsed.data.provenance.sourceType === 'SIMULATOR'
      ? parsed.data.provenance.evidenceState !== 'SIMULATED'
      : parsed.data.provenance.evidenceState !== 'VERIFIED')
  ) {
    return { status: 'NO_INSTITUTIONAL_OUTCOME' };
  }
  if (parsed.data.institutionalOutcome === 'UNRESOLVED') {
    return { status: 'NO_INSTITUTIONAL_OUTCOME' };
  }
  return {
    status: parsed.data.institutionalOutcome,
    provenance: parsed.data.provenance,
  };
}

export class PostgresNetworkMemoryRepository implements NetworkMemoryRepository {
  constructor(private readonly pool: Pool) {}

  async historicalCases(excludeCaseId: string): Promise<HistoricalCaseEvidence[]> {
    const result = await this.pool.query<HistoricalCaseRow>(
      `SELECT
         c.external_case_id AS "externalCaseId",
         graph.snapshot,
         outcome.payload AS "outcomePayload"
       FROM cases c
       JOIN LATERAL (
         SELECT gv.snapshot
         FROM graph_versions gv
         WHERE gv.case_id = c.id
         ORDER BY gv.version DESC
         LIMIT 1
       ) graph ON true
       LEFT JOIN LATERAL (
         SELECT te.payload
         FROM transaction_events te
         WHERE te.case_id = c.id
           AND te.event_type = 'OUTCOME'
           AND te.processed_at IS NOT NULL
         ORDER BY te.occurred_at DESC, te.provider_event_id DESC
         LIMIT 1
       ) outcome ON true
       WHERE c.external_case_id <> $1
       ORDER BY c.external_case_id`,
      [excludeCaseId],
    );
    return result.rows.map((row) =>
      HistoricalCaseEvidenceSchema.parse({
        caseId: row.externalCaseId,
        graph: row.snapshot,
        outcome: institutionalOutcome(row.outcomePayload),
      }),
    );
  }

  async record(input: CrossCaseCorrelationWrite): Promise<CrossCaseCorrelationWriteResult> {
    const correlation = CrossCaseCorrelationSnapshotSchema.parse(input.correlation);
    const inserted = await this.pool.query<CorrelationRow>(
      `INSERT INTO cross_case_correlation_runs
         (correlation_run_id, case_id, graph_version, idempotency_key, request_hash, snapshot, evaluated_at)
       SELECT $1, c.id, $3, $4, $5, $6::jsonb, $7
       FROM cases c
       WHERE c.external_case_id = $2
       ON CONFLICT DO NOTHING
       RETURNING request_hash AS "requestHash", snapshot`,
      [
        correlation.correlationRunId,
        correlation.caseId,
        correlation.graphVersion,
        input.idempotencyKey,
        input.requestHash,
        JSON.stringify(correlation),
        correlation.evaluatedAt,
      ],
    );
    const created = inserted.rows[0];
    if (created) {
      return {
        status: 'CREATED',
        correlation: CrossCaseCorrelationSnapshotSchema.parse(created.snapshot),
      };
    }

    const existing = await this.pool.query<CorrelationRow>(
      `SELECT run.request_hash AS "requestHash", run.snapshot
       FROM cross_case_correlation_runs run
       JOIN cases c ON c.id = run.case_id
       WHERE c.external_case_id = $1 AND run.idempotency_key = $2`,
      [correlation.caseId, input.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row || row.requestHash !== input.requestHash) {
      throw new NetworkMemoryConflictError(
        'Correlation run id or idempotency key was reused with different evidence.',
      );
    }
    return {
      status: 'IDEMPOTENT_REPLAY',
      correlation: CrossCaseCorrelationSnapshotSchema.parse(row.snapshot),
    };
  }

  async latestForCase(caseId: string): Promise<CrossCaseCorrelationSnapshot | null> {
    const result = await this.pool.query<{ snapshot: unknown }>(
      `SELECT run.snapshot
       FROM cross_case_correlation_runs run
       JOIN cases c ON c.id = run.case_id
       WHERE c.external_case_id = $1
       ORDER BY run.evaluated_at DESC, run.correlation_run_id DESC
       LIMIT 1`,
      [caseId],
    );
    const row = result.rows[0];
    return row ? CrossCaseCorrelationSnapshotSchema.parse(row.snapshot) : null;
  }

  async latestSignal(
    caseId: string,
    graphVersion: number,
    accountId: string,
  ): Promise<CrossCaseSignalReference | null> {
    const latest = await this.latestForCase(caseId);
    if (!latest || latest.graphVersion !== graphVersion) return null;
    const signal = latest.accountSignals.find((candidate) => candidate.accountId === accountId);
    return signal
      ? {
          crossCaseLinkage: signal.crossCaseLinkage,
          correlationRunId: latest.correlationRunId,
        }
      : null;
  }
}

export class InMemoryNetworkMemoryRepository implements NetworkMemoryRepository {
  private histories: HistoricalCaseEvidence[];
  private readonly byIdempotencyKey = new Map<
    string,
    { requestHash: string; correlation: CrossCaseCorrelationSnapshot }
  >();
  private readonly runIds = new Set<string>();

  constructor(histories: HistoricalCaseEvidence[] = []) {
    this.histories = histories.map((history) => HistoricalCaseEvidenceSchema.parse(history));
  }

  replaceHistoricalCases(histories: HistoricalCaseEvidence[]): void {
    this.histories = histories.map((history) => HistoricalCaseEvidenceSchema.parse(history));
  }

  async historicalCases(excludeCaseId: string): Promise<HistoricalCaseEvidence[]> {
    return structuredClone(
      this.histories
        .filter((history) => history.caseId !== excludeCaseId)
        .sort((left, right) => left.caseId.localeCompare(right.caseId)),
    );
  }

  async record(input: CrossCaseCorrelationWrite): Promise<CrossCaseCorrelationWriteResult> {
    const correlation = CrossCaseCorrelationSnapshotSchema.parse(input.correlation);
    const key = `${correlation.caseId}:${input.idempotencyKey}`;
    const replay = this.byIdempotencyKey.get(key);
    if (replay) {
      if (replay.requestHash !== input.requestHash) {
        throw new NetworkMemoryConflictError(
          'Correlation idempotency key was reused with different evidence.',
        );
      }
      return { status: 'IDEMPOTENT_REPLAY', correlation: structuredClone(replay.correlation) };
    }
    if (this.runIds.has(correlation.correlationRunId)) {
      throw new NetworkMemoryConflictError(
        'Correlation run ID was reused with different evidence.',
      );
    }
    this.runIds.add(correlation.correlationRunId);
    this.byIdempotencyKey.set(key, {
      requestHash: input.requestHash,
      correlation: structuredClone(correlation),
    });
    return { status: 'CREATED', correlation: structuredClone(correlation) };
  }

  async latestForCase(caseId: string): Promise<CrossCaseCorrelationSnapshot | null> {
    const latest = [...this.byIdempotencyKey.values()]
      .map((value) => value.correlation)
      .filter((correlation) => correlation.caseId === caseId)
      .sort(
        (left, right) =>
          right.evaluatedAt.localeCompare(left.evaluatedAt) ||
          right.correlationRunId.localeCompare(left.correlationRunId),
      )[0];
    return latest ? structuredClone(latest) : null;
  }

  async latestSignal(
    caseId: string,
    graphVersion: number,
    accountId: string,
  ): Promise<CrossCaseSignalReference | null> {
    const latest = await this.latestForCase(caseId);
    if (!latest || latest.graphVersion !== graphVersion) return null;
    const signal = latest.accountSignals.find((candidate) => candidate.accountId === accountId);
    return signal
      ? {
          crossCaseLinkage: signal.crossCaseLinkage,
          correlationRunId: latest.correlationRunId,
        }
      : null;
  }
}
