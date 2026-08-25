import type {
  EvidenceAnchorJob,
  ExposureRecomputationJob,
  ForecastRefreshJob,
  RiskReassessmentJob,
  TraceGraphExpansionJob,
} from '@trishul/contracts';

export interface CaseOperations {
  trace(job: TraceGraphExpansionJob, signal?: AbortSignal): Promise<void>;
  recomputeExposure(job: ExposureRecomputationJob, signal?: AbortSignal): Promise<void>;
  reassessRisk(job: RiskReassessmentJob, signal?: AbortSignal): Promise<void>;
  refreshForecast(job: ForecastRefreshJob, signal?: AbortSignal): Promise<void>;
  anchorEvidence(job: EvidenceAnchorJob, signal?: AbortSignal): Promise<void>;
}

export interface TrishulApiClientOptions {
  timeoutMs?: number;
  allowInsecureHttp?: boolean;
}

export class TrishulApiClient implements CaseOperations {
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;

  constructor(
    baseUrl: string,
    private readonly serviceToken?: string,
    private readonly request: typeof fetch = fetch,
    options: TrishulApiClientOptions = {},
  ) {
    this.baseUrl = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    if (
      this.baseUrl.protocol !== 'https:' &&
      !(
        options.allowInsecureHttp &&
        this.baseUrl.protocol === 'http:' &&
        isLoopback(this.baseUrl.hostname)
      )
    ) {
      throw new Error('TRISHUL_API_BASE_URL must use HTTPS outside local development.');
    }
    this.timeoutMs = positiveInteger(options.timeoutMs ?? 10_000, 'timeoutMs');
  }

  async trace(job: TraceGraphExpansionJob, signal?: AbortSignal): Promise<void> {
    await this.post(
      `api/v1/cases/${segment(job.caseId)}/trace`,
      job.idempotencyKey,
      undefined,
      signal,
    );
  }

  async recomputeExposure(job: ExposureRecomputationJob, signal?: AbortSignal): Promise<void> {
    await this.post(
      `api/v1/cases/${segment(job.caseId)}/recompute-exposure`,
      job.idempotencyKey,
      job.request,
      signal,
    );
  }

  async reassessRisk(job: RiskReassessmentJob, signal?: AbortSignal): Promise<void> {
    await this.post(
      `api/v1/accounts/${segment(job.accountId)}/risk`,
      job.idempotencyKey,
      job.request,
      signal,
    );
  }

  async refreshForecast(job: ForecastRefreshJob, signal?: AbortSignal): Promise<void> {
    const casePath = `api/v1/cases/${segment(job.caseId)}`;
    await this.post(
      `${casePath}/exit-mode`,
      job.exitMode.idempotencyKey,
      job.exitMode.request,
      signal,
    );
    await this.post(
      `${casePath}/forecast`,
      job.evidenceGate.idempotencyKey,
      job.evidenceGate.request,
      signal,
    );
    await this.post(
      `${casePath}/predictions`,
      job.forecast.idempotencyKey,
      job.forecast.request,
      signal,
    );
  }

  async anchorEvidence(job: EvidenceAnchorJob, signal?: AbortSignal): Promise<void> {
    await this.post(
      `api/v1/cases/${segment(job.caseId)}/evidence-anchors`,
      job.idempotencyKey,
      job.request,
      signal,
    );
  }

  private async post(
    path: string,
    idempotencyKey: string,
    body?: unknown,
    parentSignal?: AbortSignal,
  ): Promise<void> {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromParent = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abortFromParent();
    else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error('TRISHUL API request timed out.'));
    }, this.timeoutMs);
    timeout.unref();
    try {
      const response = await this.request(new URL(path, this.baseUrl), {
        method: 'POST',
        signal: controller.signal,
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
    } catch (error) {
      if (timedOut) {
        throw new Error(`TRISHUL API operation ${path} timed out after ${this.timeoutMs}ms.`);
      }
      if (parentSignal?.aborted) {
        throw new Error(`TRISHUL API operation ${path} was aborted.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', abortFromParent);
    }
  }
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be positive.`);
  return value;
}

function isLoopback(hostname: string): boolean {
  return ['127.0.0.1', 'localhost', '[::1]'].includes(hostname.toLowerCase());
}
