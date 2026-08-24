import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DevelopmentHashchainProvider } from '@trishul/audit';
import { DATABASE_ASSETS } from '@trishul/database';
import { DataType, newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { CaseService } from '../src/modules/cases/case-service.js';
import { PostgresCaseRepository } from '../src/modules/cases/postgres-case-repository.js';
import { EvidenceAnchorService } from '../src/modules/evidence-anchors/anchor-service.js';
import { PostgresEvidenceAnchorRepository } from '../src/modules/evidence-anchors/postgres-anchor-repository.js';

describe('PostgresEvidenceAnchorRepository', () => {
  it('restores idempotent receipts without persisting raw evidence', async () => {
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
    for (const migrationUrl of DATABASE_ASSETS.migrations) {
      await pool.query(await readFile(migrationUrl, 'utf8'));
    }

    const caseService = new CaseService(
      new PostgresCaseRepository(pool),
      () => '2026-08-24T15:00:00.000Z',
    );
    const created = await caseService.createComplaint(
      {
        complaintId: 'complaint-anchor-postgres',
        originalTransactionRef: 'TX-ANCHOR-PG',
        reportedAmount: { amountMinor: 250_000, currency: 'INR' },
        transactionOccurredAt: '2026-08-24T14:30:00.000Z',
        reportedAt: '2026-08-24T14:45:00.000Z',
        category: 'IMPERSONATION',
        source: 'BANK',
        evidenceReferences: ['evidence:pg:1'],
      },
      'create-anchor-postgres',
    );
    const caseId = created.value.summary.caseId;
    const provider = new DevelopmentHashchainProvider();
    const evidence = {
      accountReference: 'acct-raw-must-not-persist',
      transactionReference: 'TX-ANCHOR-PG',
      amountMinor: 250_000,
    };
    const anchorService = new EvidenceAnchorService(
      new PostgresEvidenceAnchorRepository(pool),
      provider,
      (id) => caseService.getCase(id),
      () => '2026-08-24T15:01:00.000Z',
    );
    const anchored = await anchorService.anchor(
      caseId,
      { evidenceRef: 'evidence:pg:1', evidence },
      'anchor-postgres-v1',
    );

    const restartedCaseService = new CaseService(new PostgresCaseRepository(pool));
    const restartedAnchorService = new EvidenceAnchorService(
      new PostgresEvidenceAnchorRepository(pool),
      provider,
      (id) => restartedCaseService.getCase(id),
      () => '2026-08-24T15:02:00.000Z',
    );
    const restored = await restartedAnchorService.get(anchored.receipt.anchorId);
    const replay = await restartedAnchorService.anchor(
      caseId,
      { evidenceRef: 'evidence:pg:1', evidence },
      'anchor-postgres-v1',
    );
    const verification = await restartedAnchorService.verify(anchored.receipt.anchorId, {
      evidence,
    });
    const stored = await pool.query('SELECT * FROM evidence_anchor_receipts');

    expect(restored).toEqual(anchored.receipt);
    expect(replay.replayed).toBe(true);
    expect(replay.receipt).toEqual(anchored.receipt);
    expect(verification.verified).toBe(true);
    expect(stored.rowCount).toBe(1);
    expect(JSON.stringify(stored.rows[0])).not.toContain(evidence.accountReference);

    await pool.end();
  });
});
