import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { CasePrioritySnapshot, CommandCenterAlert } from '@trishul/contracts';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { PostgresAlertRepository } from '../src/alerts.js';
import {
  CommandCenterConflictError,
  PostgresCommandCenterRepository,
} from '../src/command-center.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('PostgreSQL Command Center persistence', () => {
  it('persists priority, alert, durable dispatch, and lifecycle idempotently', async () => {
    const fixture = await isolatedDatabase(databaseUrl!);
    try {
      await fixture.pool.query(
        `INSERT INTO cases (external_case_id, state, original_transaction_ref)
         VALUES ($1, 'PREDICT', $2)`,
        ['case:command-center-pg', 'txn:command-center-pg'],
      );
      const repository = new PostgresCommandCenterRepository(fixture.pool);
      const snapshot = prioritySnapshot();
      const alert = commandCenterAlert(snapshot);
      const input = {
        snapshot,
        alert,
        idempotencyKey: 'priority:command-center-pg',
        requestHash: snapshot.calculationInputHash,
      };

      expect((await repository.recordPriority(input)).replayed).toBe(false);
      expect((await repository.recordPriority(input)).replayed).toBe(true);
      await expect(
        repository.recordPriority({ ...input, requestHash: 'b'.repeat(64) }),
      ).rejects.toBeInstanceOf(CommandCenterConflictError);
      expect(await repository.latestPriorityForCase(snapshot.caseId)).toEqual(snapshot);
      expect(await repository.latestPrioritiesForCases([snapshot.caseId])).toEqual([snapshot]);
      expect(await repository.listAlertsForCase(snapshot.caseId)).toEqual([alert]);

      const queued = await fixture.pool.query(
        `SELECT job_type, idempotency_key FROM outbox_jobs WHERE job_type = 'ALERT_DISPATCH'`,
      );
      expect(queued.rows).toEqual([
        {
          job_type: 'ALERT_DISPATCH',
          idempotency_key: `command-center-alert:${alert.deduplicationKey}`,
        },
      ]);

      const workerReplay = await new PostgresAlertRepository(fixture.pool).persist({
        alertId: alert.alertId,
        caseId: alert.caseId,
        severity: alert.severity,
        kind: alert.kind,
        title: alert.title,
        message: alert.message,
        sourceUrls: alert.sourceUrls,
        priorityRunId: alert.priorityRunId,
        deduplicationKey: alert.deduplicationKey,
        reasonCodes: alert.reasonCodes,
        recommendedActions: alert.recommendedActions,
        createdAt: alert.createdAt,
      });
      expect(workerReplay.status).toBe('IDEMPOTENT_REPLAY');

      const acknowledged = await repository.acknowledgeAlert({
        alertId: alert.alertId,
        caseId: alert.caseId,
        actorRef: 'investigator:postgres',
        rationale: 'Evidence reviewed and provider response coordination started.',
        idempotencyKey: 'alert:command-center-pg:ack',
        requestHash: 'c'.repeat(64),
        occurredAt: '2026-08-25T10:05:00.000Z',
      });
      expect(acknowledged.status).toBe('ACKNOWLEDGED');
      await expect(
        repository.resolveAlert({
          alertId: alert.alertId,
          caseId: alert.caseId,
          actorRef: 'supervisor:postgres',
          rationale: 'Supervisor verified response completion and outcome capture.',
          idempotencyKey: 'alert:command-center-pg:resolve',
          requestHash: 'd'.repeat(64),
          occurredAt: '2026-08-25T10:10:00.000Z',
        }),
      ).resolves.toMatchObject({ status: 'RESOLVED', resolvedBy: 'supervisor:postgres' });
      expect((await repository.listAlertsForCase(alert.caseId))[0]?.status).toBe('RESOLVED');
    } finally {
      await cleanup(fixture);
    }
  });
});

function prioritySnapshot(): CasePrioritySnapshot {
  return {
    priorityRunId: 'priority:command-center-pg',
    caseId: 'case:command-center-pg',
    graphVersion: 2,
    priorityScore: 91,
    priorityBand: 'CRITICAL',
    operationalState: 'ACTIVE_INTERVENTION_WINDOW',
    reasonCodes: ['OPERATIONAL_STATE_ACTIVE_INTERVENTION_WINDOW'],
    recommendedActions: ['ESCALATE_PRIORITY', 'ALERT_BANK', 'ALERT_LEA'],
    features: {
      reportedAmountMinor: 5_000_000,
      maximumAttributableMinor: 4_500_000,
      highestMuleRiskScore: 90,
      crossCaseLinkage: 0.8,
      exitMode: 'CASH_OUT_LIKELY',
      evidenceGateDecision: 'PREDICT',
      highestRiskTimeBucket: '1_TO_2_HOURS',
      forecastConfidence: 0.7,
      observedCashOut: false,
      institutionalOutcome: 'NONE',
      complaintLagMinutes: 15,
    },
    featureVersion: 'case-priority-features-v1',
    ruleVersion: 'case-priority-v1',
    calculationInputHash: 'a'.repeat(64),
    calculatedAt: '2026-08-25T10:00:00.000Z',
  };
}

function commandCenterAlert(snapshot: CasePrioritySnapshot): CommandCenterAlert {
  return {
    alertId: 'alert:command-center-pg',
    caseId: snapshot.caseId,
    severity: 'CRITICAL',
    kind: 'INTERVENTION',
    title: 'Active intervention window detected',
    message: 'Evidence-backed timing and movement signals support urgent authorised review.',
    sourceUrls: [],
    priorityRunId: snapshot.priorityRunId,
    deduplicationKey: 'case:command-center-pg:priority:command-center-pg:active',
    reasonCodes: snapshot.reasonCodes,
    recommendedActions: snapshot.recommendedActions,
    status: 'OPEN',
    createdAt: snapshot.calculatedAt,
    acknowledgedAt: null,
    acknowledgedBy: null,
    acknowledgementRationale: null,
    resolvedAt: null,
    resolvedBy: null,
    resolutionRationale: null,
  };
}

async function isolatedDatabase(connectionString: string) {
  const schema = `trishul_command_center_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new Pool({ connectionString, max: 1 });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({ connectionString, max: 4, options: `-c search_path=${schema}` });
  for (const migrationFile of [
    '001_core.sql',
    '004_durable_outbox.sql',
    '010_command_center.sql',
  ]) {
    const migration = await readFile(
      new URL(`../migrations/${migrationFile}`, import.meta.url),
      'utf8',
    );
    await pool.query(migration);
  }
  return { adminPool, pool, schema };
}

async function cleanup(fixture: { adminPool: Pool; pool: Pool; schema: string }) {
  await fixture.pool.end();
  await fixture.adminPool.query(`DROP SCHEMA "${fixture.schema}" CASCADE`);
  await fixture.adminPool.end();
}
