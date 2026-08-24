import {
  CaseDetailSchema,
  GraphSnapshotSchema,
  ProviderEventSchema,
  type CaseDetail,
  type GraphSnapshot,
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
    };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'GRAPH_NOT_AVAILABLE') {
      return { caseDetail, graph: null, graphPending: true };
    }
    throw error;
  }
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
  }

  onProgress('Running idempotent TRACE graph expansion');
  await requestJson(`${apiBase}/cases/${encodeURIComponent(caseId)}/trace`, {
    method: 'POST',
    idempotencyKey: 'demo:trace:golden-a:v1',
  });
  onProgress('Case Intelligence graph ready');
  return caseId;
}
