import {
  IdentifierSchema,
  IdentityResolutionApprovalSchema,
  IdentityResolutionCreateRequestSchema,
} from '@trishul/contracts';
import type { TrustAccessService } from '@trishul/trust';
import type { FastifyInstance } from 'fastify';
import { authorizeBearerRequest } from '../trust/guard.js';
import type { IdentityResolutionService } from './identity-resolution-service.js';

export function registerIdentityResolutionRoutes(
  app: FastifyInstance,
  service: IdentityResolutionService,
  trustAccessService: TrustAccessService,
): void {
  app.post('/api/v1/cases/:caseId/identity-resolution', async (request, reply) => {
    const { caseId: rawCaseId } = request.params as { caseId: string };
    const caseId = IdentifierSchema.parse(rawCaseId);
    const body = IdentityResolutionCreateRequestSchema.parse(request.body);
    const session = await authorizeBearerRequest(
      request,
      trustAccessService,
      'IDENTITY_RESOLUTION_REQUEST',
      caseId,
    );
    const result = await service.requestResolution(caseId, body.justification, session);
    return reply.status(201).send(result);
  });

  app.post(
    '/api/v1/cases/:caseId/identity-resolution/:requestId/decision',
    async (request, reply) => {
      const params = request.params as { caseId: string; requestId: string };
      const caseId = IdentifierSchema.parse(params.caseId);
      const requestId = params.requestId;
      const body = IdentityResolutionApprovalSchema.parse(request.body);
      const session = await authorizeBearerRequest(
        request,
        trustAccessService,
        'IDENTITY_RESOLUTION_APPROVE',
        caseId,
      );
      const result = await service.decideResolution(
        caseId,
        requestId,
        body.decision,
        body.justification,
        session,
      );
      return reply.status(200).send(result);
    },
  );
}
