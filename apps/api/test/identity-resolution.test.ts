import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import type {
  CredentialClaims,
  CredentialRole,
  SignedCredential,
  TrustCapability,
  TrustPurpose,
} from '@trishul/contracts';
import {
  challengeProofPayload,
  credentialSigningPayload,
  InMemoryTrustRepository,
  TrustAccessService,
} from '@trishul/trust';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const now = new Date('2026-08-25T09:00:00.000Z');
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Identity Resolution API', () => {
  it('enforces two-person approval and returns only an opaque provider reference', async () => {
    const fixture = await createFixture();
    const requested = await fixture.app.inject({
      method: 'POST',
      url: `/api/v1/cases/${fixture.caseId}/identity-resolution`,
      headers: { authorization: `Bearer ${fixture.investigatorToken}` },
      payload: { justification: 'Provider identity is required for the authorised investigation.' },
    });
    expect(requested.statusCode).toBe(201);
    const requestId = requested.json().requestId as string;

    const decided = await fixture.app.inject({
      method: 'POST',
      url: `/api/v1/cases/${fixture.caseId}/identity-resolution/${requestId}/decision`,
      headers: { authorization: `Bearer ${fixture.supervisorToken}` },
      payload: {
        decision: 'APPROVE',
        justification: 'Independent supervisory review confirms lawful case scope.',
      },
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json()).toMatchObject({
      requestId,
      caseId: fixture.caseId,
      status: 'APPROVED',
    });
    expect(decided.json().providerReference).toMatch(/^simulated-provider-ref:/);
    expect(decided.json()).not.toHaveProperty('pii');
  });

  it('rejects missing credentials, wrong-case approval, and self-approval', async () => {
    const fixture = await createFixture({ supervisorSubjectId: 'investigator:identity-a' });
    const unauthenticated = await fixture.app.inject({
      method: 'POST',
      url: `/api/v1/cases/${fixture.caseId}/identity-resolution`,
      payload: { justification: 'Provider identity is required for the authorised investigation.' },
    });
    expect(unauthenticated.statusCode).toBe(401);

    const requested = await fixture.app.inject({
      method: 'POST',
      url: `/api/v1/cases/${fixture.caseId}/identity-resolution`,
      headers: { authorization: `Bearer ${fixture.investigatorToken}` },
      payload: { justification: 'Provider identity is required for the authorised investigation.' },
    });
    const requestId = requested.json().requestId as string;

    const wrongCase = await fixture.app.inject({
      method: 'POST',
      url: `/api/v1/cases/case:other/identity-resolution/${requestId}/decision`,
      headers: { authorization: `Bearer ${fixture.supervisorToken}` },
      payload: {
        decision: 'APPROVE',
        justification: 'This should not cross the verified case scope.',
      },
    });
    expect(wrongCase.statusCode).toBe(403);

    const selfApproval = await fixture.app.inject({
      method: 'POST',
      url: `/api/v1/cases/${fixture.caseId}/identity-resolution/${requestId}/decision`,
      headers: { authorization: `Bearer ${fixture.supervisorToken}` },
      payload: {
        decision: 'APPROVE',
        justification: 'The same person must not approve their own request.',
      },
    });
    expect(selfApproval.statusCode).toBe(403);
    expect(selfApproval.json().error).toBe('TWO_PERSON_RULE_REQUIRED');
  });
});

async function createFixture(options: { supervisorSubjectId?: string } = {}) {
  const issuer = keyPair();
  const investigator = keyPair();
  const supervisor = keyPair();
  const repository = new InMemoryTrustRepository();
  await repository.registerIssuer('issuer:identity-bank', issuer.publicKeyPem, true);
  const trustAccessService = new TrustAccessService(repository, {}, () => new Date(now));
  const app = buildApp({ trustAccessService, enforceTrustAccess: false });
  apps.push(app);

  const complaint = await app.inject({
    method: 'POST',
    url: '/api/v1/complaints',
    headers: { 'idempotency-key': 'identity-resolution-complaint-v1' },
    payload: {
      complaintId: 'complaint:identity-resolution',
      originalTransactionRef: 'txn:identity-resolution',
      reportedAmount: { amountMinor: 75_000, currency: 'INR' },
      transactionOccurredAt: '2026-08-25T08:00:00.000Z',
      reportedAt: '2026-08-25T08:15:00.000Z',
      category: 'IMPERSONATION',
      source: 'VICTIM',
      evidenceReferences: [],
    },
  });
  const caseId = complaint.json().case.summary.caseId as string;

  const investigatorToken = await verifiedToken(
    trustAccessService,
    issuer.privateKey,
    investigator,
    claims({
      subjectId: 'investigator:identity-a',
      role: 'INVESTIGATOR',
      capability: 'IDENTITY_RESOLUTION_REQUEST',
      purpose: 'FRAUD_INVESTIGATION',
      caseId,
    }),
  );
  const supervisorToken = await verifiedToken(
    trustAccessService,
    issuer.privateKey,
    supervisor,
    claims({
      subjectId: options.supervisorSubjectId ?? 'supervisor:identity-b',
      role: 'SUPERVISOR',
      capability: 'IDENTITY_RESOLUTION_APPROVE',
      purpose: 'LAW_ENFORCEMENT_REQUEST',
      caseId,
    }),
  );
  return { app, caseId, investigatorToken, supervisorToken };
}

function claims(input: {
  subjectId: string;
  role: CredentialRole;
  capability: TrustCapability;
  purpose: TrustPurpose;
  caseId: string;
}): CredentialClaims {
  return {
    credentialId: `credential:${input.subjectId}:${input.capability}`,
    issuerId: 'issuer:identity-bank',
    subjectId: input.subjectId,
    role: input.role,
    capabilities: [input.capability],
    allowedPurposes: [input.purpose],
    caseIds: [input.caseId],
    subjectPublicKeyPem: '',
    issuedAt: '2026-08-25T08:00:00.000Z',
    expiresAt: '2026-08-25T10:00:00.000Z',
  };
}

async function verifiedToken(
  service: TrustAccessService,
  issuerPrivateKey: KeyObject,
  subject: ReturnType<typeof keyPair>,
  rawClaims: CredentialClaims,
): Promise<string> {
  const credentialClaims = { ...rawClaims, subjectPublicKeyPem: subject.publicKeyPem };
  const challenge = await service.createChallenge({
    subjectId: credentialClaims.subjectId,
    capability: credentialClaims.capabilities[0]!,
    purpose: credentialClaims.allowedPurposes[0]!,
    caseId: credentialClaims.caseIds[0],
  });
  const credential: SignedCredential = {
    claims: credentialClaims,
    issuerSignature: signature(issuerPrivateKey, credentialSigningPayload(credentialClaims)),
  };
  return (
    await service.verify({
      challengeId: challenge.challengeId,
      credential,
      proofSignature: signature(
        subject.privateKey,
        challengeProofPayload(challenge, credentialClaims),
      ),
    })
  ).accessToken;
}

function keyPair() {
  const pair = generateKeyPairSync('ed25519');
  return {
    privateKey: pair.privateKey,
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function signature(privateKey: KeyObject, payload: string): string {
  return sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64');
}
