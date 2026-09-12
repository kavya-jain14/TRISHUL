import {
  CaseDetailSchema,
  CaseRiskSnapshotsSchema,
  EvidenceGateSnapshotSchema,
  ExitModeSnapshotSchema,
  ExposureSnapshotSchema,
  ForecastSnapshotSchema,
  GraphSnapshotSchema,
  PaymentRiskRunResultSchema,
  type ExposureSnapshot,
  ProviderEventSchema,
  type CaseDetail,
  type EvidenceGateSnapshot,
  type ExitModeSnapshot,
  type ForecastSnapshot,
  type GraphSnapshot,
  type MuleAssessmentSnapshot,
  type PaymentRiskAssessment,
  type ProviderEvent,
} from '@trishul/contracts';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface CaseResponse {
  case: CaseDetail;
}

interface GraphResponse {
  graph: GraphSnapshot;
}

interface ExposureResponse {
  exposure: ExposureSnapshot;
}

interface ExitModeResponse {
  exitMode: ExitModeSnapshot;
}

interface EvidenceGateResponse {
  evidenceGate: EvidenceGateSnapshot;
}

interface ForecastResponse {
  forecast: ForecastSnapshot;
}

interface SandboxStep {
  scenarioId: string;
  cursor: number;
  totalEvents: number;
  done: boolean;
  event: ProviderEvent | null;
}

interface RequestOptions extends RequestInit {
  idempotencyKey?: string;
}

async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('content-type', 'application/json');
  if (options.idempotencyKey) headers.set('idempotency-key', options.idempotencyKey);

  const response = await fetch(url, { ...options, headers });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof payload.error === 'string' ? payload.error : 'REQUEST_FAILED',
      typeof payload.message === 'string' ? payload.message : 'The request failed.',
    );
  }
  return payload as T;
}

export interface CaseIntelligenceResult {
  caseDetail: CaseDetail;
  graph: GraphSnapshot | null;
  graphPending: boolean;
  exposure: ExposureSnapshot | null;
  exposurePending: boolean;
  riskAssessments: MuleAssessmentSnapshot[];
}

export interface PredictionReadinessResult {
  caseDetail: CaseDetail;
  exitMode: ExitModeSnapshot | null;
  exitModePending: boolean;
  evidenceGate: EvidenceGateSnapshot | null;
  evidenceGatePending: boolean;
  forecast: ForecastSnapshot | null;
  forecastPending: boolean;
}

export async function evaluateDemoPaymentRisk(
  input: { amountRupees: number; receiverReference: string },
  apiBase = '/api/v1',
): Promise<PaymentRiskAssessment> {
  const timestamp = new Date().toISOString();
  const paymentReference = `payment:ui:${Date.now()}`;
  const amountMinor = Math.max(100, Math.round(input.amountRupees * 100));
  const provenance = {
    sourceType: 'SIMULATOR' as const,
    sourceName: 'TRISHUL Provider Simulator',
    sourceEventId: `signal:${Date.now()}`,
    observedAt: timestamp,
    evidenceState: 'SIMULATED' as const,
  };
  const result = await requestJson(`${apiBase}/risk/evaluate`, {
    method: 'POST',
    idempotencyKey: `risk:${paymentReference}`,
    body: JSON.stringify({
      paymentReference,
      payerReference: 'acct:kavya',
      receiverReference: input.receiverReference,
      amount: { amountMinor, currency: 'INR' },
      occurredAt: timestamp,
      payerSignals: {
        priorSuccessfulPaymentsToReceiver: 0,
        amountBaseline: {
          medianMinor: 100_000,
          medianAbsoluteDeviationMinor: 25_000,
          sampleSize: 20,
        },
        transactionsLast10Minutes: 2,
        baselineTransactionsPer10Minutes: 1,
        usualActiveHoursUtc: { startHourUtc: 3, endHourUtc: 18 },
        deviceStatus: 'KNOWN_TRUSTED',
        provenance,
      },
      receiverSignals: {
        trustStatus: 'VERIFIED',
        inflowSpike: 0.68,
        uniqueSenderSpike: 0.61,
        passThroughRisk: 0.72,
        behaviourShift: 0.66,
        provenance,
      },
      networkSignals: {
        reportedNetworkProximity: 0.42,
        crossCaseLinkage: 0.58,
        trustedExternalIntelligence: 0.2,
        provenance,
      },
      stepUp: { status: 'NOT_PERFORMED' },
    }),
  });
  return PaymentRiskRunResultSchema.parse(result).assessment;
}

export async function loadCaseIntelligence(
  caseId: string,
  apiBase = '/api/v1',
): Promise<CaseIntelligenceResult> {
  const caseResponse = await requestJson<CaseResponse>(
    `${apiBase}/cases/${encodeURIComponent(caseId)}`,
  );
  const caseDetail = CaseDetailSchema.parse(caseResponse.case);

  try {
    const graphResponse = await requestJson<GraphResponse>(
      `${apiBase}/cases/${encodeURIComponent(caseId)}/graph`,
    );
    return {
      caseDetail,
      graph: GraphSnapshotSchema.parse(graphResponse.graph),
      graphPending: false,
      ...(await loadExposureAndRisk(caseId, apiBase)),
    };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'GRAPH_NOT_AVAILABLE') {
      return {
        caseDetail,
        graph: null,
        graphPending: true,
        exposure: null,
        exposurePending: true,
        riskAssessments: [],
      };
    }
    throw error;
  }
}

async function loadExposureAndRisk(caseId: string, apiBase: string) {
  let exposure: ExposureSnapshot | null = null;
  let exposurePending = false;
  try {
    const response = await requestJson<ExposureResponse>(
      `${apiBase}/cases/${encodeURIComponent(caseId)}/exposure`,
    );
    exposure = ExposureSnapshotSchema.parse(response.exposure);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'EXPOSURE_NOT_AVAILABLE') {
      exposurePending = true;
    } else {
      throw error;
    }
  }

  const riskResponse = await requestJson(
    `${apiBase}/cases/${encodeURIComponent(caseId)}/risk-snapshots`,
  );
  const risk = CaseRiskSnapshotsSchema.parse(riskResponse);
  return { exposure, exposurePending, riskAssessments: risk.assessments };
}

export async function loadPredictionReadiness(
  caseId: string,
  apiBase = '/api/v1',
): Promise<PredictionReadinessResult> {
  const caseResponse = await requestJson<CaseResponse>(
    `${apiBase}/cases/${encodeURIComponent(caseId)}`,
  );
  const caseDetail = CaseDetailSchema.parse(caseResponse.case);
  let exitMode: ExitModeSnapshot | null = null;
  let exitModePending = false;
  let evidenceGate: EvidenceGateSnapshot | null = null;
  let evidenceGatePending = false;
  let forecast: ForecastSnapshot | null = null;
  let forecastPending = false;

  try {
    const response = await requestJson<ExitModeResponse>(
      `${apiBase}/cases/${encodeURIComponent(caseId)}/exit-mode/latest`,
    );
    exitMode = ExitModeSnapshotSchema.parse(response.exitMode);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'EXIT_MODE_NOT_AVAILABLE') {
      exitModePending = true;
    } else {
      throw error;
    }
  }

  try {
    const response = await requestJson<EvidenceGateResponse>(
      `${apiBase}/cases/${encodeURIComponent(caseId)}/forecast/latest`,
    );
    evidenceGate = EvidenceGateSnapshotSchema.parse(response.evidenceGate);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'EVIDENCE_GATE_NOT_AVAILABLE') {
      evidenceGatePending = true;
    } else {
      throw error;
    }
  }

  try {
    const response = await requestJson<ForecastResponse>(
      `${apiBase}/cases/${encodeURIComponent(caseId)}/predictions/latest`,
    );
    forecast = ForecastSnapshotSchema.parse(response.forecast);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'FORECAST_NOT_AVAILABLE') {
      forecastPending = true;
    } else {
      throw error;
    }
  }

  return {
    caseDetail,
    exitMode,
    exitModePending,
    evidenceGate,
    evidenceGatePending,
    forecast,
    forecastPending,
  };
}

const goldenComplaint = {
  complaintId: 'complaint-golden-a',
  originalTransactionRef: 'T1001',
  reportedAmount: { amountMinor: 5_000_000, currency: 'INR' },
  transactionOccurredAt: '2026-08-24T10:00:00.000Z',
  reportedAt: '2026-08-24T10:15:00.000Z',
  payerReference: 'acct-kavya',
  beneficiaryReference: 'vpa-receiver-a',
  category: 'IMPERSONATION',
  source: 'VICTIM',
  evidenceReferences: ['evidence-screen-1'],
} as const;

const stationaryComplaint = {
  complaintId: 'complaint-golden-b',
  originalTransactionRef: 'T2001',
  reportedAmount: { amountMinor: 1_800_000, currency: 'INR' },
  transactionOccurredAt: '2026-08-24T11:00:00.000Z',
  reportedAt: '2026-08-24T11:15:00.000Z',
  payerReference: 'acct-victim-b',
  beneficiaryReference: 'acct-x',
  category: 'IMPERSONATION',
  source: 'VICTIM',
  evidenceReferences: ['evidence-statement-b'],
} as const;

const simulatorProvenance = (sourceEventId: string, observedAt: string) => ({
  sourceType: 'SIMULATOR' as const,
  sourceName: 'TRISHUL PSP Sandbox',
  sourceEventId,
  observedAt,
  evidenceState: 'SIMULATED' as const,
});

async function consumeScenario(
  scenarioId: string,
  caseId: string,
  onProgress: (message: string) => void,
  apiBase: string,
  sandboxBase: string,
  stopAfterEventId?: string,
) {
  let done = false;
  while (!done) {
    const step = await requestJson<SandboxStep>(`${sandboxBase}/scenarios/${scenarioId}/next`, {
      method: 'POST',
    });
    done = step.done;
    if (!step.event) continue;

    const event = ProviderEventSchema.parse(step.event);
    onProgress(`Accepting provider event ${event.eventId}`);
    if (event.type === 'RESOLVE_TRANSACTION') {
      await requestJson(`${apiBase}/cases/${encodeURIComponent(caseId)}/resolve-transaction`, {
        method: 'POST',
        idempotencyKey: `demo:resolve:${event.eventId}`,
        body: JSON.stringify(event),
      });
    } else {
      await requestJson(`${apiBase}/cases/${encodeURIComponent(caseId)}/provider-events`, {
        method: 'POST',
        idempotencyKey: `demo:event:${event.eventId}`,
        body: JSON.stringify({ events: [event] }),
      });
    }
    if (event.eventId === stopAfterEventId) break;
  }
}

export async function runGoldenTraceDemo(
  onProgress: (message: string) => void,
  apiBase = '/api/v1',
  sandboxBase = '/sandbox',
): Promise<string> {
  const scenarioId = 'full-pipeline-reforecast';
  const caseId = 'case:complaint-golden-a';

  onProgress('Resetting deterministic provider scenario');
  await requestJson(`${sandboxBase}/scenarios/${scenarioId}/reset`, { method: 'POST' });

  onProgress('Creating complaint and active case');
  await requestJson(`${apiBase}/complaints`, {
    method: 'POST',
    idempotencyKey: 'demo:complaint:golden-a',
    body: JSON.stringify(goldenComplaint),
  });

  await consumeScenario(scenarioId, caseId, onProgress, apiBase, sandboxBase, 'evt-a-006-d-to-e');

  onProgress('Running idempotent TRACE graph expansion');
  await requestJson(`${apiBase}/cases/${encodeURIComponent(caseId)}/trace`, {
    method: 'POST',
    idempotencyKey: 'demo:trace:golden-a:v1',
  });

  const balanceProvenance = (accountId: string) => ({
    sourceType: 'SIMULATOR' as const,
    sourceName: 'TRISHUL PSP Sandbox',
    sourceEventId: `balance-${accountId}-v1`,
    observedAt: '2026-08-24T11:31:00.000Z',
    evidenceState: 'SIMULATED' as const,
  });
  onProgress('Calculating attributable exposure ranges');
  await requestJson(`${apiBase}/cases/${encodeURIComponent(caseId)}/recompute-exposure`, {
    method: 'POST',
    idempotencyKey: 'demo:exposure:golden-a:v1',
    body: JSON.stringify({
      accountBalances: [
        { accountId: 'acct-receiver-a', knownCleanBalanceMinor: 2_000_000 },
        { accountId: 'acct-b', knownCleanBalanceMinor: 0 },
        { accountId: 'acct-c', knownCleanBalanceMinor: 500_000 },
        { accountId: 'acct-d', knownCleanBalanceMinor: 250_000 },
        { accountId: 'acct-e', knownCleanBalanceMinor: 100_000 },
      ].map((balance) => ({ ...balance, provenance: balanceProvenance(balance.accountId) })),
    }),
  });

  onProgress('Assessing explainable behaviour and network risk');
  await requestJson(`${apiBase}/accounts/acct-receiver-a/risk`, {
    method: 'POST',
    idempotencyKey: 'demo:risk:golden-a:acct-receiver-a:v1',
    body: JSON.stringify({
      caseId,
      providerSignals: {
        inflowSpike: 0.88,
        uniqueSenderSpike: 0.72,
        firstTimeSenderRatio: 0.81,
        behaviourShift: 0.86,
        crossCaseLinkage: 0.78,
        authorisedSharedIdentifierStrength: 0.7,
        provenance: {
          sourceType: 'SIMULATOR',
          sourceName: 'TRISHUL PSP Sandbox',
          sourceEventId: 'risk-signals-acct-receiver-a-v1',
          observedAt: '2026-08-24T11:31:01.000Z',
          evidenceState: 'SIMULATED',
        },
      },
      trustedOutcome: { status: 'NONE' },
    }),
  });
  onProgress('Assessing current exit account risk');
  await requestJson(`${apiBase}/accounts/acct-e/risk`, {
    method: 'POST',
    idempotencyKey: 'demo:risk:golden-a:acct-e:v1',
    body: JSON.stringify({
      caseId,
      providerSignals: {
        inflowSpike: 0.82,
        uniqueSenderSpike: 0.44,
        firstTimeSenderRatio: 0.61,
        behaviourShift: 0.88,
        crossCaseLinkage: 0.76,
        authorisedSharedIdentifierStrength: 0.68,
        provenance: simulatorProvenance('risk-signals-acct-e-v1', '2026-08-24T11:31:02.000Z'),
      },
      trustedOutcome: { status: 'NONE' },
    }),
  });

  onProgress('Ranking stationary, forward, and cash-out exit modes');
  await requestJson(`${apiBase}/cases/${encodeURIComponent(caseId)}/exit-mode`, {
    method: 'POST',
    idempotencyKey: 'demo:exit-mode:golden-a:v1',
    body: JSON.stringify({
      accountId: 'acct-e',
      providerSignals: {
        recentIncomingVelocity: 0.82,
        recentOutgoingVelocity: 0.9,
        historicalStationary: 0.03,
        historicalForward: 0.03,
        historicalCashOut: 0.94,
        cashOutTendency: 1,
        evidenceStrength: 1,
        provenance: simulatorProvenance('exit-signals-acct-e-v1', '2026-08-24T11:31:03.000Z'),
      },
    }),
  });

  onProgress('Evaluating geo and time evidence independently');
  await requestJson(`${apiBase}/cases/${encodeURIComponent(caseId)}/forecast`, {
    method: 'POST',
    idempotencyKey: 'demo:evidence-gate:golden-a:v1',
    body: JSON.stringify({
      accountId: 'acct-e',
      geo: {
        sameAccountHistory: 0.9,
        connectedNetworkHistory: 0.82,
        graphConfidence: 0.9,
        historicalSupport: 0.8,
        predictionStability: 0.84,
        provenance: simulatorProvenance('gate-geo-acct-e-v1', '2026-08-24T11:31:04.000Z'),
      },
      time: {
        sameAccountHistory: 0.86,
        connectedNetworkHistory: 0.8,
        graphConfidence: 0.9,
        historicalSupport: 0.82,
        predictionStability: 0.81,
        provenance: simulatorProvenance('gate-time-acct-e-v1', '2026-08-24T11:31:04.000Z'),
      },
    }),
  });
  const zoneCandidate = (zoneId: string, label: string, score: number, sourceEventId: string) => ({
    zoneId,
    label,
    features: {
      accountHistory: score,
      networkHistory: Math.max(0, score - 0.05),
      recency: Math.max(0, score - 0.1),
      timeSimilarity: Math.max(0, score - 0.08),
      amountSimilarity: Math.max(0, score - 0.12),
    },
    provenance: simulatorProvenance(sourceEventId, '2026-08-24T11:31:05.000Z'),
  });
  const timeHorizon = (bucket: string, score: number) => ({
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
    provenance: simulatorProvenance(`time-${bucket}-acct-e-v1`, '2026-08-24T11:31:05.000Z'),
  });
  onProgress('Ranking top zones and bounded time horizons');
  await requestJson(`${apiBase}/cases/${encodeURIComponent(caseId)}/predictions`, {
    method: 'POST',
    idempotencyKey: 'demo:prediction:golden-a:v1',
    body: JSON.stringify({
      accountId: 'acct-e',
      geoCandidates: [
        zoneCandidate('zone-noida-sector-62', 'Noida Sector 62', 0.94, 'zone-noida-v1'),
        zoneCandidate('zone-delhi-east', 'Delhi East', 0.72, 'zone-delhi-v1'),
        zoneCandidate('zone-ghaziabad', 'Ghaziabad', 0.54, 'zone-ghaziabad-v1'),
        zoneCandidate('zone-gurugram', 'Gurugram', 0.31, 'zone-gurugram-v1'),
      ],
      timeHorizons: [
        timeHorizon('UNDER_30_MIN', 0.36),
        timeHorizon('30_TO_60_MIN', 0.58),
        timeHorizon('1_TO_2_HOURS', 0.91),
        timeHorizon('2_TO_6_HOURS', 0.63),
        timeHorizon('6_TO_24_HOURS', 0.24),
      ],
    }),
  });
  onProgress('Evidence-gated zone and time forecast ready');
  return caseId;
}

export async function runStationaryGateDemo(
  onProgress: (message: string) => void,
  apiBase = '/api/v1',
  sandboxBase = '/sandbox',
): Promise<string> {
  const scenarioId = 'stationary-abstention';
  const caseId = 'case:complaint-golden-b';

  onProgress('Resetting stationary provider scenario');
  await requestJson(`${sandboxBase}/scenarios/${scenarioId}/reset`, { method: 'POST' });
  onProgress('Creating stationary complaint and active case');
  await requestJson(`${apiBase}/complaints`, {
    method: 'POST',
    idempotencyKey: 'demo:complaint:golden-b',
    body: JSON.stringify(stationaryComplaint),
  });
  await consumeScenario(scenarioId, caseId, onProgress, apiBase, sandboxBase);

  onProgress('Running TRACE with no downstream movement');
  await requestJson(`${apiBase}/cases/${encodeURIComponent(caseId)}/trace`, {
    method: 'POST',
    idempotencyKey: 'demo:trace:golden-b:v1',
  });
  onProgress('Calculating retained attributable exposure');
  await requestJson(`${apiBase}/cases/${encodeURIComponent(caseId)}/recompute-exposure`, {
    method: 'POST',
    idempotencyKey: 'demo:exposure:golden-b:v1',
    body: JSON.stringify({
      accountBalances: [
        {
          accountId: 'acct-x',
          knownCleanBalanceMinor: 0,
          provenance: simulatorProvenance('balance-acct-x-v1', '2026-08-24T11:16:00.000Z'),
        },
      ],
    }),
  });
  onProgress('Assessing account risk without promoting a complaint to a verdict');
  await requestJson(`${apiBase}/accounts/acct-x/risk`, {
    method: 'POST',
    idempotencyKey: 'demo:risk:golden-b:acct-x:v1',
    body: JSON.stringify({
      caseId,
      providerSignals: {
        inflowSpike: 0.12,
        uniqueSenderSpike: 0.08,
        firstTimeSenderRatio: 0.18,
        behaviourShift: 0.1,
        crossCaseLinkage: 0,
        authorisedSharedIdentifierStrength: 0,
        provenance: simulatorProvenance('risk-signals-acct-x-v1', '2026-08-24T11:16:01.000Z'),
      },
      trustedOutcome: { status: 'NONE' },
    }),
  });
  onProgress('Ranking exit mode from observed stationary evidence');
  await requestJson(`${apiBase}/cases/${encodeURIComponent(caseId)}/exit-mode`, {
    method: 'POST',
    idempotencyKey: 'demo:exit-mode:golden-b:v1',
    body: JSON.stringify({
      accountId: 'acct-x',
      providerSignals: {
        recentIncomingVelocity: 0.1,
        recentOutgoingVelocity: 0,
        historicalStationary: 0.82,
        historicalForward: 0.1,
        historicalCashOut: 0.08,
        cashOutTendency: 0.04,
        evidenceStrength: 0.8,
        provenance: simulatorProvenance('exit-signals-acct-x-v1', '2026-08-24T11:16:02.000Z'),
      },
    }),
  });
  onProgress('Applying Evidence Gate without forcing a forecast');
  const strongDimension = (dimension: string) => ({
    sameAccountHistory: 0.9,
    connectedNetworkHistory: 0.82,
    graphConfidence: 0.9,
    historicalSupport: 0.8,
    predictionStability: 0.84,
    provenance: simulatorProvenance(`gate-${dimension}-acct-x-v1`, '2026-08-24T11:16:03.000Z'),
  });
  await requestJson(`${apiBase}/cases/${encodeURIComponent(caseId)}/forecast`, {
    method: 'POST',
    idempotencyKey: 'demo:evidence-gate:golden-b:v1',
    body: JSON.stringify({
      accountId: 'acct-x',
      geo: strongDimension('geo'),
      time: strongDimension('time'),
    }),
  });
  onProgress('Persisting explicit geo and time abstention');
  await requestJson(`${apiBase}/cases/${encodeURIComponent(caseId)}/predictions`, {
    method: 'POST',
    idempotencyKey: 'demo:prediction:golden-b:v1',
    body: JSON.stringify({ accountId: 'acct-x', geoCandidates: [], timeHorizons: [] }),
  });
  onProgress('Stationary funds retained; explicit forecast abstention ready');
  return caseId;
}
