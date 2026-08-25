import { randomUUID } from 'node:crypto';
import { hashEvidence } from '@trishul/audit';
import {
  IdempotencyKeySchema,
  PaymentRiskEvaluationRequestSchema,
  type PaymentRiskRunResult,
} from '@trishul/contracts';
import { PaymentRiskConflictError, type PaymentRiskRepository } from '@trishul/database';
import { evaluatePaymentRisk } from '@trishul/intelligence';
import { ConflictError, NotFoundError } from '../../domain/errors.js';

type Clock = () => string;
type AssessmentIdFactory = () => string;

export class PaymentRiskService {
  constructor(
    private readonly repository: PaymentRiskRepository,
    private readonly clock: Clock = () => new Date().toISOString(),
    private readonly assessmentId: AssessmentIdFactory = () => randomUUID(),
  ) {}

  async evaluate(rawRequest: unknown, rawIdempotencyKey: unknown): Promise<PaymentRiskRunResult> {
    const request = PaymentRiskEvaluationRequestSchema.parse(rawRequest);
    const idempotencyKey = IdempotencyKeySchema.parse(rawIdempotencyKey);
    const requestHash = hashEvidence(request);
    const assessment = evaluatePaymentRisk(request, {
      assessmentId: this.assessmentId(),
      evaluatedAt: this.clock(),
      calculationInputHash: requestHash,
    });
    try {
      const result = await this.repository.record({ assessment, idempotencyKey, requestHash });
      return { assessment: result.assessment, replayed: result.status === 'IDEMPOTENT_REPLAY' };
    } catch (error) {
      if (error instanceof PaymentRiskConflictError) {
        throw new ConflictError('PAYMENT_RISK_IDEMPOTENCY_CONFLICT', error.message);
      }
      throw error;
    }
  }

  async latest(paymentReference: string) {
    const assessment = await this.repository.latestForPayment(paymentReference);
    if (!assessment) throw new NotFoundError('Payment risk assessment', paymentReference);
    return assessment;
  }
}
