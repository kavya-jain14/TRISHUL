import type {
  EvidenceAnchorJob,
  ExposureRecomputationJob,
  ForecastRefreshJob,
  RiskReassessmentJob,
  TraceGraphExpansionJob,
} from '@trishul/contracts';

export interface CaseOperations {
  trace(job: TraceGraphExpansionJob): Promise<void>;
  recomputeExposure(job: ExposureRecomputationJob): Promise<void>;
  reassessRisk(job: RiskReassessmentJob): Promise<void>;
  refreshForecast(job: ForecastRefreshJob): Promise<void>;
  anchorEvidence(job: EvidenceAnchorJob): Promise<void>;
}

export class TrishulApiClient implements CaseOperations {
  private readonly baseUrl: URL;

  constructor(
    baseUrl: string,
    private readonly serviceToken?: string,
    private readonly request: typeof fetch = fetch,
  ) {
    this.baseUrl = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    if (!['http:', 'https:'].includes(this.baseUrl.protocol)) {
      throw new Error('TRISHUL_API_BASE_URL must use HTTP or HTTPS.');
    }
  }

  async trace(job: TraceGraphExpansionJob): Promise<void> {
    await this.post(`api/v1/cases/${segment(job.caseId)}/trace`, job.idempotencyKey);
  }

  async recomputeExposure(job: ExposureRecomputationJob): Promise<void> {
    await this.post(
      `api/v1/cases/${segment(job.caseId)}/recompute-exposure`,
      job.idempotencyKey,
      job.request,
    );
  }

  async reassessRisk(job: RiskReassessmentJob): Promise<void> {
    await this.post(
      `api/v1/accounts/${segment(job.accountId)}/risk`,
      job.idempotencyKey,
      job.request,
    );
  }

  async refreshForecast(job: ForecastRefreshJob): Promise<void> {
    const casePath = `api/v1/cases/${segment(job.caseId)}`;
    await this.post(`${casePath}/exit-mode`, job.exitMode.idempotencyKey, job.exitMode.request);
    await this.post(
      `${casePath}/forecast`,
      job.evidenceGate.idempotencyKey,
      job.evidenceGate.request,
    );
    await this.post(`${casePath}/predictions`, job.forecast.idempotencyKey, job.forecast.request);
  }

  async anchorEvidence(job: EvidenceAnchorJob): Promise<void> {
    await this.post(
      `api/v1/cases/${segment(job.caseId)}/evidence-anchors`,
      job.idempotencyKey,
      job.request,
    );
  }

  private async post(path: string, idempotencyKey: string, body?: unknown): Promise<void> {
    const response = await this.request(new URL(path, this.baseUrl), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'idempotency-key': idempotencyKey,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.serviceToken ? { authorization: `Bearer ${this.serviceToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new Error(`TRISHUL API operation ${path} failed with HTTP ${response.status}.`);
    }
  }
}

function segment(value: string): string {
  return encodeURIComponent(value);
}
