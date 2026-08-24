import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

export interface BuildAppOptions {
  logger?: boolean;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  void app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  app.get('/api/v1/health', async () => ({
    status: 'ok',
    service: 'trishul-api',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  }));

  app.get('/api/v1/system/manifest', async () => ({
    product: 'TRISHUL',
    phase: 'PHASE_0_FOUNDATION',
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
    ],
  }));

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ error }, 'request failed');
    void reply.status(500).send({
      error: 'INTERNAL_ERROR',
      message: 'The request could not be completed.',
    });
  });

  return app;
}
