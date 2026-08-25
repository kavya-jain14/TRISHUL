import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import type {
  CredentialClaims,
  CredentialRole,
  SignedCredential,
  TrustCapability,
} from '@trishul/contracts';
import {
  challengeProofPayload,
  credentialSigningPayload,
  InMemoryTrustRepository,
  TrustAccessService,
} from '@trishul/trust';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const apps: ReturnType<typeof buildApp>[] = [];
const now = new Date('2026-08-25T12:00:00.000Z');

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const provenance = (eventId: string) => ({
  sourceType: 'SIMULATOR' as const,
  sourceName: 'TRISHUL Golden Lab',
  sourceEventId: eventId,
  observedAt: '2026-08-25T10:00:00.000Z',
  evidenceState: 'SIMULATED' as const,
});

const strongDimension = (eventId: string) => ({
  sameAccountHistory: 0.92,
  connectedNetworkHistory: 0.9,
  graphConfidence: 0.95,
  historicalSupport: 0.9,
  predictionStability: 0.88,
  provenance: provenance(eventId),
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

async function token(
  trust: TrustAccessService,
  issuerPrivateKey: KeyObject,
  input: {
    capability: TrustCapability;
    caseIds: string[];
    caseId?: string;
    role?: CredentialRole;
    subjectId?: string;
  },
): Promise<string> {
  const subject = keyPair();
  const role = input.role ?? 'INVESTIGATOR';
  const subjectId =
    input.subjectId ?? `operator:${role.toLowerCase()}:${input.capability.toLowerCase()}`;
  const challenge = await trust.createChallenge({
    subjectId,
    capability: input.capability,
    purpose: 'FRAUD_INVESTIGATION',
    ...(input.caseId ? { caseId: input.caseId } : {}),
  });
  const claims: CredentialClaims = {
    credentialId: `credential:${subjectId}:${challenge.challengeId}`,
    issuerId: 'issuer:golden-lab',
    subjectId,
    role,
    capabilities: [input.capability],
    allowedPurposes: ['FRAUD_INVESTIGATION'],
    caseIds: input.caseIds,
    subjectPublicKeyPem: subject.publicKeyPem,
    issuedAt: '2026-08-25T11:00:00.000Z',
    expiresAt: '2026-08-25T14:00:00.000Z',
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

async function goldenCase(app: ReturnType<typeof buildApp>, suffix: string, stationary: boolean) {
  const caseId = `case:golden-${suffix}`;
  const root = `acct:${suffix}:a`;
  const watch = `acct:${suffix}:b`;
  const branch = `acct:${suffix}:c`;
  const suspected = `acct:${suffix}:d`;
  const occurredAt = '2026-08-25T09:00:00.000Z';
  const complaint = await app.inject({
    method: 'POST',
    url: '/api/v1/complaints',
    headers: { 'idempotency-key': `golden:${suffix}:complaint` },
    payload: {
      complaintId: `golden-${suffix}`,
      originalTransactionRef: `txn:${suffix}:original`,
      reportedAmount: { amountMinor: 5_000_000, currency: 'INR' },
      transactionOccurredAt: occurredAt,
      reportedAt: '2026-08-25T09:15:00.000Z',
      category: 'IMPERSONATION',
      source: 'VICTIM',
      evidenceReferences: [],
    },
  });
  expect(complaint.statusCode).toBe(201);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/v1/cases/${caseId}/resolve-transaction`,
        headers: { 'idempotency-key': `golden:${suffix}:resolve` },
        payload: {
          eventId: `event:${suffix}:resolve`,
          caseId,
          type: 'RESOLVE_TRANSACTION',
          occurredAt: '2026-08-25T09:15:00.000Z',
          provenance: provenance(`event:${suffix}:resolve`),
          originalRef: `txn:${suffix}:original`,
          beneficiaryAccount: root,
          provider: 'TRISHUL Demo Bank',
        },
      })
    ).statusCode,
  ).toBe(200);

  const events = [
    {
      eventId: `event:${suffix}:payment`,
      caseId,
      type: 'TRANSFER',
      occurredAt,
      provenance: provenance(`event:${suffix}:payment`),
      transactionId: `txn:${suffix}:original`,
      providerRef: `provider:${suffix}:payment`,
      fromAccount: `acct:${suffix}:victim`,
      toAccount: root,
      amount: { amountMinor: 5_000_000, currency: 'INR' },
    },
    ...(stationary
      ? []
      : [
          {
            eventId: `event:${suffix}:a-b`,
            caseId,
            type: 'TRANSFER',
            occurredAt: '2026-08-25T09:05:00.000Z',
            provenance: provenance(`event:${suffix}:a-b`),
            transactionId: `txn:${suffix}:a-b`,
            providerRef: `provider:${suffix}:a-b`,
            fromAccount: root,
            toAccount: watch,
            amount: { amountMinor: 3_500_000, currency: 'INR' },
          },
          {
            eventId: `event:${suffix}:a-c`,
            caseId,
            type: 'TRANSFER',
            occurredAt: '2026-08-25T09:06:00.000Z',
            provenance: provenance(`event:${suffix}:a-c`),
            transactionId: `txn:${suffix}:a-c`,
            providerRef: `provider:${suffix}:a-c`,
            fromAccount: root,
            toAccount: branch,
            amount: { amountMinor: 1_500_000, currency: 'INR' },
          },
          {
            eventId: `event:${suffix}:b-d`,
            caseId,
            type: 'TRANSFER',
            occurredAt: '2026-08-25T09:10:00.000Z',
            provenance: provenance(`event:${suffix}:b-d`),
            transactionId: `txn:${suffix}:b-d`,
            providerRef: `provider:${suffix}:b-d`,
            fromAccount: watch,
            toAccount: suspected,
            amount: { amountMinor: 3_000_000, currency: 'INR' },
          },
        ]),
  ];
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/v1/cases/${caseId}/provider-events`,
        headers: { 'idempotency-key': `golden:${suffix}:events` },
        payload: { events },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/v1/cases/${caseId}/trace`,
        headers: { 'idempotency-key': `golden:${suffix}:trace` },
      })
    ).statusCode,
  ).toBe(200);

  const accounts = stationary ? [root] : [root, watch, branch, suspected];
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/v1/cases/${caseId}/recompute-exposure`,
        headers: { 'idempotency-key': `golden:${suffix}:exposure` },
        payload: {
          accountBalances: accounts.map((accountId) => ({
            accountId,
            knownCleanBalanceMinor: 0,
            provenance: provenance(`balance:${suffix}:${accountId}`),
          })),
        },
      })
    ).statusCode,
  ).toBe(200);

  const target = stationary ? root : suspected;
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/v1/accounts/${target}/risk`,
        headers: { 'idempotency-key': `golden:${suffix}:risk` },
        payload: {
          caseId,
          providerSignals: {
            inflowSpike: stationary ? 0.1 : 0.95,
            uniqueSenderSpike: stationary ? 0.1 : 0.85,
            firstTimeSenderRatio: stationary ? 0.1 : 0.9,
            behaviourShift: stationary ? 0.1 : 0.9,
            crossCaseLinkage: stationary ? 0 : 0.9,
            authorisedSharedIdentifierStrength: 0,
            provenance: provenance(`risk:${suffix}`),
          },
          trustedOutcome: { status: 'NONE' },
        },
      })
    ).statusCode,
  ).toBe(200);

  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/v1/cases/${caseId}/exit-mode`,
        headers: { 'idempotency-key': `golden:${suffix}:exit` },
        payload: {
          accountId: target,
          providerSignals: stationary
            ? {
                recentIncomingVelocity: 0.1,
                recentOutgoingVelocity: 0,
                historicalStationary: 0.9,
                historicalForward: 0.05,
                historicalCashOut: 0.05,
                cashOutTendency: 0,
                evidenceStrength: 0.8,
                provenance: provenance(`exit:${suffix}`),
              }
            : {
                recentIncomingVelocity: 0.9,
                recentOutgoingVelocity: 0.95,
                historicalStationary: 0.02,
                historicalForward: 0.03,
                historicalCashOut: 0.95,
                cashOutTendency: 1,
                evidenceStrength: 1,
                provenance: provenance(`exit:${suffix}`),
              },
        },
      })
    ).statusCode,
  ).toBe(200);

  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/v1/cases/${caseId}/forecast`,
        headers: { 'idempotency-key': `golden:${suffix}:gate` },
        payload: {
          accountId: target,
          geo: strongDimension(`gate:${suffix}:geo`),
          time: strongDimension(`gate:${suffix}:time`),
        },
      })
    ).statusCode,
  ).toBe(200);

  const zones = [
    ['zone:noida', 'Noida', 0.98],
    ['zone:ghaziabad', 'Ghaziabad', 0.8],
    ['zone:delhi', 'Delhi', 0.7],
  ];
  const timeScores = [
    ['UNDER_30_MIN', 0.3],
    ['30_TO_60_MIN', 0.5],
    ['1_TO_2_HOURS', 0.95],
    ['2_TO_6_HOURS', 0.6],
    ['6_TO_24_HOURS', 0.2],
  ];
  const prediction = await app.inject({
    method: 'POST',
    url: `/api/v1/cases/${caseId}/predictions`,
    headers: { 'idempotency-key': `golden:${suffix}:prediction` },
    payload: {
      accountId: target,
      geoCandidates: stationary
        ? []
        : zones.map(([zoneId, label, score]) => ({
            zoneId,
            label,
            features: {
              accountHistory: score,
              networkHistory: score,
              recency: score,
              timeSimilarity: score,
              amountSimilarity: score,
            },
            provenance: provenance(`forecast:${suffix}:${zoneId}`),
          })),
      timeHorizons: stationary
        ? []
        : timeScores.map(([bucket, score]) => ({
            bucket,
            features: {
              sameAccountDelayHistory: score,
              networkDelayHistory: score,
              amountSimilarity: score,
              velocityAlignment: score,
              temporalPattern: score,
              hopDepthSupport: score,
              similarCaseTiming: score,
            },
            provenance: provenance(`forecast:${suffix}:${bucket}`),
          })),
    },
  });
  expect(prediction.statusCode).toBe(200);
  return { caseId };
}

describe('blueprint Command Center backend', () => {
  it('runs intervention and abstention scenarios with secure alert lifecycle and scoped dashboard', async () => {
    const issuer = keyPair();
    const trustRepository = new InMemoryTrustRepository();
    const trust = new TrustAccessService(trustRepository, {}, () => new Date(now));
    await trust.registerIssuer('issuer:golden-lab', issuer.publicKeyPem);
    const app = buildApp({ trustAccessService: trust });
    apps.push(app);

    const active = await goldenCase(app, 'intervention', false);
    const monitoring = await goldenCase(app, 'monitoring', true);
    const caseIds = [active.caseId, monitoring.caseId];
    const activeWrite = await token(trust, issuer.privateKey, {
      capability: 'CASE_WRITE',
      caseIds: [active.caseId],
      caseId: active.caseId,
      subjectId: 'investigator:golden',
    });
    const activeRead = await token(trust, issuer.privateKey, {
      capability: 'CASE_READ',
      caseIds: [active.caseId],
      caseId: active.caseId,
      subjectId: 'investigator:golden',
    });
    const monitoringWrite = await token(trust, issuer.privateKey, {
      capability: 'CASE_WRITE',
      caseIds: [monitoring.caseId],
      caseId: monitoring.caseId,
      subjectId: 'investigator:golden',
    });

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${active.caseId}/priority`,
      headers: {
        authorization: `Bearer ${activeWrite}`,
        'idempotency-key': 'priority:golden:active',
      },
    });
    const replay = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${active.caseId}/priority`,
      headers: {
        authorization: `Bearer ${activeWrite}`,
        'idempotency-key': 'priority:golden:active',
      },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().snapshot).toMatchObject({
      operationalState: 'ACTIVE_INTERVENTION_WINDOW',
      priorityBand: expect.stringMatching(/HIGH|CRITICAL/),
      features: { highestRiskTimeBucket: '1_TO_2_HOURS' },
    });
    expect(first.json().alert).toMatchObject({ status: 'OPEN', kind: 'INTERVENTION' });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ ...first.json(), replayed: true });

    const monitored = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${monitoring.caseId}/priority`,
      headers: {
        authorization: `Bearer ${monitoringWrite}`,
        'idempotency-key': 'priority:golden:monitoring',
      },
    });
    expect(monitored.statusCode).toBe(201);
    expect(monitored.json()).toMatchObject({
      snapshot: {
        operationalState: 'MONITORING',
        features: { evidenceGateDecision: 'ABSTAIN' },
      },
      alert: null,
    });

    const alerts = await app.inject({
      method: 'GET',
      url: `/api/v1/cases/${active.caseId}/alerts`,
      headers: { authorization: `Bearer ${activeRead}` },
    });
    expect(alerts.statusCode).toBe(200);
    const alertId = alerts.json().alerts[0].alertId as string;
    const acknowledged = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${active.caseId}/alerts/${alertId}/acknowledge`,
      headers: {
        authorization: `Bearer ${activeWrite}`,
        'idempotency-key': 'alert:golden:ack',
      },
      payload: { rationale: 'Evidence reviewed; provider escalation is being coordinated.' },
    });
    expect(acknowledged.json().alert.status).toBe('ACKNOWLEDGED');

    const deniedResolution = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${active.caseId}/alerts/${alertId}/resolve`,
      headers: {
        authorization: `Bearer ${activeWrite}`,
        'idempotency-key': 'alert:golden:resolve:denied',
      },
      payload: { rationale: 'Investigator must not be able to close this operational alert.' },
    });
    expect(deniedResolution.statusCode).toBe(403);

    const supervisor = await token(trust, issuer.privateKey, {
      capability: 'CASE_WRITE',
      caseIds: [active.caseId],
      caseId: active.caseId,
      role: 'SUPERVISOR',
      subjectId: 'supervisor:golden',
    });
    const resolved = await app.inject({
      method: 'POST',
      url: `/api/v1/cases/${active.caseId}/alerts/${alertId}/resolve`,
      headers: {
        authorization: `Bearer ${supervisor}`,
        'idempotency-key': 'alert:golden:resolve',
      },
      payload: {
        rationale: 'Supervisor verified the response and recorded the operational outcome.',
      },
    });
    expect(resolved.json().alert).toMatchObject({
      status: 'RESOLVED',
      resolvedBy: 'supervisor:golden',
    });

    const dashboardToken = await token(trust, issuer.privateKey, {
      capability: 'COMMAND_CENTER_READ',
      caseIds,
      subjectId: 'investigator:command-center',
    });
    const dashboard = await app.inject({
      method: 'GET',
      url: '/api/v1/command-center',
      headers: { authorization: `Bearer ${dashboardToken}` },
    });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().commandCenter).toMatchObject({
      scopeCaseIds: caseIds.sort(),
      counts: {
        totalCases: 2,
        activeInterventionWindows: 1,
        openAlerts: 0,
        abstainingCases: 1,
      },
    });
    expect(dashboard.json().commandCenter.cases[0].summary.caseId).toBe(active.caseId);
  });
});
