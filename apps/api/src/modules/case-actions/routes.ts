import { IdentifierSchema } from '@trishul/contracts';
import type { TrustAccessService } from '@trishul/trust';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { InvalidRequestError } from '../../domain/errors.js';
import { bearerToken } from '../trust/guard.js';
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

export function registerCaseActionRoutes(
  app: FastifyInstance,
  service: CaseActionService,
  trust: TrustAccessService,
): void {
  app.post<{ Params: { caseId: string } }>(
    '/api/v1/cases/:caseId/actions',
    async (request, reply) => {
      const id = IdentifierSchema.parse(request.params.caseId);
      const session = trust.authorize(bearerToken(request), 'CASE_WRITE', id);
      const result = await service.record(id, request.body, idempotencyKey(request), session);
      return reply.status(result.replayed ? 200 : 201).send(result);
    },
  );

  app.get<{ Params: { caseId: string } }>('/api/v1/cases/:caseId/actions', async (request) => {
    const id = IdentifierSchema.parse(request.params.caseId);
    trust.authorize(bearerToken(request), 'CASE_READ', id);
    return { actions: await service.list(id) };
  });
}
