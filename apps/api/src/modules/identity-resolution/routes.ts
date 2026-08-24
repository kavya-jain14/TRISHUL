import type { FastifyInstance } from 'fastify';
import { IdentityResolutionService } from './identity-resolution-service.js';
import { IdentityResolutionCreateRequestSchema, IdentityResolutionApprovalSchema } from '@trishul/contracts';

export function registerIdentityResolutionRoutes(
  app: FastifyInstance,
  service: IdentityResolutionService
): void {
  app.post('/api/v1/cases/:caseId/identity-resolution', async (request, reply) => {
    // @ts-expect-error - session is attached by guard
    const session = request.trustSession;
    if (!session) {
      return reply.status(401).send({ error: 'TRUST_SESSION_REQUIRED' });
    }

    const { caseId } = request.params as { caseId: string };
    
    // In a real app we'd validate body against IdentityResolutionCreateRequestSchema if we needed more fields
    // IdentityResolutionCreateRequestSchema.parse(request.body);

    const result = await service.requestResolution(caseId, session);
    return reply.status(201).send(result);
  });

  app.post('/api/v1/identity-resolution/:requestId/approve', async (request, reply) => {
    // @ts-expect-error - session is attached by guard
    const session = request.trustSession;
    if (!session) {
      return reply.status(401).send({ error: 'TRUST_SESSION_REQUIRED' });
    }

    const { requestId } = request.params as { requestId: string };
    const body = IdentityResolutionApprovalSchema.parse(request.body);
    
    if (!body.approved) {
      // In a real app, handle rejection
      return reply.status(400).send({ error: 'Rejection not yet implemented' });
    }

    const result = await service.approveResolution(requestId, session);
    return reply.status(200).send(result);
  });
}
