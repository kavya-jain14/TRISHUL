import { IdentifierSchema } from '@trishul/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { InvalidRequestError } from '../../domain/errors.js';
import type { CaseActionService } from './service.js';

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

export function registerCaseActionRoutes(app: FastifyInstance, service: CaseActionService): void {
  app.post<{ Params: { caseId: string } }>(
    '/api/v1/cases/:caseId/actions',
    async (request, reply) => {
      const result = await service.record(
        IdentifierSchema.parse(request.params.caseId),
        request.body,
        idempotencyKey(request),
      );
      return reply.status(result.replayed ? 200 : 201).send(result);
    },
  );

  app.get<{ Params: { caseId: string } }>('/api/v1/cases/:caseId/actions', async (request) => ({
    actions: await service.list(IdentifierSchema.parse(request.params.caseId)),
  }));
}
