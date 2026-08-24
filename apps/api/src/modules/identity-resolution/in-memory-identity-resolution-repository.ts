import type { IdentityResolutionRepository } from '@trishul/database';
import type { IdentityResolutionRequest } from '@trishul/contracts';

export class InMemoryIdentityResolutionRepository implements IdentityResolutionRepository {
  private readonly requests = new Map<string, IdentityResolutionRequest>();

  async createRequest(request: IdentityResolutionRequest): Promise<void> {
    this.requests.set(request.requestId, { ...request });
  }

  async getRequest(requestId: string): Promise<IdentityResolutionRequest | null> {
    const req = this.requests.get(requestId);
    return req ? { ...req } : null;
  }

  async decideRequest(
    requestId: string,
    caseId: string,
    status: 'APPROVED' | 'REJECTED',
    decidedBy: string,
    decisionJustification: string,
    providerReference: string | undefined,
    resolvedAt: string,
  ): Promise<boolean> {
    const req = this.requests.get(requestId);
    if (!req || req.caseId !== caseId || req.status !== 'PENDING') return false;

    this.requests.set(requestId, {
      ...req,
      status,
      decidedBy,
      decisionJustification,
      ...(providerReference ? { providerReference } : {}),
      resolvedAt,
    });
    return true;
  }
}
