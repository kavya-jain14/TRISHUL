import { hashEvidence } from '@trishul/audit';
import {
  CaseActionRequestSchema,
  IdempotencyKeySchema,
  type CaseActionRecord,
} from '@trishul/contracts';
import {
  CaseActionCaseNotFoundError,
  CaseActionConflictError,
  type CaseActionRepository,
} from '@trishul/database';
import { ConflictError, NotFoundError } from '../../domain/errors.js';

type CaseLookup = (caseId: string) => Promise<unknown>;
type Clock = () => string;

export class CaseActionService {
  constructor(
    private readonly repository: CaseActionRepository,
    private readonly caseLookup: CaseLookup,
    private readonly clock: Clock = () => new Date().toISOString(),
  ) {}

  async record(caseId: string, rawRequest: unknown, rawIdempotencyKey: unknown) {
    await this.caseLookup(caseId);
    const request = CaseActionRequestSchema.parse(rawRequest);
    const idempotencyKey = IdempotencyKeySchema.parse(rawIdempotencyKey);
    const requestHash = hashEvidence({ caseId, request });
    const action: CaseActionRecord = {
      ...request,
      caseId,
      recordedAt: this.clock(),
    };
    try {
      const result = await this.repository.record({ action, idempotencyKey, requestHash });
      return { action: result.action, replayed: result.status === 'IDEMPOTENT_REPLAY' };
    } catch (error) {
      if (error instanceof CaseActionCaseNotFoundError) {
        throw new NotFoundError('Case', caseId);
      }
      if (error instanceof CaseActionConflictError) {
        throw new ConflictError('CASE_ACTION_CONFLICT', error.message);
      }
      throw error;
    }
  }

  async list(caseId: string): Promise<readonly CaseActionRecord[]> {
    await this.caseLookup(caseId);
    return this.repository.listForCase(caseId);
  }
}
