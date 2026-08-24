import { hashEvidence } from '@trishul/audit';
import {
  CaseActionRequestSchema,
  IdempotencyKeySchema,
  type CaseActionRecord,
  type CaseActionType,
  type CredentialRole,
  type EvidenceAnchorReceipt,
  type TrustSession,
} from '@trishul/contracts';
import {
  CaseActionCaseNotFoundError,
  CaseActionConflictError,
  type CaseActionRepository,
} from '@trishul/database';
import {
  ConflictError,
  ForbiddenError,
  InvalidRequestError,
  NotFoundError,
} from '../../domain/errors.js';

type CaseLookup = (caseId: string) => Promise<unknown>;
type EvidenceAnchorLookup = (anchorId: string) => Promise<EvidenceAnchorReceipt>;
type Clock = () => string;

const ACTION_ROLES: Record<CaseActionType, readonly CredentialRole[]> = {
  ALERT_BANK: ['INVESTIGATOR', 'SUPERVISOR'],
  ALERT_LEA: ['SUPERVISOR'],
  ESCALATE_CASE: ['SUPERVISOR'],
  ADD_ANALYST_NOTE: ['INVESTIGATOR', 'SUPERVISOR'],
  ADD_OUTCOME_NOTE: ['SUPERVISOR'],
};

export class CaseActionService {
  constructor(
    private readonly repository: CaseActionRepository,
    private readonly caseLookup: CaseLookup,
    private readonly evidenceAnchorLookup: EvidenceAnchorLookup,
    private readonly clock: Clock = () => new Date().toISOString(),
  ) {}

  async record(
    caseId: string,
    rawRequest: unknown,
    rawIdempotencyKey: unknown,
    principal: TrustSession,
  ) {
    await this.caseLookup(caseId);
    const request = CaseActionRequestSchema.parse(rawRequest);
    const idempotencyKey = IdempotencyKeySchema.parse(rawIdempotencyKey);
    this.authorizeAction(caseId, request.action, principal);
    const anchors = await Promise.all(
      request.evidenceAnchorIds.map((anchorId) => this.evidenceAnchorLookup(anchorId)),
    );
    if (anchors.some((anchor) => anchor.caseId !== caseId)) {
      throw new InvalidRequestError(
        'CASE_ACTION_EVIDENCE_SCOPE_MISMATCH',
        'Every evidence anchor must belong to the action case.',
      );
    }
    const requestHash = hashEvidence({ caseId, request, principal: sessionIdentity(principal) });
    const action: CaseActionRecord = {
      ...request,
      caseId,
      actorRef: principal.subjectId,
      actorRole: principal.role,
      purpose: principal.purpose,
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

  private authorizeAction(caseId: string, action: CaseActionType, principal: TrustSession): void {
    if (principal.caseId !== caseId || !principal.capabilities.includes('CASE_WRITE')) {
      throw new ForbiddenError(
        'CASE_ACTION_SESSION_SCOPE_INVALID',
        'The verified session is not authorised to write actions for this case.',
      );
    }
    if (!ACTION_ROLES[action].includes(principal.role)) {
      throw new ForbiddenError(
        'CASE_ACTION_ROLE_DENIED',
        `${principal.role} is not authorised to record ${action}.`,
      );
    }
  }
}

function sessionIdentity(session: TrustSession) {
  return {
    subjectId: session.subjectId,
    role: session.role,
    purpose: session.purpose,
    caseId: session.caseId,
  };
}
