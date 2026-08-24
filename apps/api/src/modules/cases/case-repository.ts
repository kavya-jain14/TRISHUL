import type {
  CaseSummary,
  ComplaintSubmission,
  ExposureSnapshot,
  GraphSnapshot,
  MuleAssessmentSnapshot,
  ProviderEvent,
} from '@trishul/contracts';

export interface CaseRecord {
  summary: CaseSummary;
  complaint: ComplaintSubmission;
  resolvedBeneficiaryAccount: string | null;
  providerEvents: ProviderEvent[];
  providerEventHashes: Record<string, string>;
  processedEventIds: string[];
  graphVersions: GraphSnapshot[];
  exposureSnapshots: ExposureSnapshot[];
  muleAssessments: MuleAssessmentSnapshot[];
}

export interface IdempotencyRecord {
  operation: string;
  key: string;
  requestHash: string;
  response: unknown;
}

export interface CaseRepository {
  getCase(caseId: string): Promise<CaseRecord | null>;
  findCaseByComplaintId(complaintId: string): Promise<CaseRecord | null>;
  saveCase(record: CaseRecord): Promise<void>;
  getIdempotency(operation: string, key: string): Promise<IdempotencyRecord | null>;
  saveIdempotency(record: IdempotencyRecord): Promise<void>;
}

export class InMemoryCaseRepository implements CaseRepository {
  private readonly cases = new Map<string, CaseRecord>();
  private readonly complaintIndex = new Map<string, string>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();

  async getCase(caseId: string): Promise<CaseRecord | null> {
    const record = this.cases.get(caseId);
    return record ? structuredClone(record) : null;
  }

  async findCaseByComplaintId(complaintId: string): Promise<CaseRecord | null> {
    const caseId = this.complaintIndex.get(complaintId);
    return caseId ? this.getCase(caseId) : null;
  }

  async saveCase(record: CaseRecord): Promise<void> {
    this.cases.set(record.summary.caseId, structuredClone(record));
    this.complaintIndex.set(record.complaint.complaintId, record.summary.caseId);
  }

  async getIdempotency(operation: string, key: string): Promise<IdempotencyRecord | null> {
    const record = this.idempotency.get(`${operation}:${key}`);
    return record ? structuredClone(record) : null;
  }

  async saveIdempotency(record: IdempotencyRecord): Promise<void> {
    this.idempotency.set(`${record.operation}:${record.key}`, structuredClone(record));
  }
}
