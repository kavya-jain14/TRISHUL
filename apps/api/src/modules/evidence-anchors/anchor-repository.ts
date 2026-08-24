import type { EvidenceAnchorReceipt } from '@trishul/contracts';

export interface EvidenceAnchorRecord {
  receipt: EvidenceAnchorReceipt;
  idempotencyKey: string;
  requestHash: string;
}

export interface EvidenceAnchorRepository {
  findByIdempotency(caseId: string, idempotencyKey: string): Promise<EvidenceAnchorRecord | null>;
  findBySubmissionHash(submissionHash: string): Promise<EvidenceAnchorRecord | null>;
  get(anchorId: string): Promise<EvidenceAnchorRecord | null>;
  save(record: EvidenceAnchorRecord): Promise<void>;
}

export class InMemoryEvidenceAnchorRepository implements EvidenceAnchorRepository {
  readonly #records = new Map<string, EvidenceAnchorRecord>();
  readonly #idempotency = new Map<string, string>();

  async findByIdempotency(
    caseId: string,
    idempotencyKey: string,
  ): Promise<EvidenceAnchorRecord | null> {
    const anchorId = this.#idempotency.get(`${caseId}:${idempotencyKey}`);
    return anchorId ? this.get(anchorId) : null;
  }

  async get(anchorId: string): Promise<EvidenceAnchorRecord | null> {
    const record = this.#records.get(anchorId);
    return record ? structuredClone(record) : null;
  }

  async findBySubmissionHash(submissionHash: string): Promise<EvidenceAnchorRecord | null> {
    for (const record of this.#records.values()) {
      if (record.receipt.submissionHash === submissionHash) return structuredClone(record);
    }
    return null;
  }

  async save(record: EvidenceAnchorRecord): Promise<void> {
    this.#records.set(record.receipt.anchorId, structuredClone(record));
    this.#idempotency.set(
      `${record.receipt.caseId}:${record.idempotencyKey}`,
      record.receipt.anchorId,
    );
  }
}
