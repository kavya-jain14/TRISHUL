import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { DomainError } from './domain/errors.js';
import { InMemoryCaseRepository } from './modules/cases/case-repository.js';
import { CaseService } from './modules/cases/case-service.js';
import { registerCaseRoutes } from './modules/cases/routes.js';

export interface BuildAppOptions {
  logger?: boolean;
  caseService?: CaseService;
  persistenceMode?: 'IN_MEMORY_DEVELOPMENT_ADAPTER' | 'POSTGRESQL';
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  void app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  const caseService = options.caseService ?? new CaseService(new InMemoryCaseRepository());
  registerCaseRoutes(app, caseService);

  app.get('/api/v1/health', async () => ({
    status: 'ok',
    service: 'trishul-api',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  }));

  app.get('/api/v1/system/manifest', async () => ({
    product: 'TRISHUL',
    phase: 'PHASE_2_EXPOSURE_RISK_VERTICAL_SLICE',
    persistenceMode: options.persistenceMode ?? 'IN_MEMORY_DEVELOPMENT_ADAPTER',
    doctrine: {
      intentInference: false,
      complaintAsBlacklist: false,
      provenanceRequired: true,
      predictionCanAbstain: true,
    },
    capabilities: [
      'SHARED_CONTRACTS',
      'CASE_STATE_MACHINE',
      'EXPOSURE_RANGE',
      'MULE_RISK_POLICY',
      'EVIDENCE_GATE',
      'DETERMINISTIC_PSP_SANDBOX',
      'COMPLAINT_TO_TRACE_VERTICAL_SLICE',
      'VERSIONED_ATTRIBUTABLE_EXPOSURE',
      'EXPLAINABLE_ACCOUNT_RISK',
    ],
  }));

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
        details: error.details,
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'The request did not match the required contract.',
        details: error.flatten(),
      });
    }

    request.log.error({ error }, 'request failed');
    void reply.status(500).send({
      error: 'INTERNAL_ERROR',
      message: 'The request could not be completed.',
    });
  });

  return app;
}
