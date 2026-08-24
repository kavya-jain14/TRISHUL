import type { IdentityResolutionRepository } from '@trishul/database';
import type { IdentityResolutionRequest, IdentityResolutionStatus } from '@trishul/contracts';

export class InMemoryIdentityResolutionRepository implements IdentityResolutionRepository {
  private readonly requests = new Map<string, IdentityResolutionRequest>();

  async createRequest(request: IdentityResolutionRequest): Promise<void> {
    this.requests.set(request.requestId, { ...request });
  }

  async getRequest(requestId: string): Promise<IdentityResolutionRequest | null> {
    const req = this.requests.get(requestId);
    return req ? { ...req } : null;
  }

  async updateRequestStatus(
    requestId: string,
    status: IdentityResolutionStatus,
    supervisorId?: string,
    providerReference?: string,
    resolvedAt?: string
  ): Promise<boolean> {
    const req = this.requests.get(requestId);
    if (!req) return false;

    req.status = status;
    if (supervisorId) req.supervisorId = supervisorId;
    if (providerReference) req.providerReference = providerReference;
    if (resolvedAt) req.resolvedAt = resolvedAt;

    this.requests.set(requestId, req);
    return true;
  }
}
