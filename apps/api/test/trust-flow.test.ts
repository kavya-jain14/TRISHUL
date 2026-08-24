import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import type { CredentialClaims, SignedCredential, TrustChallenge } from '@trishul/contracts';
import {
  challengeProofPayload,
  credentialSigningPayload,
  InMemoryTrustRepository,
  TrustAccessService,
} from '@trishul/trust';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

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

function signedCredential(claims: CredentialClaims, issuerPrivateKey: KeyObject): SignedCredential {
  return {
    claims,
    issuerSignature: signature(issuerPrivateKey, credentialSigningPayload(claims)),
  };
}

describe('canonical Trust/Access HTTP flow', () => {
  it('protects the case surface with a signed, subject-bound, case-scoped session', async () => {
    const issuer = keyPair();
    const subject = keyPair();
    const registry = new InMemoryTrustRepository();
    registry.registerIssuer('issuer:bank-a', issuer.publicKeyPem, true);
    const trustAccessService = new TrustAccessService(
      registry,
      undefined,
      {},
      () => new Date('2026-08-24T12:00:00.000Z'),
    );
    const app = buildApp({ trustAccessService, enforceTrustAccess: true });
    apps.push(app);

    const complaint = await app.inject({
      method: 'POST',
      url: '/api/v1/complaints',
      headers: { 'idempotency-key': 'trust-flow-complaint-v1' },
      payload: {
        complaintId: 'complaint:trust-flow',
        originalTransactionRef: 'txn:trust-flow',
        reportedAmount: { amountMinor: 125_000, currency: 'INR' },
        transactionOccurredAt: '2026-08-24T11:30:00.000Z',
        reportedAt: '2026-08-24T11:45:00.000Z',
        category: 'IMPERSONATION',
        source: 'VICTIM',
        evidenceReferences: [],
      },
    });
    expect(complaint.statusCode).toBe(201);
    const caseId = complaint.json().case.summary.caseId as string;

    const unauthenticated = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${encodeURIComponent(caseId)}`,
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json()).toMatchObject({ error: 'TRUST_SESSION_REQUIRED' });

    const challengeResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/trust/challenges',
      payload: {
        subjectId: 'investigator:a',
        capability: 'CASE_READ',
        purpose: 'FRAUD_INVESTIGATION',
        caseId,
      },
    });
    expect(challengeResponse.statusCode).toBe(201);
    const challenge = challengeResponse.json().challenge as TrustChallenge;
    const claims: CredentialClaims = {
      credentialId: 'credential:investigator-a',
      issuerId: 'issuer:bank-a',
      subjectId: 'investigator:a',
      role: 'INVESTIGATOR',
      capabilities: ['CASE_READ', 'CASE_WRITE'],
      allowedPurposes: ['FRAUD_INVESTIGATION'],
      caseIds: [caseId],
      subjectPublicKeyPem: subject.publicKeyPem,
      issuedAt: '2026-08-24T11:00:00.000Z',
      expiresAt: '2026-08-24T14:00:00.000Z',
    };
    const credential = signedCredential(claims, issuer.privateKey);
    const verification = await app.inject({
      method: 'POST',
      url: '/api/v1/trust/verify',
      payload: {
        challengeId: challenge.challengeId,
        credential,
        proofSignature: signature(subject.privateKey, challengeProofPayload(challenge, claims)),
      },
    });
    expect(verification.statusCode).toBe(200);
    const accessToken = verification.json().accessToken as string;

    const authorised = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${encodeURIComponent(caseId)}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(authorised.statusCode).toBe(200);
    expect(authorised.json().case.summary.caseId).toBe(caseId);

    const wrongCase = await app.inject({
      method: 'GET',
      url: '/api/v1/cases/case%3Aother',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(wrongCase.statusCode).toBe(403);
    expect(wrongCase.json()).toMatchObject({ error: 'TRUST_CASE_SCOPE_DENIED' });

    const privilegeEscalation = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${encodeURIComponent(caseId)}/trace`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'idempotency-key': 'unauthorised-write-v1',
      },
      payload: {},
    });
    expect(privilegeEscalation.statusCode).toBe(403);
    expect(privilegeEscalation.json()).toMatchObject({ error: 'TRUST_CAPABILITY_DENIED' });
  });
});
