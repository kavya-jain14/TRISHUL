import { PaymentRiskAssessmentSchema, type PaymentRiskAssessment } from '@trishul/contracts';
import type { Pool } from 'pg';

export interface PaymentRiskWrite {
  idempotencyKey: string;
  requestHash: string;
  assessment: PaymentRiskAssessment;
}

export interface PaymentRiskWriteResult {
  status: 'CREATED' | 'IDEMPOTENT_REPLAY';
  assessment: PaymentRiskAssessment;
}

export interface PaymentRiskRepository {
  record(input: PaymentRiskWrite): Promise<PaymentRiskWriteResult>;
  latestForPayment(paymentReference: string): Promise<PaymentRiskAssessment | null>;
}

export class PaymentRiskConflictError extends Error {}

interface PaymentRiskRow {
  requestHash: string;
  assessment: unknown;
}

export class PostgresPaymentRiskRepository implements PaymentRiskRepository {
  constructor(private readonly pool: Pool) {}

  async record(input: PaymentRiskWrite): Promise<PaymentRiskWriteResult> {
    const assessment = PaymentRiskAssessmentSchema.parse(input.assessment);
    const inserted = await this.pool.query<PaymentRiskRow>(
      `INSERT INTO payment_risk_assessments
        (idempotency_key, request_hash, assessment_id, payment_reference, assessment, evaluated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT DO NOTHING
       RETURNING request_hash AS "requestHash", assessment`,
      [
        input.idempotencyKey,
        input.requestHash,
        assessment.assessmentId,
        assessment.paymentReference,
        JSON.stringify(assessment),
        assessment.evaluatedAt,
      ],
    );
    const created = inserted.rows[0];
    if (created) {
      return {
        status: 'CREATED',
        assessment: PaymentRiskAssessmentSchema.parse(created.assessment),
      };
    }

    const existing = await this.pool.query<PaymentRiskRow>(
      `SELECT request_hash AS "requestHash", assessment
       FROM payment_risk_assessments WHERE idempotency_key = $1`,
      [input.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row || row.requestHash !== input.requestHash) {
      throw new PaymentRiskConflictError(
        'Payment-risk assessment id or idempotency key was reused with different content.',
      );
    }
    return {
      status: 'IDEMPOTENT_REPLAY',
      assessment: PaymentRiskAssessmentSchema.parse(row.assessment),
    };
  }

  async latestForPayment(paymentReference: string): Promise<PaymentRiskAssessment | null> {
    const result = await this.pool.query<{ assessment: unknown }>(
      `SELECT assessment FROM payment_risk_assessments
       WHERE payment_reference = $1
       ORDER BY evaluated_at DESC, assessment_id DESC LIMIT 1`,
      [paymentReference],
    );
    const row = result.rows[0];
    return row ? PaymentRiskAssessmentSchema.parse(row.assessment) : null;
  }
}

export class InMemoryPaymentRiskRepository implements PaymentRiskRepository {
  private readonly byIdempotencyKey = new Map<
    string,
    { requestHash: string; assessment: PaymentRiskAssessment }
  >();
  private readonly assessmentIds = new Set<string>();

  async record(input: PaymentRiskWrite): Promise<PaymentRiskWriteResult> {
    const assessment = PaymentRiskAssessmentSchema.parse(input.assessment);
    const replay = this.byIdempotencyKey.get(input.idempotencyKey);
    if (replay) {
      if (replay.requestHash !== input.requestHash) {
        throw new PaymentRiskConflictError(
          'Payment-risk idempotency key was reused with different content.',
        );
      }
      return { status: 'IDEMPOTENT_REPLAY', assessment: structuredClone(replay.assessment) };
    }
    if (this.assessmentIds.has(assessment.assessmentId)) {
      throw new PaymentRiskConflictError(
        'Payment-risk assessment ID was reused with different content.',
      );
    }
    this.assessmentIds.add(assessment.assessmentId);
    this.byIdempotencyKey.set(input.idempotencyKey, {
      requestHash: input.requestHash,
      assessment: structuredClone(assessment),
    });
    return { status: 'CREATED', assessment: structuredClone(assessment) };
  }

  async latestForPayment(paymentReference: string): Promise<PaymentRiskAssessment | null> {
    const assessments = [...this.byIdempotencyKey.values()]
      .map((value) => value.assessment)
      .filter((assessment) => assessment.paymentReference === paymentReference)
      .sort(
        (left, right) =>
          right.evaluatedAt.localeCompare(left.evaluatedAt) ||
          right.assessmentId.localeCompare(left.assessmentId),
      );
    return assessments[0] ? structuredClone(assessments[0]) : null;
  }
}
