import {
  AccountRiskRequestSchema,
  ComplaintSubmissionSchema,
  ExposureRecomputeRequestSchema,
  ExitModeRequestSchema,
  ForecastEvidenceRequestSchema,
  ForecastRunRequestSchema,
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

  app.post<{ Params: { caseId: string } }>(
    '/api/v1/cases/:caseId/recompute-exposure',
    async (request) => {
      const id = caseId(request.params.caseId);
      const payload = ExposureRecomputeRequestSchema.parse(request.body);
      const result = await service.recomputeExposure(id, payload, idempotencyKey(request));
      return { exposure: result.value, replayed: result.replayed };
    },
  );

  app.get<{ Params: { caseId: string } }>('/api/v1/cases/:caseId/exposure', async (request) => ({
    exposure: await service.getLatestExposure(caseId(request.params.caseId)),
  }));

  app.post<{ Params: { accountId: string } }>(
    '/api/v1/accounts/:accountId/risk',
    async (request) => {
      const accountId = caseId(request.params.accountId);
      const payload = AccountRiskRequestSchema.parse(request.body);
      const result = await service.assessAccountRisk(accountId, payload, idempotencyKey(request));
      return { assessment: result.value, replayed: result.replayed };
    },
  );

  app.get<{ Params: { caseId: string } }>(
    '/api/v1/cases/:caseId/risk-snapshots',
    async (request) => ({
      caseId: caseId(request.params.caseId),
      assessments: await service.getRiskSnapshots(caseId(request.params.caseId)),
    }),
  );

  app.post<{ Params: { caseId: string } }>('/api/v1/cases/:caseId/exit-mode', async (request) => {
    const id = caseId(request.params.caseId);
    const payload = ExitModeRequestSchema.parse(request.body);
    const result = await service.assessExitMode(id, payload, idempotencyKey(request));
    return { exitMode: result.value, replayed: result.replayed };
  });

  app.get<{ Params: { caseId: string } }>(
    '/api/v1/cases/:caseId/exit-mode/latest',
    async (request) => ({
      exitMode: await service.getLatestExitMode(caseId(request.params.caseId)),
    }),
  );

  app.post<{ Params: { caseId: string } }>('/api/v1/cases/:caseId/forecast', async (request) => {
    const id = caseId(request.params.caseId);
    const payload = ForecastEvidenceRequestSchema.parse(request.body);
    const result = await service.evaluateForecastEvidence(id, payload, idempotencyKey(request));
    return { evidenceGate: result.value, replayed: result.replayed };
  });

  app.get<{ Params: { caseId: string } }>(
    '/api/v1/cases/:caseId/forecast/latest',
    async (request) => ({
      evidenceGate: await service.getLatestForecastEvidence(caseId(request.params.caseId)),
    }),
  );

  app.post<{ Params: { caseId: string } }>('/api/v1/cases/:caseId/predictions', async (request) => {
    const id = caseId(request.params.caseId);
    const payload = ForecastRunRequestSchema.parse(request.body);
    const result = await service.runForecast(id, payload, idempotencyKey(request));
    return { forecast: result.value, replayed: result.replayed };
  });

  app.get<{ Params: { caseId: string } }>(
    '/api/v1/cases/:caseId/predictions/latest',
    async (request) => ({
      forecast: await service.getLatestForecast(caseId(request.params.caseId)),
    }),
  );
}
