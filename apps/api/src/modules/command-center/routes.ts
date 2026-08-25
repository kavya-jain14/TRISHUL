import { AlertLifecycleUpdateRequestSchema, IdentifierSchema } from '@trishul/contracts';
import type { TrustAccessService } from '@trishul/trust';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { InvalidRequestError } from '../../domain/errors.js';
import { bearerToken } from '../trust/guard.js';
import type { CommandCenterService } from './service.js';

function idempotencyKey(request: FastifyRequest): string {
  const value = request.headers['idempotency-key'];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidRequestError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'The Idempotency-Key header is required for this write.',
    );
  }
  return IdentifierSchema.parse(value);
}

export function registerCommandCenterRoutes(
  app: FastifyInstance,
  service: CommandCenterService,
  trust: TrustAccessService,
): void {
  app.get('/api/v1/command-center', async (request) => {
    const session = await trust.authorize(bearerToken(request), 'COMMAND_CENTER_READ');
    return { commandCenter: await service.dashboard(session) };
  });

  app.post<{ Params: { caseId: string } }>(
    '/api/v1/cases/:caseId/priority',
    async (request, reply) => {
      const caseId = IdentifierSchema.parse(request.params.caseId);
      await trust.authorize(bearerToken(request), 'CASE_WRITE', caseId);
      const result = await service.prioritize(caseId, idempotencyKey(request));
      return reply.status(result.replayed ? 200 : 201).send(result);
    },
  );

  app.get<{ Params: { caseId: string } }>(
    '/api/v1/cases/:caseId/priority/latest',
    async (request) => {
      const caseId = IdentifierSchema.parse(request.params.caseId);
      await trust.authorize(bearerToken(request), 'CASE_READ', caseId);
      return { priority: await service.latest(caseId) };
    },
  );

  app.get<{ Params: { caseId: string } }>('/api/v1/cases/:caseId/alerts', async (request) => {
    const caseId = IdentifierSchema.parse(request.params.caseId);
    await trust.authorize(bearerToken(request), 'CASE_READ', caseId);
    return { alerts: await service.alerts(caseId) };
  });

  app.post<{ Params: { caseId: string; alertId: string } }>(
    '/api/v1/cases/:caseId/alerts/:alertId/acknowledge',
    async (request) => {
      const caseId = IdentifierSchema.parse(request.params.caseId);
      const principal = await trust.authorize(bearerToken(request), 'CASE_WRITE', caseId);
      const payload = AlertLifecycleUpdateRequestSchema.parse(request.body);
      return {
        alert: await service.acknowledge(
          caseId,
          request.params.alertId,
          payload.rationale,
          idempotencyKey(request),
          principal,
        ),
      };
    },
  );

  app.post<{ Params: { caseId: string; alertId: string } }>(
    '/api/v1/cases/:caseId/alerts/:alertId/resolve',
    async (request) => {
      const caseId = IdentifierSchema.parse(request.params.caseId);
      const principal = await trust.authorize(bearerToken(request), 'CASE_WRITE', caseId);
      const payload = AlertLifecycleUpdateRequestSchema.parse(request.body);
      return {
        alert: await service.resolve(
          caseId,
          request.params.alertId,
          payload.rationale,
          idempotencyKey(request),
          principal,
        ),
      };
    },
  );
}
