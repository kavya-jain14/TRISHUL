import { randomUUID } from 'node:crypto';
import { CaseActionRecordSchema, type CaseActionRecord } from '@trishul/contracts';
import type { Pool, PoolClient } from 'pg';

export interface CaseActionWrite {
  action: CaseActionRecord;
  idempotencyKey: string;
  requestHash: string;
  maxAttempts?: number;
}

export interface CaseActionWriteResult {
  status: 'CREATED' | 'IDEMPOTENT_REPLAY';
  action: CaseActionRecord;
}

export interface CaseActionRepository {
  record(input: CaseActionWrite): Promise<CaseActionWriteResult>;
  listForCase(caseId: string, limit?: number): Promise<readonly CaseActionRecord[]>;
}

export class CaseActionConflictError extends Error {}
export class CaseActionCaseNotFoundError extends Error {}

interface ActionRow {
  actionId: string;
  caseId: string;
  actionType: CaseActionRecord['action'];
  actorRef: string;
  purpose: string;
  rationale: string;
  sourceUrls: unknown;
  occurredAt: Date | string;
  recordedAt: Date | string;
  requestHash: string;
}

const ACTION_COLUMNS = `ca.action_id AS "actionId", cases.external_case_id AS "caseId",
  ca.action_type AS "actionType", ca.actor_ref AS "actorRef", ca.purpose, ca.rationale,
  ca.source_urls AS "sourceUrls", ca.occurred_at AS "occurredAt",
  ca.recorded_at AS "recordedAt", ca.request_hash AS "requestHash"`;

export class PostgresCaseActionRepository implements CaseActionRepository {
  constructor(private readonly pool: Pool) {}

  async record(input: CaseActionWrite): Promise<CaseActionWriteResult> {
    const action = CaseActionRecordSchema.parse(input.action);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const caseResult = await client.query<{ id: string }>(
        `SELECT id FROM cases WHERE external_case_id = $1 FOR UPDATE`,
        [action.caseId],
      );
      const internalCase = caseResult.rows[0];
      if (!internalCase) throw new CaseActionCaseNotFoundError(action.caseId);

      const inserted = await client.query<ActionRow>(
        `INSERT INTO case_actions
          (action_id, case_id, action_type, actor_ref, purpose, rationale, source_urls,
           occurred_at, recorded_at, idempotency_key, request_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
         ON CONFLICT DO NOTHING
         RETURNING action_id AS "actionId", $12::text AS "caseId",
           action_type AS "actionType", actor_ref AS "actorRef", purpose, rationale,
           source_urls AS "sourceUrls", occurred_at AS "occurredAt",
           recorded_at AS "recordedAt", request_hash AS "requestHash"`,
        [
          action.actionId,
          internalCase.id,
          action.action,
          action.actorRef,
          action.purpose,
          action.rationale,
          JSON.stringify(action.sourceUrls),
          action.occurredAt,
          action.recordedAt,
          input.idempotencyKey,
          input.requestHash,
          action.caseId,
        ],
      );
      const created = inserted.rows[0];
      if (created) {
        await this.enqueue(client, action, input.maxAttempts ?? 5);
        await client.query('COMMIT');
        return { status: 'CREATED', action: mapAction(created) };
      }

      const existing = await client.query<ActionRow>(
        `SELECT ${ACTION_COLUMNS} FROM case_actions ca
         JOIN cases ON cases.id = ca.case_id
         WHERE ca.case_id = $1 AND ca.idempotency_key = $2`,
        [internalCase.id, input.idempotencyKey],
      );
      const row = existing.rows[0];
      if (!row || row.requestHash !== input.requestHash) {
        throw new CaseActionConflictError(
          `Case action id or idempotency key was reused with different content.`,
        );
      }
      await client.query('COMMIT');
      return { status: 'IDEMPOTENT_REPLAY', action: mapAction(row) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listForCase(caseId: string, limit = 100): Promise<readonly CaseActionRecord[]> {
    const result = await this.pool.query<ActionRow>(
      `SELECT ${ACTION_COLUMNS} FROM case_actions ca
       JOIN cases ON cases.id = ca.case_id
       WHERE cases.external_case_id = $1
       ORDER BY ca.occurred_at DESC, ca.action_id LIMIT $2`,
      [caseId, limit],
    );
    return result.rows.map(mapAction);
  }

  private async enqueue(
    client: PoolClient,
    action: CaseActionRecord,
    maxAttempts: number,
  ): Promise<void> {
    await client.query(
      `INSERT INTO outbox_jobs
        (job_id, job_type, payload, idempotency_key, status, available_at, created_at, max_attempts)
       VALUES ($1, 'CASE_ACTION_EVENT', $2::jsonb, $3, 'PENDING', $4, $4, $5)`,
      [
        randomUUID(),
        JSON.stringify({ action }),
        `case-action:${action.actionId}`,
        action.recordedAt,
        maxAttempts,
      ],
    );
  }
}

export class InMemoryCaseActionRepository implements CaseActionRepository {
  private readonly actions = new Map<string, CaseActionRecord>();
  private readonly idempotency = new Map<string, { requestHash: string; actionId: string }>();

  async record(input: CaseActionWrite): Promise<CaseActionWriteResult> {
    const action = CaseActionRecordSchema.parse(input.action);
    const replayKey = `${action.caseId}:${input.idempotencyKey}`;
    const replay = this.idempotency.get(replayKey);
    if (replay) {
      if (replay.requestHash !== input.requestHash) {
        throw new CaseActionConflictError(
          'Case action idempotency key was reused with different content.',
        );
      }
      return {
        status: 'IDEMPOTENT_REPLAY',
        action: structuredClone(this.actions.get(replay.actionId)!),
      };
    }
    if (this.actions.has(action.actionId)) {
      throw new CaseActionConflictError('Case action ID was reused with different content.');
    }
    this.actions.set(action.actionId, structuredClone(action));
    this.idempotency.set(replayKey, { requestHash: input.requestHash, actionId: action.actionId });
    return { status: 'CREATED', action: structuredClone(action) };
  }

  async listForCase(caseId: string, limit = 100): Promise<readonly CaseActionRecord[]> {
    return [...this.actions.values()]
      .filter((action) => action.caseId === caseId)
      .sort(
        (left, right) =>
          right.occurredAt.localeCompare(left.occurredAt) ||
          left.actionId.localeCompare(right.actionId),
      )
      .slice(0, limit)
      .map((action) => structuredClone(action));
  }
}

function mapAction(row: ActionRow): CaseActionRecord {
  return CaseActionRecordSchema.parse({
    actionId: row.actionId,
    caseId: row.caseId,
    action: row.actionType,
    actorRef: row.actorRef,
    purpose: row.purpose,
    rationale: row.rationale,
    sourceUrls: row.sourceUrls,
    occurredAt: iso(row.occurredAt),
    recordedAt: iso(row.recordedAt),
  });
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
