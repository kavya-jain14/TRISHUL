import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DATABASE_ASSETS } from '@trishul/database';
import { DataType, newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { ConflictError } from '../src/domain/errors.js';
import { CaseService } from '../src/modules/cases/case-service.js';
import { PostgresCaseRepository } from '../src/modules/cases/postgres-case-repository.js';

const complaint = {
  complaintId: 'complaint-postgres-a',
  originalTransactionRef: 'TPG1001',
  reportedAmount: { amountMinor: 2_500_000, currency: 'INR' },
  transactionOccurredAt: '2026-08-24T12:00:00.000Z',
  reportedAt: '2026-08-24T12:20:00.000Z',
  payerReference: 'acct-payer-pg',
  beneficiaryReference: 'vpa-a-pg',
  category: 'IMPERSONATION',
  source: 'BANK',
  evidenceReferences: ['evidence-pg-1'],
};

const caseId = 'case:complaint-postgres-a';
const provenance = (eventId: string) => ({
  sourceType: 'BANK' as const,
  sourceName: 'Integration Test Bank',
  sourceEventId: eventId,
  observedAt: '2026-08-24T12:21:00.000Z',
  evidenceState: 'OBSERVED' as const,
});

describe('PostgresCaseRepository', () => {
  it('survives service recreation with ledger, graph, and idempotency intact', async () => {
    const database = newDb({ autoCreateForeignKeyIndices: true });
    database.public.registerFunction({
      name: 'gen_random_uuid',
      args: [],
      returns: DataType.uuid,
      implementation: randomUUID,
      impure: true,
    });
    const adapter = database.adapters.createPg();
    const pool = new adapter.Pool() as unknown as Pool;
    const migration = await readFile(DATABASE_ASSETS.migrations[0], 'utf8');
    await pool.query(migration);

    const service = new CaseService(
      new PostgresCaseRepository(pool),
      () => '2026-08-24T12:30:00.000Z',
    );
    const created = await service.createComplaint(complaint, 'pg-complaint-create');
    await service.resolveTransaction(
      caseId,
      {
        eventId: 'pg-resolve',
        caseId,
        type: 'RESOLVE_TRANSACTION',
        occurredAt: '2026-08-24T12:20:00.000Z',
        provenance: provenance('pg-resolve'),
        originalRef: 'TPG1001',
        beneficiaryAccount: 'acct-a-pg',
        provider: 'Integration Test Bank',
      },
      'pg-resolve-key',
    );
    const transfer = {
      eventId: 'pg-transfer',
      caseId,
      type: 'TRANSFER' as const,
      occurredAt: '2026-08-24T12:00:00.000Z',
      provenance: provenance('pg-transfer'),
      transactionId: 'TPG1001',
      providerRef: 'RPG1001',
      fromAccount: 'acct-payer-pg',
      toAccount: 'acct-a-pg',
      amount: { amountMinor: 2_500_000, currency: 'INR' as const },
    };
    await service.ingestProviderEvents(caseId, { events: [transfer] }, 'pg-event-batch');
    await service.trace(caseId, 'pg-trace-v1');
    await service.recomputeExposure(
      caseId,
      {
        accountBalances: [
          {
            accountId: 'acct-a-pg',
            knownCleanBalanceMinor: 0,
            provenance: provenance('pg-balance-acct-a'),
          },
        ],
      },
      'pg-exposure-v1',
    );
    await service.assessAccountRisk(
      'acct-a-pg',
      {
        caseId,
        providerSignals: {
          inflowSpike: 0.2,
          uniqueSenderSpike: 0.1,
          firstTimeSenderRatio: 0.2,
          behaviourShift: 0.1,
          crossCaseLinkage: 0,
          authorisedSharedIdentifierStrength: 0,
          provenance: provenance('pg-risk-acct-a'),
        },
        trustedOutcome: { status: 'NONE' },
      },
      'pg-risk-v1',
    );

    const restartedService = new CaseService(new PostgresCaseRepository(pool));
    const restored = await restartedService.getCase(caseId);
    const restoredGraph = await restartedService.getLatestGraph(caseId);
    const restoredExposure = await restartedService.getLatestExposure(caseId);
    const restoredRisk = await restartedService.getRiskSnapshots(caseId);
    const replay = await restartedService.createComplaint(complaint, 'pg-complaint-create');

    expect(created.replayed).toBe(false);
    expect(restored.summary.state).toBe('RISK_ASSESSED');
    expect(restored.complaint.payerReference).toBe('acct-payer-pg');
    expect(restored.providerEventCount).toBe(2);
    expect(restored.processedEventCount).toBe(2);
    expect(restoredGraph.graphVersion).toBe(1);
    expect(restoredGraph.edges).toHaveLength(1);
    expect(restoredExposure.graphVersion).toBe(1);
    expect(restoredExposure.states).toHaveLength(1);
    expect(restoredRisk).toHaveLength(1);
    expect(restoredRisk[0]?.state).not.toBe('CONFIRMED');
    expect(replay.replayed).toBe(true);

    await expect(
      restartedService.ingestProviderEvents(
        caseId,
        {
          events: [
            {
              ...transfer,
              amount: { amountMinor: 2_400_000, currency: 'INR' },
            },
          ],
        },
        'pg-conflicting-event',
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const counts = await pool.query<{
      cases: string;
      transactions: string;
      events: string;
      graphs: string;
      edges: string;
      exposures: string;
      assessments: string;
    }>(
      `SELECT
         (SELECT count(*) FROM cases)::text AS cases,
         (SELECT count(*) FROM payment_transactions)::text AS transactions,
         (SELECT count(*) FROM transaction_events)::text AS events,
         (SELECT count(*) FROM graph_versions)::text AS graphs,
         (SELECT count(*) FROM graph_edges)::text AS edges,
         (SELECT count(*) FROM exposure_states)::text AS exposures,
         (SELECT count(*) FROM mule_assessments)::text AS assessments`,
    );
    const count = (value: string) => Number(value.replaceAll(/[()]/g, ''));
    expect(count(counts.rows[0]?.cases ?? '0')).toBe(1);
    expect(count(counts.rows[0]?.transactions ?? '0')).toBe(1);
    expect(count(counts.rows[0]?.events ?? '0')).toBe(2);
    expect(count(counts.rows[0]?.graphs ?? '0')).toBe(1);
    expect(count(counts.rows[0]?.edges ?? '0')).toBe(1);
    expect(count(counts.rows[0]?.exposures ?? '0')).toBe(1);
    expect(count(counts.rows[0]?.assessments ?? '0')).toBe(1);

    await pool.end();
  });
});
