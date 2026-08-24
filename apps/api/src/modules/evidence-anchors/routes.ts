import {
  EvidenceAnchorRequestSchema,
  EvidenceVerificationRequestSchema,
  IdentifierSchema,
} from '@trishul/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { InvalidRequestError } from '../../domain/errors.js';
import type { EvidenceAnchorService } from './anchor-service.js';

function idempotencyKey(request: FastifyRequest): string {
  const value = request.headers['idempotency-key'];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidRequestError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'The Idempotency-Key header is required for this write',
    );
  }
  return value;
}

export function registerEvidenceAnchorRoutes(
  app: FastifyInstance,
  service: EvidenceAnchorService,
): void {
  app.post<{ Params: { caseId: string } }>(
    '/api/v1/cases/:caseId/evidence-anchors',
    async (request, reply) => {
      const caseId = IdentifierSchema.parse(request.params.caseId);
      const payload = EvidenceAnchorRequestSchema.parse(request.body);
      const result = await service.anchor(caseId, payload, idempotencyKey(request));
      return reply.status(result.replayed ? 200 : 201).send(result);
    },
  );

  app.get<{ Params: { anchorId: string } }>(
    '/api/v1/evidence-anchors/:anchorId',
    async (request) => ({
      receipt: await service.get(IdentifierSchema.parse(request.params.anchorId)),
    }),
  );

  app.post<{ Params: { anchorId: string } }>(
    '/api/v1/evidence-anchors/:anchorId/verify',
    async (request) => {
      const anchorId = IdentifierSchema.parse(request.params.anchorId);
      return service.verify(anchorId, EvidenceVerificationRequestSchema.parse(request.body));
    },
  );
}
