import { randomUUID } from 'node:crypto';
import type {
  IdentityResolutionDecision,
  IdentityResolutionRequest,
  IdentityResolutionResult,
  TrustSession,
} from '@trishul/contracts';
import type { IdentityResolutionRepository } from '@trishul/database';

export interface IdentityResolutionProvider {
  readonly available: boolean;
  /** Must be idempotent for a repeated requestId. */
  authorizeResolution(input: {
    requestId: string;
    caseId: string;
  }): Promise<{ providerReference: string }>;
}

export class ReferenceOnlyDevelopmentIdentityProvider implements IdentityResolutionProvider {
  readonly available = true;
  private readonly references = new Map<string, string>();

  async authorizeResolution(input: { requestId: string }): Promise<{ providerReference: string }> {
    const providerReference =
      this.references.get(input.requestId) ?? `simulated-provider-ref:${randomUUID()}`;
    this.references.set(input.requestId, providerReference);
    return { providerReference };
  }
}

export class UnavailableIdentityResolutionProvider implements IdentityResolutionProvider {
  readonly available = false;

  async authorizeResolution(): Promise<never> {
    throw new IdentityResolutionError(
      'IDENTITY_PROVIDER_UNAVAILABLE',
      'An authorised identity-resolution provider is not configured.',
      503,
    );
  }
}

export class IdentityResolutionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'IdentityResolutionError';
  }
}

export class IdentityResolutionService {
  constructor(
    private readonly repository: IdentityResolutionRepository,
    private readonly provider: IdentityResolutionProvider,
    private readonly assertCaseExists: (caseId: string) => Promise<unknown>,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async requestResolution(
    caseId: string,
    justification: string,
    session: TrustSession,
  ): Promise<IdentityResolutionRequest> {
    if (!this.provider.available) {
      throw new IdentityResolutionError(
        'IDENTITY_PROVIDER_UNAVAILABLE',
        'An authorised identity-resolution provider is not configured.',
        503,
      );
    }
    this.requireSession(session, 'IDENTITY_RESOLUTION_REQUEST', caseId);
    if (session.role !== 'INVESTIGATOR') {
      throw new IdentityResolutionError(
        'IDENTITY_REQUEST_ROLE_DENIED',
        'Only an authorised investigator can request identity resolution.',
        403,
      );
    }
    if (!['FRAUD_INVESTIGATION', 'LAW_ENFORCEMENT_REQUEST'].includes(session.purpose)) {
      throw new IdentityResolutionError(
        'IDENTITY_REQUEST_PURPOSE_DENIED',
        'Identity resolution requires an investigation or law-enforcement purpose.',
        403,
      );
    }
    await this.assertCaseExists(caseId);

    const resolutionRequest: IdentityResolutionRequest = {
      requestId: randomUUID(),
      caseId,
      investigatorId: session.subjectId,
      requestJustification: justification,
      status: 'PENDING',
      requestedAt: this.clock().toISOString(),
    };
    await this.repository.createRequest(resolutionRequest);
    return resolutionRequest;
  }

  async decideResolution(
    caseId: string,
    requestId: string,
    decision: IdentityResolutionDecision,
    justification: string,
    session: TrustSession,
  ): Promise<IdentityResolutionResult> {
    this.requireSession(session, 'IDENTITY_RESOLUTION_APPROVE', caseId);
    if (!['SUPERVISOR', 'LEA_OFFICER'].includes(session.role)) {
      throw new IdentityResolutionError(
        'IDENTITY_APPROVAL_ROLE_DENIED',
        'Only an authorised supervisor or LEA officer can decide identity resolution.',
        403,
      );
    }
    if (session.purpose !== 'LAW_ENFORCEMENT_REQUEST') {
      throw new IdentityResolutionError(
        'IDENTITY_APPROVAL_PURPOSE_DENIED',
        'Identity resolution approval requires a law-enforcement purpose.',
        403,
      );
    }

    const resolutionRequest = await this.repository.getRequest(requestId);
    if (!resolutionRequest || resolutionRequest.caseId !== caseId) {
      throw new IdentityResolutionError(
        'IDENTITY_RESOLUTION_NOT_FOUND',
        'Identity resolution request was not found for this case.',
        404,
      );
    }
    if (resolutionRequest.status !== 'PENDING') {
      throw new IdentityResolutionError(
        'IDENTITY_RESOLUTION_ALREADY_DECIDED',
        'Identity resolution request has already been decided.',
        409,
      );
    }
    if (resolutionRequest.investigatorId === session.subjectId) {
      throw new IdentityResolutionError(
        'TWO_PERSON_RULE_REQUIRED',
        'The requester cannot approve or reject their own identity resolution request.',
        403,
      );
    }

    const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const providerReference =
      decision === 'APPROVE'
        ? (await this.provider.authorizeResolution({ requestId, caseId })).providerReference
        : undefined;
    const resolvedAt = this.clock().toISOString();
    const decided = await this.repository.decideRequest(
      requestId,
      caseId,
      status,
      session.subjectId,
      justification,
      providerReference,
      resolvedAt,
    );
    if (!decided) {
      throw new IdentityResolutionError(
        'IDENTITY_RESOLUTION_CONCURRENT_DECISION',
        'Identity resolution request was decided concurrently.',
        409,
      );
    }

    return {
      requestId,
      caseId,
      status,
      ...(providerReference ? { providerReference } : {}),
      resolvedAt,
    };
  }

  private requireSession(
    session: TrustSession,
    capability: 'IDENTITY_RESOLUTION_REQUEST' | 'IDENTITY_RESOLUTION_APPROVE',
    caseId: string,
  ): void {
    if (!session.capabilities.includes(capability)) {
      throw new IdentityResolutionError(
        'IDENTITY_RESOLUTION_CAPABILITY_DENIED',
        `The verified session does not grant ${capability}.`,
        403,
      );
    }
    if (session.caseId !== caseId) {
      throw new IdentityResolutionError(
        'IDENTITY_RESOLUTION_CASE_SCOPE_DENIED',
        'The verified session is not bound to this case.',
        403,
      );
    }
  }
}
