import cors from '@fastify/cors';
import { DevelopmentHashchainProvider } from '@trishul/audit';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { DomainError } from './domain/errors.js';
import { InMemoryCaseRepository } from './modules/cases/case-repository.js';
import { CaseService } from './modules/cases/case-service.js';
import { registerCaseRoutes } from './modules/cases/routes.js';
import { InMemoryEvidenceAnchorRepository } from './modules/evidence-anchors/anchor-repository.js';
import { EvidenceAnchorService } from './modules/evidence-anchors/anchor-service.js';
import { registerEvidenceAnchorRoutes } from './modules/evidence-anchors/routes.js';

export interface BuildAppOptions {
  logger?: boolean;
  caseService?: CaseService;
  evidenceAnchorService?: EvidenceAnchorService;
  persistenceMode?: 'IN_MEMORY_DEVELOPMENT_ADAPTER' | 'POSTGRESQL';
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  void app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  const caseService = options.caseService ?? new CaseService(new InMemoryCaseRepository());
  const evidenceAnchorService =
    options.evidenceAnchorService ??
    new EvidenceAnchorService(
      new InMemoryEvidenceAnchorRepository(),
      new DevelopmentHashchainProvider(),
      (caseId) => caseService.getCase(caseId),
    );
  registerCaseRoutes(app, caseService);
  registerEvidenceAnchorRoutes(app, evidenceAnchorService);

  app.get('/api/v1/health', async () => ({
    status: 'ok',
    service: 'trishul-api',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  }));

  app.get('/api/v1/system/manifest', async () => ({
    product: 'TRISHUL',
    phase: 'PHASE_4_ZONE_TIME_REFORECAST',
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
      'VERSIONED_EXIT_MODE',
      'INDEPENDENT_EVIDENCE_GATE',
      'INTENTIONAL_ABSTENTION',
      'TOP_K_GEO_FORECAST',
      'TIME_HORIZON_FORECAST',
      'VERSIONED_REFORECAST',
      'PII_FREE_EVIDENCE_ANCHORING',
      'TAMPER_EVIDENT_VERIFICATION',
      'REPLACEABLE_BLOCKCHAIN_PROVIDER',
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
