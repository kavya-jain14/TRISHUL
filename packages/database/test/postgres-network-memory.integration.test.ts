import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { CrossCaseCorrelationSnapshot, GraphSnapshot, Provenance } from '@trishul/contracts';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  NetworkMemoryConflictError,
  PostgresNetworkMemoryRepository,
} from '../src/network-memory.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const observedAt = '2026-08-25T06:30:00.000Z';
const trustedProvenance = {
  sourceType: 'BANK',
  sourceName: 'TRISHUL Member Bank',
  sourceEventId: 'outcome:trusted',
  observedAt,
  evidenceState: 'VERIFIED',
} as const;

function graph(caseId: string, accountId: string): GraphSnapshot {
  return {
    caseId,
    graphVersion: 1,
    generatedAt: observedAt,
    nodes: [
      {
        nodeId: accountId,
        caseId,
        type: 'ACCOUNT',
        label: accountId,
        firstObservedAt: observedAt,
      },
    ],
    edges: [],
  };
}

const correlation: CrossCaseCorrelationSnapshot = {
  correlationRunId: 'correlation:postgres-v1',
  caseId: 'case:current-postgres',
  graphVersion: 1,
  evaluatedAt: observedAt,
  accountSignals: [
    {
      accountId: 'acct:current',
      crossCaseLinkage: 0.45,
      matchedCaseCount: 1,
      confirmedOutcomeCaseCount: 1,
      suspectedOutcomeCaseCount: 0,
      clearedOutcomeCaseCount: 0,
      sharedDownstreamAccountIds: [],
      reasonCodes: ['DIRECT_ACCOUNT_REUSE', 'TRUSTED_CONFIRMED_OUTCOME'],
      matches: [
        {
          matchReference: 'match:opaque-postgres',
          historicalGraphVersion: 1,
          outcomeStatus: 'CONFIRMED',
          directAccountReuse: true,
          sharedDownstreamAccountCount: 0,
          sharedEdgeCount: 0,
          evidenceWeight: 0.45,
          reasonCodes: ['DIRECT_ACCOUNT_REUSE', 'TRUSTED_CONFIRMED_OUTCOME'],
        },
      ],
    },
  ],
  ruleVersion: 'cross-case-correlation-v1',
  calculationInputHash: 'a'.repeat(64),
};

describe.skipIf(!databaseUrl)('PostgreSQL cross-case network memory', () => {
  it('restores histories, trusts only authorised outcomes, and persists replay-safe signals', async () => {
    const fixture = await isolatedDatabase(databaseUrl!);
    try {
      await seedCase(
        fixture.pool,
        'case:current-postgres',
        graph('case:current-postgres', 'acct:current'),
      );
      const confirmedId = await seedCase(
        fixture.pool,
        'case:confirmed-postgres',
        graph('case:confirmed-postgres', 'acct:current'),
      );
      const untrustedId = await seedCase(
        fixture.pool,
        'case:untrusted-postgres',
        graph('case:untrusted-postgres', 'acct:current'),
      );
      await seedOutcome(fixture.pool, confirmedId, 'case:confirmed-postgres', trustedProvenance);
      await seedOutcome(fixture.pool, untrustedId, 'case:untrusted-postgres', {
        ...trustedProvenance,
        sourceType: 'COMPLAINT',
        sourceEventId: 'outcome:untrusted',
        evidenceState: 'SUBMITTED',
      });

      const repository = new PostgresNetworkMemoryRepository(fixture.pool);
      const histories = await repository.historicalCases('case:current-postgres');
      expect(histories.map(({ caseId, outcome }) => ({ caseId, status: outcome.status }))).toEqual([
        { caseId: 'case:confirmed-postgres', status: 'CONFIRMED' },
        { caseId: 'case:untrusted-postgres', status: 'NO_INSTITUTIONAL_OUTCOME' },
      ]);

      const write = {
        idempotencyKey: 'network:postgres-v1',
        requestHash: 'a'.repeat(64),
        correlation,
      };
      expect((await repository.record(write)).status).toBe('CREATED');
      expect((await repository.record(write)).status).toBe('IDEMPOTENT_REPLAY');
      await expect(
        repository.record({ ...write, requestHash: 'b'.repeat(64) }),
      ).rejects.toBeInstanceOf(NetworkMemoryConflictError);

      const restarted = new PostgresNetworkMemoryRepository(fixture.pool);
      expect(await restarted.latestForCase('case:current-postgres')).toEqual(correlation);
      expect(await restarted.latestSignal('case:current-postgres', 1, 'acct:current')).toEqual({
        crossCaseLinkage: 0.45,
        correlationRunId: 'correlation:postgres-v1',
      });
      expect(await restarted.latestSignal('case:current-postgres', 2, 'acct:current')).toBeNull();
    } finally {
      await cleanup(fixture);
    }
  });
});

async function seedCase(pool: Pool, externalCaseId: string, snapshot: GraphSnapshot) {
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO cases (external_case_id, state, original_transaction_ref, graph_version)
     VALUES ($1, 'TRACE', $2, 1)
     RETURNING id`,
    [externalCaseId, `transaction:${externalCaseId}`],
  );
  const caseId = inserted.rows[0]!.id;
  await pool.query(
    `INSERT INTO graph_versions (case_id, version, source_event_id, snapshot)
     VALUES ($1, 1, $2, $3::jsonb)`,
    [caseId, `graph:${externalCaseId}`, JSON.stringify(snapshot)],
  );
  return caseId;
}

async function seedOutcome(
  pool: Pool,
  internalCaseId: string,
  externalCaseId: string,
  provenance: Provenance,
) {
  const payload = {
    eventId: provenance.sourceEventId,
    caseId: externalCaseId,
    type: 'OUTCOME',
    occurredAt: observedAt,
    provenance,
    actualExitMode: 'FORWARDED',
    institutionalOutcome: 'CONFIRMED',
  };
  await pool.query(
    `INSERT INTO transaction_events
       (provider_event_id, case_id, event_type, occurred_at, event_hash, payload, provenance, processed_at)
     VALUES ($1, $2, 'OUTCOME', $3, $4, $5::jsonb, $6::jsonb, $3)`,
    [
      payload.eventId,
      internalCaseId,
      observedAt,
      'c'.repeat(64),
      JSON.stringify(payload),
      JSON.stringify(provenance),
    ],
  );
}

async function isolatedDatabase(connectionString: string) {
  const schema = `trishul_network_memory_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new Pool({ connectionString, max: 1 });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({ connectionString, max: 4, options: `-c search_path=${schema}` });
  for (const migration of ['001_core.sql', '008_cross_case_network_memory.sql']) {
    await pool.query(
      await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'),
    );
  }
  return { adminPool, pool, schema };
}

async function cleanup(fixture: { adminPool: Pool; pool: Pool; schema: string }) {
  await fixture.pool.end();
  await fixture.adminPool.query(`DROP SCHEMA "${fixture.schema}" CASCADE`);
  await fixture.adminPool.end();
}
