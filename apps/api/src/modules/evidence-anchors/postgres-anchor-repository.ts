import { EvidenceAnchorReceiptSchema } from '@trishul/contracts';
import type { Pool } from 'pg';
import type { EvidenceAnchorRecord, EvidenceAnchorRepository } from './anchor-repository.js';

interface AnchorRow {
  anchor_id: string;
  external_case_id: string;
  evidence_ref: string;
  evidence_hash: string;
  submission_hash: string;
  provider: string;
  network: string;
  anchor_reference: string;
  transaction_hash: string;
  anchored_at: Date | string;
  idempotency_key: string;
  request_hash: string;
}

const SELECT_RECEIPT = `SELECT
  ea.anchor_id,
  c.external_case_id,
  ea.evidence_ref,
  ea.evidence_hash,
  ea.submission_hash,
  ea.provider,
  ea.network,
  ea.anchor_reference,
  ea.transaction_hash,
  ea.anchored_at,
  ea.idempotency_key,
  ea.request_hash
FROM evidence_anchor_receipts ea
JOIN cases c ON c.id = ea.case_id`;

function mapRecord(row: AnchorRow): EvidenceAnchorRecord {
  return {
    receipt: EvidenceAnchorReceiptSchema.parse({
      anchorId: row.anchor_id,
      caseId: row.external_case_id,
      evidenceRef: row.evidence_ref,
      evidenceHash: row.evidence_hash,
      submissionHash: row.submission_hash,
      provider: row.provider,
      network: row.network,
      anchorReference: row.anchor_reference,
      transactionHash: row.transaction_hash,
      anchoredAt:
        row.anchored_at instanceof Date
          ? row.anchored_at.toISOString()
          : new Date(row.anchored_at).toISOString(),
    }),
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
  };
}

export class PostgresEvidenceAnchorRepository implements EvidenceAnchorRepository {
  constructor(private readonly pool: Pool) {}

  async findByIdempotency(
    caseId: string,
    idempotencyKey: string,
  ): Promise<EvidenceAnchorRecord | null> {
    const result = await this.pool.query<AnchorRow>(
      `${SELECT_RECEIPT}
       WHERE c.external_case_id = $1 AND ea.idempotency_key = $2`,
      [caseId, idempotencyKey],
    );
    const row = result.rows[0];
    return row ? mapRecord(row) : null;
  }

  async get(anchorId: string): Promise<EvidenceAnchorRecord | null> {
    const result = await this.pool.query<AnchorRow>(`${SELECT_RECEIPT} WHERE ea.anchor_id = $1`, [
      anchorId,
    ]);
    const row = result.rows[0];
    return row ? mapRecord(row) : null;
  }

  async findBySubmissionHash(submissionHash: string): Promise<EvidenceAnchorRecord | null> {
    const result = await this.pool.query<AnchorRow>(
      `${SELECT_RECEIPT} WHERE ea.submission_hash = $1`,
      [submissionHash],
    );
    const row = result.rows[0];
    return row ? mapRecord(row) : null;
  }

  async save(record: EvidenceAnchorRecord): Promise<void> {
    const result = await this.pool.query(
      `INSERT INTO evidence_anchor_receipts (
         anchor_id,
         case_id,
         evidence_ref,
         evidence_hash,
         submission_hash,
         provider,
         network,
         anchor_reference,
         transaction_hash,
         anchored_at,
         idempotency_key,
         request_hash
       )
       SELECT $1, c.id, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11, $12
       FROM cases c
       WHERE c.external_case_id = $2`,
      [
        record.receipt.anchorId,
        record.receipt.caseId,
        record.receipt.evidenceRef,
        record.receipt.evidenceHash,
        record.receipt.submissionHash,
        record.receipt.provider,
        record.receipt.network,
        record.receipt.anchorReference,
        record.receipt.transactionHash,
        record.receipt.anchoredAt,
        record.idempotencyKey,
        record.requestHash,
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error(`Case ${record.receipt.caseId} was not found while saving its anchor`);
    }
  }
}
