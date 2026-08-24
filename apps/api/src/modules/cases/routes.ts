import {
  ComplaintSubmissionSchema,
  IdentifierSchema,
  ProviderEventBatchSchema,
  ResolveTransactionRequestSchema,
} from '@trishul/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { InvalidRequestError } from '../../domain/errors.js';
import type { CaseService } from './case-service.js';

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

function caseId(raw: string): string {
  return IdentifierSchema.parse(raw);
}

export function registerCaseRoutes(app: FastifyInstance, service: CaseService): void {
  app.post('/api/v1/complaints', async (request, reply) => {
    const payload = ComplaintSubmissionSchema.parse(request.body);
    const result = await service.createComplaint(payload, idempotencyKey(request));
    return reply.status(result.replayed ? 200 : 201).send({
      case: result.value,
      replayed: result.replayed,
    });
  });

  app.get<{ Params: { caseId: string } }>('/api/v1/cases/:caseId', async (request) => ({
    case: await service.getCase(caseId(request.params.caseId)),
  }));

  app.post<{ Params: { caseId: string } }>(
    '/api/v1/cases/:caseId/resolve-transaction',
    async (request, reply) => {
      const id = caseId(request.params.caseId);
      const event = ResolveTransactionRequestSchema.parse(request.body);
      const result = await service.resolveTransaction(id, event, idempotencyKey(request));
      return reply.send({ case: result.value, replayed: result.replayed });
    },
  );

  app.post<{ Params: { caseId: string } }>(
    '/api/v1/cases/:caseId/provider-events',
    async (request) => {
      const id = caseId(request.params.caseId);
      const batch = ProviderEventBatchSchema.parse(request.body);
      return service.ingestProviderEvents(id, batch, idempotencyKey(request));
    },
  );

  app.post<{ Params: { caseId: string } }>('/api/v1/cases/:caseId/trace', async (request) =>
    service.trace(caseId(request.params.caseId), idempotencyKey(request)),
  );

  app.get<{ Params: { caseId: string } }>('/api/v1/cases/:caseId/graph', async (request) => ({
    graph: await service.getLatestGraph(caseId(request.params.caseId)),
  }));

  app.get<{ Params: { caseId: string } }>('/api/v1/cases/:caseId/ledger', async (request) => ({
    events: await service.getLedger(caseId(request.params.caseId)),
  }));
}
