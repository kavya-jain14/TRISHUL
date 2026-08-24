import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { PostgresIdentityResolutionRepository } from '../src/identity-resolution-repository.js';
import { PostgresTrustRepository } from '../src/trust-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('PostgreSQL Trust and identity persistence', () => {
  it('consumes challenges atomically and restores sessions without raw tokens', async () => {
    const fixture = await isolatedDatabase(databaseUrl!);
    try {
      const repository = new PostgresTrustRepository(fixture.pool);
      const publicKeyPem = generateKeyPairSync('ed25519').publicKey.export({
        type: 'spki',
        format: 'pem',
      });
      await repository.registerIssuer('issuer:postgres-bank', publicKeyPem.toString(), true);
      const challengeId = randomUUID();
      await repository.saveChallenge({
        challengeId,
        nonce: 'nonce-postgres-trust-abcdefghijklmnopqrstuvwxyz123456',
        subjectId: 'investigator:postgres',
        capability: 'CASE_READ',
        purpose: 'FRAUD_INVESTIGATION',
        caseId: 'case:postgres-trust',
        issuedAt: '2026-08-25T08:00:00.000Z',
        expiresAt: '2026-08-25T09:00:00.000Z',
        consumedAt: null,
      });
      expect(
        await repository.consumeChallenge(
          challengeId,
          'nonce-postgres-trust-abcdefghijklmnopqrstuvwxyz123456',
          '2026-08-25T08:01:00.000Z',
        ),
      ).toBe(true);
      expect(
        await repository.consumeChallenge(
          challengeId,
          'nonce-postgres-trust-abcdefghijklmnopqrstuvwxyz123456',
          '2026-08-25T08:02:00.000Z',
        ),
      ).toBe(false);

      await repository.saveSession({
        tokenDigest: 'a'.repeat(64),
        credentialId: 'credential:postgres-trust',
        issuerId: 'issuer:postgres-bank',
        session: {
          sessionId: randomUUID(),
          subjectId: 'investigator:postgres',
          role: 'INVESTIGATOR',
          capabilities: ['CASE_READ'],
          purpose: 'FRAUD_INVESTIGATION',
          caseId: 'case:postgres-trust',
          issuedAt: '2026-08-25T08:01:00.000Z',
          expiresAt: '2026-08-25T08:31:00.000Z',
        },
      });
      expect((await repository.getSession('a'.repeat(64)))?.session.caseId).toBe(
        'case:postgres-trust',
      );
    } finally {
      await cleanup(fixture);
    }
  });

  it('enforces same-case single-decision identity resolution', async () => {
    const fixture = await isolatedDatabase(databaseUrl!);
    try {
      const repository = new PostgresIdentityResolutionRepository(fixture.pool);
      const requestId = randomUUID();
      await repository.createRequest({
        requestId,
        caseId: 'case:identity-postgres',
        investigatorId: 'investigator:postgres',
        requestJustification: 'Authorised provider identity resolution is required.',
        status: 'PENDING',
        requestedAt: '2026-08-25T08:00:00.000Z',
      });
      expect(
        await repository.decideRequest(
          requestId,
          'case:other',
          'APPROVED',
          'supervisor:postgres',
          'Independent review confirms the correct lawful scope.',
          'provider-ref:postgres',
          '2026-08-25T08:05:00.000Z',
        ),
      ).toBe(false);
      expect(
        await repository.decideRequest(
          requestId,
          'case:identity-postgres',
          'APPROVED',
          'supervisor:postgres',
          'Independent review confirms the correct lawful scope.',
          'provider-ref:postgres',
          '2026-08-25T08:05:00.000Z',
        ),
      ).toBe(true);
      expect(
        await repository.decideRequest(
          requestId,
          'case:identity-postgres',
          'REJECTED',
          'supervisor:other',
          'A second decision must not overwrite the first decision.',
          undefined,
          '2026-08-25T08:06:00.000Z',
        ),
      ).toBe(false);
      expect(await repository.getRequest(requestId)).toMatchObject({
        status: 'APPROVED',
        decidedBy: 'supervisor:postgres',
        providerReference: 'provider-ref:postgres',
      });
    } finally {
      await cleanup(fixture);
    }
  });
});

async function isolatedDatabase(connectionString: string) {
  const schema = `trishul_trust_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new Pool({ connectionString, max: 1 });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({ connectionString, max: 4, options: `-c search_path=${schema}` });
  const migration = await readFile(
    new URL('../migrations/006_trust_persistence.sql', import.meta.url),
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
