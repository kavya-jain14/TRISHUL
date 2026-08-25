import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  AlertJobPayloadSchema,
  CommandCenterAlertSchema,
  CasePrioritySnapshotSchema,
  type AlertJobPayload,
  type CommandCenterAlert,
  type CasePrioritySnapshot,
} from '@trishul/contracts';
import type { Pool, PoolClient } from 'pg';

export class CommandCenterConflictError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CommandCenterConflictError';
  }
}

export interface PriorityRecordInput {
  snapshot: CasePrioritySnapshot;
  alert: CommandCenterAlert | null;
  idempotencyKey: string;
  requestHash: string;
}

export interface AlertLifecycleInput {
  alertId: string;
  caseId: string;
  actorRef: string;
  rationale: string;
  idempotencyKey: string;
  requestHash: string;
  occurredAt: string;
}

export interface CommandCenterRepository {
  recordPriority(input: PriorityRecordInput): Promise<{
    snapshot: CasePrioritySnapshot;
    alert: CommandCenterAlert | null;
    replayed: boolean;
  }>;
  latestPriorityForCase(caseId: string): Promise<CasePrioritySnapshot | null>;
  latestPrioritiesForCases(caseIds: readonly string[]): Promise<readonly CasePrioritySnapshot[]>;
  listAlertsForCase(caseId: string): Promise<readonly CommandCenterAlert[]>;
  acknowledgeAlert(input: AlertLifecycleInput): Promise<CommandCenterAlert>;
  resolveAlert(input: AlertLifecycleInput): Promise<CommandCenterAlert>;
}

interface StoredPriority {
  snapshot: CasePrioritySnapshot;
  alertId: string | null;
  requestHash: string;
}

export class InMemoryCommandCenterRepository implements CommandCenterRepository {
  private readonly priorities = new Map<string, CasePrioritySnapshot[]>();
  private readonly priorityIdempotency = new Map<string, StoredPriority>();
  private readonly alerts = new Map<string, CommandCenterAlert>();
  private readonly alertDeduplication = new Map<string, string>();
  private readonly lifecycleIdempotency = new Map<
    string,
    { requestHash: string; response: CommandCenterAlert }
  >();

  async recordPriority(input: PriorityRecordInput) {
    const snapshot = CasePrioritySnapshotSchema.parse(input.snapshot);
    const alert = input.alert ? CommandCenterAlertSchema.parse(input.alert) : null;
    const key = `${snapshot.caseId}:${input.idempotencyKey}`;
    const existing = this.priorityIdempotency.get(key);
    if (existing) {
      if (existing.requestHash !== input.requestHash)
        throw idempotencyConflict(input.idempotencyKey);
      return {
        snapshot: structuredClone(existing.snapshot),
        alert: existing.alertId ? structuredClone(this.alerts.get(existing.alertId) ?? null) : null,
        replayed: true,
      };
    }

    const duplicateId = alert ? this.alertDeduplication.get(alert.deduplicationKey) : undefined;
    if (alert) {
      if (duplicateId) {
        const duplicate = this.alerts.get(duplicateId);
        if (!duplicate || !isDeepStrictEqual(toAlertJob(duplicate), toAlertJob(alert))) {
          throw new CommandCenterConflictError(
            'ALERT_DEDUPLICATION_CONFLICT',
            `Alert deduplication key ${alert.deduplicationKey} was reused with different evidence.`,
          );
        }
      }
    }
    this.priorities.set(snapshot.caseId, [
      ...(this.priorities.get(snapshot.caseId) ?? []),
      structuredClone(snapshot),
    ]);
    if (alert && !duplicateId) {
      this.alerts.set(alert.alertId, structuredClone(alert));
      this.alertDeduplication.set(alert.deduplicationKey, alert.alertId);
    }
    this.priorityIdempotency.set(key, {
      snapshot: structuredClone(snapshot),
      alertId: alert?.alertId ?? null,
      requestHash: input.requestHash,
    });
    return { snapshot, alert, replayed: false };
  }

  async latestPriorityForCase(caseId: string): Promise<CasePrioritySnapshot | null> {
    return structuredClone(this.priorities.get(caseId)?.at(-1) ?? null);
  }

  async latestPrioritiesForCases(caseIds: readonly string[]) {
    const snapshots = await Promise.all(
      caseIds.map((caseId) => this.latestPriorityForCase(caseId)),
    );
    return snapshots.filter((value): value is CasePrioritySnapshot => value !== null);
  }

  async listAlertsForCase(caseId: string) {
    return [...this.alerts.values()]
      .filter((alert) => alert.caseId === caseId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((alert) => structuredClone(alert));
  }

  async acknowledgeAlert(input: AlertLifecycleInput) {
    return this.updateAlert('ACKNOWLEDGE', input);
  }

  async resolveAlert(input: AlertLifecycleInput) {
    return this.updateAlert('RESOLVE', input);
  }

  private async updateAlert(
    operation: 'ACKNOWLEDGE' | 'RESOLVE',
    input: AlertLifecycleInput,
  ): Promise<CommandCenterAlert> {
    const replayKey = `${operation}:${input.alertId}:${input.idempotencyKey}`;
    const replay = this.lifecycleIdempotency.get(replayKey);
    if (replay) {
      if (replay.requestHash !== input.requestHash) throw idempotencyConflict(input.idempotencyKey);
      return structuredClone(replay.response);
    }
    const alert = this.alerts.get(input.alertId);
    if (!alert || alert.caseId !== input.caseId) {
      throw new CommandCenterConflictError(
        'ALERT_NOT_FOUND',
        `Alert ${input.alertId} was not found.`,
      );
    }
    if (operation === 'ACKNOWLEDGE' && alert.status !== 'OPEN') {
      throw new CommandCenterConflictError(
        'ALERT_STATE_CONFLICT',
        `Alert ${input.alertId} is already ${alert.status}.`,
      );
    }
    if (operation === 'RESOLVE' && alert.status !== 'ACKNOWLEDGED') {
      throw new CommandCenterConflictError(
        'ALERT_ACKNOWLEDGEMENT_REQUIRED',
        `Alert ${input.alertId} must be acknowledged before resolution.`,
      );
    }
    const updated = CommandCenterAlertSchema.parse(
      operation === 'ACKNOWLEDGE'
        ? {
            ...alert,
            status: 'ACKNOWLEDGED',
            acknowledgedAt: input.occurredAt,
            acknowledgedBy: input.actorRef,
            acknowledgementRationale: input.rationale,
          }
        : {
            ...alert,
            status: 'RESOLVED',
            resolvedAt: input.occurredAt,
            resolvedBy: input.actorRef,
            resolutionRationale: input.rationale,
          },
    );
    this.alerts.set(updated.alertId, updated);
    this.lifecycleIdempotency.set(replayKey, {
      requestHash: input.requestHash,
      response: structuredClone(updated),
    });
    return updated;
  }
}

export class PostgresCommandCenterRepository implements CommandCenterRepository {
  constructor(private readonly pool: Pool) {}

  async recordPriority(input: PriorityRecordInput) {
    const snapshot = CasePrioritySnapshotSchema.parse(input.snapshot);
    const alert = input.alert ? CommandCenterAlertSchema.parse(input.alert) : null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const replay = await client.query<{ request_hash: string; snapshot: unknown }>(
        `SELECT priority.request_hash, priority.snapshot
         FROM case_priority_snapshots priority
         JOIN cases ON cases.id = priority.case_id
         WHERE cases.external_case_id = $1 AND priority.idempotency_key = $2
         FOR UPDATE`,
        [snapshot.caseId, input.idempotencyKey],
      );
      if (replay.rows[0]) {
        if (replay.rows[0].request_hash !== input.requestHash) {
          throw idempotencyConflict(input.idempotencyKey);
        }
        const storedSnapshot = CasePrioritySnapshotSchema.parse(replay.rows[0].snapshot);
        const storedAlert = await findAlertByPriorityRun(client, storedSnapshot.priorityRunId);
        await client.query('COMMIT');
        return { snapshot: storedSnapshot, alert: storedAlert, replayed: true };
      }

      const inserted = await client.query(
        `INSERT INTO case_priority_snapshots
          (priority_run_id, case_id, graph_version, priority_score, priority_band,
           operational_state, snapshot, idempotency_key, request_hash, calculated_at)
         SELECT $1, cases.id, $3, $4, $5, $6, $7::jsonb, $8, $9, $10
         FROM cases WHERE cases.external_case_id = $2
         ON CONFLICT DO NOTHING`,
        [
          snapshot.priorityRunId,
          snapshot.caseId,
          snapshot.graphVersion,
          snapshot.priorityScore,
          snapshot.priorityBand,
          snapshot.operationalState,
          JSON.stringify(snapshot),
          input.idempotencyKey,
          input.requestHash,
          snapshot.calculatedAt,
        ],
      );
      if (inserted.rowCount !== 1) {
        const concurrentReplay = await client.query<{ request_hash: string; snapshot: unknown }>(
          `SELECT priority.request_hash, priority.snapshot
           FROM case_priority_snapshots priority
           JOIN cases ON cases.id = priority.case_id
           WHERE cases.external_case_id = $1 AND priority.idempotency_key = $2`,
          [snapshot.caseId, input.idempotencyKey],
        );
        if (concurrentReplay.rows[0]) {
          if (concurrentReplay.rows[0].request_hash !== input.requestHash) {
            throw idempotencyConflict(input.idempotencyKey);
          }
          const storedSnapshot = CasePrioritySnapshotSchema.parse(
            concurrentReplay.rows[0].snapshot,
          );
          const storedAlert = await findAlertByPriorityRun(client, storedSnapshot.priorityRunId);
          await client.query('COMMIT');
          return { snapshot: storedSnapshot, alert: storedAlert, replayed: true };
        }
        throw new CommandCenterConflictError(
          'CASE_NOT_FOUND',
          `Case ${snapshot.caseId} was not found.`,
        );
      }

      if (alert) {
        await insertAlert(client, alert);
        const job = toAlertJob(alert);
        await client.query(
          `INSERT INTO outbox_jobs
            (job_id, job_type, payload, idempotency_key, status, available_at, created_at, max_attempts)
           VALUES ($1, 'ALERT_DISPATCH', $2::jsonb, $3, 'PENDING', $4, $4, 3)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            randomUUID(),
            JSON.stringify(job),
            `command-center-alert:${alert.deduplicationKey}`,
            alert.createdAt,
          ],
        );
      }
      await client.query('COMMIT');
      return { snapshot, alert, replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async latestPriorityForCase(caseId: string): Promise<CasePrioritySnapshot | null> {
    const result = await this.pool.query<{ snapshot: unknown }>(
      `SELECT priority.snapshot FROM case_priority_snapshots priority
       JOIN cases ON cases.id = priority.case_id
       WHERE cases.external_case_id = $1
       ORDER BY priority.calculated_at DESC, priority.priority_run_id DESC LIMIT 1`,
      [caseId],
    );
    return result.rows[0] ? CasePrioritySnapshotSchema.parse(result.rows[0].snapshot) : null;
  }

  async latestPrioritiesForCases(caseIds: readonly string[]) {
    if (caseIds.length === 0) return [];
    const result = await this.pool.query<{ snapshot: unknown }>(
      `SELECT DISTINCT ON (priority.case_id) priority.snapshot
       FROM case_priority_snapshots priority
       JOIN cases ON cases.id = priority.case_id
       WHERE cases.external_case_id = ANY($1::text[])
       ORDER BY priority.case_id, priority.calculated_at DESC, priority.priority_run_id DESC`,
      [caseIds],
    );
    return result.rows.map((row) => CasePrioritySnapshotSchema.parse(row.snapshot));
  }

  async listAlertsForCase(caseId: string) {
    const result = await this.pool.query<AlertRow>(
      `SELECT ${ALERT_COLUMNS} FROM alerts
       JOIN cases ON cases.id = alerts.case_id
       WHERE cases.external_case_id = $1 ORDER BY alerts.created_at DESC`,
      [caseId],
    );
    return result.rows.map(mapAlert);
  }

  async acknowledgeAlert(input: AlertLifecycleInput) {
    return this.updateAlert('ACKNOWLEDGE', input);
  }

  async resolveAlert(input: AlertLifecycleInput) {
    return this.updateAlert('RESOLVE', input);
  }

  private async updateAlert(
    operation: 'ACKNOWLEDGE' | 'RESOLVE',
    input: AlertLifecycleInput,
  ): Promise<CommandCenterAlert> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const replay = await client.query<{ request_hash: string; response: unknown }>(
        `SELECT request_hash, response FROM alert_lifecycle_idempotency
         WHERE operation = $1 AND alert_id = $2 AND idempotency_key = $3 FOR UPDATE`,
        [operation, input.alertId, input.idempotencyKey],
      );
      if (replay.rows[0]) {
        if (replay.rows[0].request_hash !== input.requestHash) {
          throw idempotencyConflict(input.idempotencyKey);
        }
        const response = CommandCenterAlertSchema.parse(replay.rows[0].response);
        await client.query('COMMIT');
        return response;
      }

      const currentResult = await client.query<AlertRow>(
        `SELECT ${ALERT_COLUMNS} FROM alerts
         JOIN cases ON cases.id = alerts.case_id
         WHERE alerts.alert_id = $1 AND cases.external_case_id = $2 FOR UPDATE OF alerts`,
        [input.alertId, input.caseId],
      );
      const row = currentResult.rows[0];
      if (!row) {
        throw new CommandCenterConflictError(
          'ALERT_NOT_FOUND',
          `Alert ${input.alertId} was not found.`,
        );
      }
      const current = mapAlert(row);
      if (operation === 'ACKNOWLEDGE' && current.status !== 'OPEN') {
        throw new CommandCenterConflictError(
          'ALERT_STATE_CONFLICT',
          `Alert ${input.alertId} is already ${current.status}.`,
        );
      }
      if (operation === 'RESOLVE' && current.status !== 'ACKNOWLEDGED') {
        throw new CommandCenterConflictError(
          'ALERT_ACKNOWLEDGEMENT_REQUIRED',
          `Alert ${input.alertId} must be acknowledged before resolution.`,
        );
      }

      const update = await client.query<AlertRow>(
        operation === 'ACKNOWLEDGE'
          ? `UPDATE alerts SET status = 'ACKNOWLEDGED', acknowledged_at = $2,
               acknowledged_by = $3, acknowledgement_rationale = $4
             FROM cases WHERE alerts.alert_id = $1 AND cases.id = alerts.case_id
             RETURNING ${ALERT_COLUMNS}`
          : `UPDATE alerts SET status = 'RESOLVED', resolved_at = $2,
               resolved_by = $3, resolution_rationale = $4
             FROM cases WHERE alerts.alert_id = $1 AND cases.id = alerts.case_id
             RETURNING ${ALERT_COLUMNS}`,
        [input.alertId, input.occurredAt, input.actorRef, input.rationale],
      );
      const response = mapAlert(update.rows[0]!);
      await client.query(
        `INSERT INTO alert_lifecycle_idempotency
          (operation, alert_id, idempotency_key, request_hash, response, recorded_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [
          operation,
          input.alertId,
          input.idempotencyKey,
          input.requestHash,
          JSON.stringify(response),
          input.occurredAt,
        ],
      );
      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

interface AlertRow {
  alertId: string;
  caseId: string;
  severity: CommandCenterAlert['severity'];
  kind: CommandCenterAlert['kind'];
  title: string;
  message: string;
  sourceEventId: string | null;
  sourceUrls: unknown;
  priorityRunId: string;
  deduplicationKey: string;
  reasonCodes: unknown;
  recommendedActions: unknown;
  status: CommandCenterAlert['status'];
  createdAt: Date | string;
  acknowledgedAt: Date | string | null;
  acknowledgedBy: string | null;
  acknowledgementRationale: string | null;
  resolvedAt: Date | string | null;
  resolvedBy: string | null;
  resolutionRationale: string | null;
}

const ALERT_COLUMNS = `alerts.alert_id AS "alertId", cases.external_case_id AS "caseId",
  alerts.severity, alerts.kind, alerts.title, alerts.message,
  alerts.source_event_id AS "sourceEventId", alerts.source_urls AS "sourceUrls",
  alerts.priority_run_id AS "priorityRunId", alerts.deduplication_key AS "deduplicationKey",
  alerts.reason_codes AS "reasonCodes", alerts.recommended_actions AS "recommendedActions",
  alerts.status, alerts.created_at AS "createdAt", alerts.acknowledged_at AS "acknowledgedAt",
  alerts.acknowledged_by AS "acknowledgedBy",
  alerts.acknowledgement_rationale AS "acknowledgementRationale",
  alerts.resolved_at AS "resolvedAt", alerts.resolved_by AS "resolvedBy",
  alerts.resolution_rationale AS "resolutionRationale"`;

async function insertAlert(client: PoolClient, alert: CommandCenterAlert): Promise<void> {
  await client.query(
    `INSERT INTO alerts
      (alert_id, case_id, severity, kind, title, message, source_event_id, source_urls,
       priority_run_id, deduplication_key, reason_codes, recommended_actions, status, created_at)
     SELECT $1, cases.id, $3, $4, $5, $6, $7, $8::jsonb, $9, $10,
       $11::jsonb, $12::jsonb, 'OPEN', $13
     FROM cases WHERE cases.external_case_id = $2
     ON CONFLICT (deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING`,
    [
      alert.alertId,
      alert.caseId,
      alert.severity,
      alert.kind,
      alert.title,
      alert.message,
      alert.sourceEventId ?? null,
      JSON.stringify(alert.sourceUrls),
      alert.priorityRunId,
      alert.deduplicationKey,
      JSON.stringify(alert.reasonCodes),
      JSON.stringify(alert.recommendedActions),
      alert.createdAt,
    ],
  );
}

async function findAlertByPriorityRun(
  client: PoolClient,
  priorityRunId: string,
): Promise<CommandCenterAlert | null> {
  const result = await client.query<AlertRow>(
    `SELECT ${ALERT_COLUMNS} FROM alerts
     JOIN cases ON cases.id = alerts.case_id WHERE alerts.priority_run_id = $1 LIMIT 1`,
    [priorityRunId],
  );
  return result.rows[0] ? mapAlert(result.rows[0]) : null;
}

function mapAlert(row: AlertRow): CommandCenterAlert {
  return CommandCenterAlertSchema.parse({
    alertId: row.alertId,
    caseId: row.caseId,
    severity: row.severity,
    kind: row.kind,
    title: row.title,
    message: row.message,
    ...(row.sourceEventId ? { sourceEventId: row.sourceEventId } : {}),
    sourceUrls: row.sourceUrls,
    priorityRunId: row.priorityRunId,
    deduplicationKey: row.deduplicationKey,
    reasonCodes: row.reasonCodes,
    recommendedActions: row.recommendedActions,
    status: row.status,
    createdAt: iso(row.createdAt),
    acknowledgedAt: row.acknowledgedAt ? iso(row.acknowledgedAt) : null,
    acknowledgedBy: row.acknowledgedBy,
    acknowledgementRationale: row.acknowledgementRationale,
    resolvedAt: row.resolvedAt ? iso(row.resolvedAt) : null,
    resolvedBy: row.resolvedBy,
    resolutionRationale: row.resolutionRationale,
  });
}

function toAlertJob(alert: CommandCenterAlert): AlertJobPayload {
  return AlertJobPayloadSchema.parse({
    alertId: alert.alertId,
    caseId: alert.caseId,
    severity: alert.severity,
    kind: alert.kind,
    title: alert.title,
    message: alert.message,
    ...(alert.sourceEventId ? { sourceEventId: alert.sourceEventId } : {}),
    sourceUrls: alert.sourceUrls,
    priorityRunId: alert.priorityRunId,
    deduplicationKey: alert.deduplicationKey,
    reasonCodes: alert.reasonCodes,
    recommendedActions: alert.recommendedActions,
    createdAt: alert.createdAt,
  });
}

function idempotencyConflict(key: string): CommandCenterConflictError {
  return new CommandCenterConflictError(
    'IDEMPOTENCY_CONFLICT',
    `Idempotency key ${key} was reused with different evidence.`,
  );
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
