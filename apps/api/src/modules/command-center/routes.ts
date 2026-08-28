import { AlertLifecycleUpdateRequestSchema, IdentifierSchema } from '@trishul/contracts';
import type { TrustAccessService } from '@trishul/trust';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { InvalidRequestError } from '../../domain/errors.js';
import { bearerToken } from '../trust/guard.js';
import type { CommandCenterService } from './service.js';

export interface CommandCenterRouteOptions {
  syntheticDemoCaseIds?: readonly string[];
}

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
  options: CommandCenterRouteOptions = {},
): void {
  app.get('/api/v1/command-center', async (request) => {
    const session = await authorize(
      request,
      trust,
      'COMMAND_CENTER_READ',
      undefined,
      options.syntheticDemoCaseIds,
    );
    return { commandCenter: await service.dashboard(session) };
  });

  app.post<{ Params: { caseId: string } }>(
    '/api/v1/cases/:caseId/priority',
    async (request, reply) => {
      const caseId = IdentifierSchema.parse(request.params.caseId);
      await authorize(request, trust, 'CASE_WRITE', caseId, options.syntheticDemoCaseIds);
      const result = await service.prioritize(caseId, idempotencyKey(request));
      return reply.status(result.replayed ? 200 : 201).send(result);
    },
  );

  app.get<{ Params: { caseId: string } }>(
    '/api/v1/cases/:caseId/priority/latest',
    async (request) => {
      const caseId = IdentifierSchema.parse(request.params.caseId);
      await authorize(request, trust, 'CASE_READ', caseId, options.syntheticDemoCaseIds);
      return { priority: await service.latest(caseId) };
    },
  );

  app.get<{ Params: { caseId: string } }>('/api/v1/cases/:caseId/alerts', async (request) => {
    const caseId = IdentifierSchema.parse(request.params.caseId);
    await authorize(request, trust, 'CASE_READ', caseId, options.syntheticDemoCaseIds);
    return { alerts: await service.alerts(caseId) };
  });

  app.post<{ Params: { caseId: string; alertId: string } }>(
    '/api/v1/cases/:caseId/alerts/:alertId/acknowledge',
    async (request) => {
      const caseId = IdentifierSchema.parse(request.params.caseId);
      const principal = await authorize(
        request,
        trust,
        'CASE_WRITE',
        caseId,
        options.syntheticDemoCaseIds,
      );
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
      const principal = await authorize(
        request,
        trust,
        'CASE_WRITE',
        caseId,
        options.syntheticDemoCaseIds,
      );
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

async function authorize(
  request: FastifyRequest,
  trust: TrustAccessService,
  capability: 'COMMAND_CENTER_READ' | 'CASE_READ' | 'CASE_WRITE',
  caseId: string | undefined,
  syntheticDemoCaseIds: readonly string[] | undefined,
) {
  const authorization = request.headers.authorization;
  if (authorization) return trust.authorize(bearerToken(request), capability, caseId);
  const scopedCaseIds = syntheticDemoCaseIds ?? [];
  if (!scopedCaseIds.length || (caseId && !scopedCaseIds.includes(caseId))) {
    return trust.authorize(bearerToken(request), capability, caseId);
  }
  const now = new Date();
  return {
    sessionId: '00000000-0000-4000-8000-000000000001',
    subjectId: 'operator:golden-synthetic-demo',
    role: 'INVESTIGATOR' as const,
    capabilities: [capability],
    purpose: 'FRAUD_INVESTIGATION' as const,
    ...(caseId ? { caseId } : {}),
    caseIds: [...scopedCaseIds],
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
  };
}
