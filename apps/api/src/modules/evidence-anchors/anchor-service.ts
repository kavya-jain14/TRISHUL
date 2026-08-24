import { hashEvidence, type EvidenceAnchorProvider } from '@trishul/audit';
import {
  EvidenceAnchorReceiptSchema,
  EvidenceAnchorRequestSchema,
  EvidenceVerificationRequestSchema,
  EvidenceVerificationResultSchema,
  IdempotencyKeySchema,
  type EvidenceAnchorReceipt,
  type EvidenceVerificationResult,
} from '@trishul/contracts';
import { ConflictError, NotFoundError } from '../../domain/errors.js';
import type { EvidenceAnchorRepository } from './anchor-repository.js';

type Clock = () => string;
type CaseReader = (caseId: string) => Promise<unknown>;

export interface AnchorResult {
  receipt: EvidenceAnchorReceipt;
  replayed: boolean;
}

export class EvidenceAnchorService {
  constructor(
    private readonly repository: EvidenceAnchorRepository,
    private readonly provider: EvidenceAnchorProvider,
    private readonly requireCase: CaseReader,
    private readonly clock: Clock = () => new Date().toISOString(),
  ) {}

  async anchor(
    caseId: string,
    rawPayload: unknown,
    rawIdempotencyKey: unknown,
  ): Promise<AnchorResult> {
    const payload = EvidenceAnchorRequestSchema.parse(rawPayload);
    const idempotencyKey = IdempotencyKeySchema.parse(rawIdempotencyKey);
    await this.requireCase(caseId);

    const evidenceHash = hashEvidence(payload.evidence);
    const requestHash = hashEvidence({ caseId, evidenceRef: payload.evidenceRef, evidenceHash });
    const replay = await this.repository.findByIdempotency(caseId, idempotencyKey);
    if (replay) {
      if (replay.requestHash !== requestHash) {
        throw new ConflictError(
          'IDEMPOTENCY_KEY_REUSED',
          'This idempotency key was already used for different anchor evidence',
        );
      }
      return { receipt: replay.receipt, replayed: true };
    }

    const submissionHash = hashEvidence({
      domain: 'TRISHUL_EVIDENCE_SUBMISSION_V1',
      caseId,
      evidenceRef: payload.evidenceRef,
      evidenceHash,
    });
    const existingSubmission = await this.repository.findBySubmissionHash(submissionHash);
    if (existingSubmission) return { receipt: existingSubmission.receipt, replayed: true };

    const anchoredAt = this.clock();
    const providerReceipt = await this.provider.anchor({
      evidenceHash,
      submissionHash,
      anchoredAt,
    });
    const receipt = EvidenceAnchorReceiptSchema.parse({
      anchorId: `anchor:${submissionHash}`,
      caseId,
      evidenceRef: payload.evidenceRef,
      evidenceHash,
      submissionHash,
      ...providerReceipt,
      anchoredAt,
    });
    try {
      await this.repository.save({ receipt, idempotencyKey, requestHash });
    } catch (error) {
      const concurrentReplay = await this.repository.findBySubmissionHash(submissionHash);
      if (concurrentReplay) return { receipt: concurrentReplay.receipt, replayed: true };
      throw error;
    }
    return { receipt, replayed: false };
  }

  async get(anchorId: string): Promise<EvidenceAnchorReceipt> {
    const record = await this.repository.get(anchorId);
    if (!record) throw new NotFoundError('Evidence anchor', anchorId);
    return record.receipt;
  }

  async verify(anchorId: string, rawPayload: unknown): Promise<EvidenceVerificationResult> {
    const payload = EvidenceVerificationRequestSchema.parse(rawPayload);
    const record = await this.repository.get(anchorId);
    if (!record) throw new NotFoundError('Evidence anchor', anchorId);

    const suppliedEvidenceHash = hashEvidence(payload.evidence);
    const payloadHashMatches = suppliedEvidenceHash === record.receipt.evidenceHash;
    const ledgerReceiptValid = await this.provider.verify({
      evidenceHash: record.receipt.evidenceHash,
      submissionHash: record.receipt.submissionHash,
      anchorReference: record.receipt.anchorReference,
      transactionHash: record.receipt.transactionHash,
    });
    return EvidenceVerificationResultSchema.parse({
      anchorId,
      evidenceHash: record.receipt.evidenceHash,
      suppliedEvidenceHash,
      payloadHashMatches,
      ledgerReceiptValid,
      verified: payloadHashMatches && ledgerReceiptValid,
      verifiedAt: this.clock(),
    });
  }
}
