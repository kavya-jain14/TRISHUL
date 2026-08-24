import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { DevelopmentHashchainProvider } from '@trishul/audit';
import type {
  CredentialClaims,
  CredentialRole,
  SignedCredential,
  TrustCapability,
} from '@trishul/contracts';
import { InMemoryCaseActionRepository } from '@trishul/database';
import {
  challengeProofPayload,
  credentialSigningPayload,
  InMemoryTrustRepository,
  TrustAccessService,
} from '@trishul/trust';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { CaseActionService } from '../src/modules/case-actions/service.js';
import { InMemoryCaseRepository } from '../src/modules/cases/case-repository.js';
import { CaseService } from '../src/modules/cases/case-service.js';
import { InMemoryEvidenceAnchorRepository } from '../src/modules/evidence-anchors/anchor-repository.js';
import { EvidenceAnchorService } from '../src/modules/evidence-anchors/anchor-service.js';

const apps: ReturnType<typeof buildApp>[] = [];
const now = new Date('2026-08-24T09:15:00.000Z');

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const complaint = {
  complaintId: 'complaint-action-a',
  originalTransactionRef: 'RRN-ACTION-1',
  reportedAmount: { amountMinor: 125_000, currency: 'INR' },
  transactionOccurredAt: '2026-08-24T09:00:00.000Z',
  reportedAt: '2026-08-24T09:05:00.000Z',
  category: 'IMPERSONATION',
  source: 'BANK',
  evidenceReferences: ['evidence-action-a'],
};

const actionBase = {
  actionId: 'action-bank-a',
  action: 'ALERT_BANK',
  rationale: 'Authorised trace evidence requires provider review.',
  sourceUrls: ['https://example.test/evidence/action-a'],
  occurredAt: '2026-08-24T09:10:00.000Z',
};

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

async function fixture() {
  const issuer = keyPair();
  const repository = new InMemoryTrustRepository();
  const trust = new TrustAccessService(repository, {}, () => new Date(now));
  await trust.registerIssuer('issuer:case-actions', issuer.publicKeyPem);
  const caseService = new CaseService(new InMemoryCaseRepository());
  const evidence = new EvidenceAnchorService(
    new InMemoryEvidenceAnchorRepository(),
    new DevelopmentHashchainProvider(),
    (caseId) => caseService.getCase(caseId),
    () => now.toISOString(),
  );
  const actions = new CaseActionService(
    new InMemoryCaseActionRepository(),
    (caseId) => caseService.getCase(caseId),
    (anchorId) => evidence.get(anchorId),
    () => now.toISOString(),
  );
  const app = buildApp({
    caseService,
    evidenceAnchorService: evidence,
    caseActionService: actions,
    trustAccessService: trust,
  });
  apps.push(app);
  await app.inject({
    method: 'POST',
    url: '/api/v1/complaints',
    headers: { 'idempotency-key': 'create-action-case' },
    payload: complaint,
  });
  const anchor = await evidence.anchor(
    'case:complaint-action-a',
    { evidenceRef: 'action-evidence-a', evidence: { eventId: 'provider-event-a' } },
    'anchor-action-evidence-a',
  );
  const validAction = { ...actionBase, evidenceAnchorIds: [anchor.receipt.anchorId] };
  return { app, issuer, trust, evidence, validAction };
}

async function accessToken(
  trust: TrustAccessService,
  issuerPrivateKey: KeyObject,
  input: {
    role?: CredentialRole;
    capability?: TrustCapability;
    caseId?: string;
    subjectId?: string;
  } = {},
): Promise<string> {
  const subject = keyPair();
  const role = input.role ?? 'INVESTIGATOR';
  const capability = input.capability ?? 'CASE_WRITE';
  const caseId = input.caseId ?? 'case:complaint-action-a';
  const subjectId = input.subjectId ?? `investigator:${role.toLowerCase()}`;
  const challenge = await trust.createChallenge({
    subjectId,
    capability,
    purpose: 'FRAUD_INVESTIGATION',
    caseId,
  });
  const claims: CredentialClaims = {
    credentialId: `credential:${subjectId}:${capability.toLowerCase()}:${caseId}`,
    issuerId: 'issuer:case-actions',
    subjectId,
    role,
    capabilities: [capability],
    allowedPurposes: ['FRAUD_INVESTIGATION'],
    caseIds: [caseId],
    subjectPublicKeyPem: subject.publicKeyPem,
    issuedAt: '2026-08-24T08:00:00.000Z',
    expiresAt: '2026-08-24T11:00:00.000Z',
  };
  const credential: SignedCredential = {
    claims,
    issuerSignature: signature(issuerPrivateKey, credentialSigningPayload(claims)),
  };
  return (
    await trust.verify({
      challengeId: challenge.challengeId,
      credential,
      proofSignature: signature(subject.privateKey, challengeProofPayload(challenge, claims)),
    })
  ).accessToken;
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}`, 'idempotency-key': 'record-action-a' };
}

describe('secure case action persistence API', () => {
  it('derives actor and purpose from a verified session, then replays immutably', async () => {
    const { app, issuer, trust, validAction } = await fixture();
    const writeToken = await accessToken(trust, issuer.privateKey, {
      subjectId: 'investigator:fuzail',
    });
    const readToken = await accessToken(trust, issuer.privateKey, {
      subjectId: 'investigator:fuzail',
      capability: 'CASE_READ',
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/cases/case:complaint-action-a/actions',
      headers: bearer(writeToken),
      payload: validAction,
    });
    const replayed = await app.inject({
      method: 'POST',
      url: '/api/v1/cases/case:complaint-action-a/actions',
      headers: bearer(writeToken),
      payload: validAction,
    });
    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/cases/case:complaint-action-a/actions',
      headers: { authorization: `Bearer ${readToken}` },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      action: {
        ...validAction,
        caseId: 'case:complaint-action-a',
        actorRef: 'investigator:fuzail',
        actorRole: 'INVESTIGATOR',
        purpose: 'FRAUD_INVESTIGATION',
      },
      replayed: false,
    });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json()).toEqual({ ...created.json(), replayed: true });
    expect(listed.json().actions).toEqual([created.json().action]);
  });

  it('rejects missing/forged sessions, wrong cases, and insufficient capability', async () => {
    const { app, issuer, trust, validAction } = await fixture();
    const wrongCase = await accessToken(trust, issuer.privateKey, { caseId: 'case:other' });
    const readOnly = await accessToken(trust, issuer.privateKey, { capability: 'CASE_READ' });
    const request = (token?: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/cases/case:complaint-action-a/actions',
        headers: token ? bearer(token) : { 'idempotency-key': 'record-action-a' },
        payload: validAction,
      });

    expect((await request()).statusCode).toBe(401);
    expect((await request('x'.repeat(32))).statusCode).toBe(401);
    expect((await request(wrongCase)).statusCode).toBe(403);
    expect((await request(readOnly)).statusCode).toBe(403);
  });

  it('enforces action-specific roles and keeps outcomes non-authoritative', async () => {
    const { app, issuer, trust, validAction } = await fixture();
    const investigator = await accessToken(trust, issuer.privateKey);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/cases/case:complaint-action-a/actions',
      headers: bearer(investigator),
      payload: { ...validAction, action: 'ALERT_LEA' },
    });
    const oldOutcome = await app.inject({
      method: 'POST',
      url: '/api/v1/cases/case:complaint-action-a/actions',
      headers: bearer(investigator),
      payload: { ...validAction, action: 'MARK_OUTCOME' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('CASE_ACTION_ROLE_DENIED');
    expect(oldOutcome.statusCode).toBe(400);
  });

  it('rejects client identity assertions and unverified or cross-case evidence', async () => {
    const { app, issuer, trust, evidence, validAction } = await fixture();
    const token = await accessToken(trust, issuer.privateKey);
    const assertedIdentity = await app.inject({
      method: 'POST',
      url: '/api/v1/cases/case:complaint-action-a/actions',
      headers: bearer(token),
      payload: { ...validAction, actorRef: 'attacker', purpose: 'arbitrary-purpose' },
    });
    const missingAnchor = await app.inject({
      method: 'POST',
      url: '/api/v1/cases/case:complaint-action-a/actions',
      headers: { ...bearer(token), 'idempotency-key': 'missing-anchor' },
      payload: {
        ...validAction,
        actionId: 'action-missing',
        evidenceAnchorIds: ['anchor:missing'],
      },
    });

    await app.inject({
      method: 'POST',
      url: '/api/v1/complaints',
      headers: { 'idempotency-key': 'create-other-case' },
      payload: { ...complaint, complaintId: 'complaint-action-b' },
    });
    const otherAnchor = await evidence.anchor(
      'case:complaint-action-b',
      { evidenceRef: 'other-evidence', evidence: { eventId: 'other-event' } },
      'anchor-other-evidence',
    );
    const crossCase = await app.inject({
      method: 'POST',
      url: '/api/v1/cases/case:complaint-action-a/actions',
      headers: { ...bearer(token), 'idempotency-key': 'cross-case-anchor' },
      payload: {
        ...validAction,
        actionId: 'action-cross-case',
        evidenceAnchorIds: [otherAnchor.receipt.anchorId],
      },
    });

    expect(assertedIdentity.statusCode).toBe(400);
    expect(missingAnchor.statusCode).toBe(404);
    expect(crossCase.statusCode).toBe(400);
    expect(crossCase.json().error).toBe('CASE_ACTION_EVIDENCE_SCOPE_MISMATCH');
  });
});
