import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { PaymentRiskAssessment } from '@trishul/contracts';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { PaymentRiskConflictError, PostgresPaymentRiskRepository } from '../src/payment-risk.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

const provenance = {
  sourceType: 'SIMULATOR',
  sourceName: 'TRISHUL Demo Bank',
  sourceEventId: 'risk-signal:postgres',
  observedAt: '2026-08-25T04:30:00.000Z',
  evidenceState: 'SIMULATED',
} as const;

const assessment: PaymentRiskAssessment = {
  assessmentId: 'assessment:postgres-risk-1',
  paymentReference: 'payment:postgres-risk',
  payerReference: 'acct:kavya',
  receiverReference: 'acct:receiver-a',
  subjectReference: 'acct:receiver-a',
  amount: { amountMinor: 500_000, currency: 'INR' },
  occurredAt: '2026-08-25T04:30:00.000Z',
  evaluatedAt: '2026-08-25T04:30:01.000Z',
  trustStatus: 'VERIFIED',
  stepUpStatus: 'NOT_PERFORMED',
  transactionAnomaly: {
    score: 50,
    band: 'ELEVATED',
    reasonCodes: ['NEW_BENEFICIARY', 'PAYER_AMOUNT_ANOMALY'],
  },
  receiverBehaviour: {
    score: 9,
    band: 'LOW',
    reasonCodes: ['NO_MATERIAL_RECEIVER_BEHAVIOUR_ANOMALY'],
  },
  networkRisk: { score: 0, band: 'LOW', reasonCodes: ['NO_MATERIAL_NETWORK_EVIDENCE'] },
  muleState: 'NORMAL',
  decision: 'STEP_UP',
  reasonCodes: ['NEW_BENEFICIARY', 'PAYER_AMOUNT_ANOMALY', 'PAYER_STEP_UP_REQUIRED'],
  ruleVersion: 'payment-risk-v1',
  featureVersion: 'payment-risk-features-v1',
  calculationInputHash: 'a'.repeat(64),
  signalProvenance: { payer: provenance, receiver: provenance, network: provenance },
};

describe.skipIf(!databaseUrl)('PostgreSQL payment-risk persistence', () => {
  it('restores immutable assessments and rejects idempotency drift', async () => {
    const fixture = await isolatedDatabase(databaseUrl!);
    try {
      const repository = new PostgresPaymentRiskRepository(fixture.pool);
      const input = { idempotencyKey: 'risk:postgres-1', requestHash: 'a'.repeat(64), assessment };
      expect((await repository.record(input)).status).toBe('CREATED');
      expect((await repository.record(input)).status).toBe('IDEMPOTENT_REPLAY');
      await expect(
        repository.record({ ...input, requestHash: 'b'.repeat(64) }),
      ).rejects.toBeInstanceOf(PaymentRiskConflictError);

      const restored = new PostgresPaymentRiskRepository(fixture.pool);
      expect(await restored.latestForPayment('payment:postgres-risk')).toEqual(assessment);
    } finally {
      await cleanup(fixture);
    }
  });
});

async function isolatedDatabase(connectionString: string) {
  const schema = `trishul_payment_risk_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new Pool({ connectionString, max: 1 });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({ connectionString, max: 4, options: `-c search_path=${schema}` });
  const migration = await readFile(
    new URL('../migrations/007_payment_risk_assessments.sql', import.meta.url),
    'utf8',
  );
  await pool.query(migration);
  return { adminPool, pool, schema };
}

async function cleanup(fixture: { adminPool: Pool; pool: Pool; schema: string }) {
  await fixture.pool.end();
  await fixture.adminPool.query(`DROP SCHEMA "${fixture.schema}" CASCADE`);
  await fixture.adminPool.end();
}
