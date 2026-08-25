import type { FastifyInstance, FastifyRequest } from 'fastify';
import { InvalidRequestError } from '../../domain/errors.js';
import type { CrossCaseCorrelationService } from './service.js';

function idempotencyKey(request: FastifyRequest): string {
  const value = request.headers['idempotency-key'];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidRequestError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'The Idempotency-Key header is required for this write.',
    );
  }
  return value;
}

export function registerNetworkMemoryRoutes(
  app: FastifyInstance,
  service: CrossCaseCorrelationService,
): void {
  app.post<{ Params: { caseId: string } }>(
    '/api/v1/cases/:caseId/network-correlation',
    async (request, reply) => {
      const result = await service.correlate(request.params.caseId, idempotencyKey(request));
      return reply.status(result.replayed ? 200 : 201).send(result);
    },
  );

  app.get<{ Params: { caseId: string } }>(
    '/api/v1/cases/:caseId/network-correlation/latest',
    async (request) => ({ correlation: await service.latest(request.params.caseId) }),
  );
}
