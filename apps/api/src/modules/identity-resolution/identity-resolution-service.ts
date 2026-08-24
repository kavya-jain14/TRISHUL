import type { IdentityResolutionRepository } from '@trishul/database';
import { randomUUID } from 'crypto';
import type { TrustSession, IdentityResolutionRequest, IdentityResolutionResult } from '@trishul/contracts';

export class IdentityResolutionService {
  constructor(private readonly repository: IdentityResolutionRepository) {}

  async requestResolution(caseId: string, investigatorSession: TrustSession): Promise<IdentityResolutionRequest> {
    if (!investigatorSession.capabilities.includes('IDENTITY_RESOLUTION')) {
      throw new Error('Investigator does not have the IDENTITY_RESOLUTION capability.');
    }
    
    // In a real implementation, we might check if the case belongs to the investigator's tenant.
    // For this demo, we assume the TrustAccessGuard has already enforced case scoping.
    
    const request: IdentityResolutionRequest = {
      requestId: randomUUID(),
      caseId,
      investigatorId: investigatorSession.subjectId,
      status: 'PENDING',
      requestedAt: new Date().toISOString(),
    };

    await this.repository.createRequest(request);
    return request;
  }

  async approveResolution(requestId: string, supervisorSession: TrustSession): Promise<IdentityResolutionResult> {
    if (supervisorSession.role !== 'SUPERVISOR' && supervisorSession.role !== 'LEA_OFFICER') {
      throw new Error('Only a SUPERVISOR or LEA_OFFICER can approve an identity resolution request.');
    }

    const request = await this.repository.getRequest(requestId);
    if (!request) {
      throw new Error('Identity resolution request not found.');
    }

    if (request.status !== 'PENDING') {
      throw new Error(`Cannot approve request in status: ${request.status}`);
    }

    // Two-person rule: A supervisor cannot approve their own request if they were acting as the investigator.
    if (request.investigatorId === supervisorSession.subjectId) {
      throw new Error('A supervisor cannot approve their own identity resolution request.');
    }

    // Approve the request
    const providerReference = `provider-ref-${randomUUID()}`;
    const resolvedAt = new Date().toISOString();
    
    await this.repository.updateRequestStatus(
      requestId,
      'APPROVED',
      supervisorSession.subjectId,
      providerReference,
      resolvedAt
    );

    // Mock Bank Resolution Adapter: Return simulated PII payload
    return {
      requestId,
      status: 'APPROVED',
      pii: {
        name: 'John Doe',
        address: '123 Fake Street, Faketown',
        nationalId: 'ID-987654321',
      }
    };
  }
}
