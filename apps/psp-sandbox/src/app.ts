import cors from '@fastify/cors';
import Fastify from 'fastify';
import { ScenarioStore } from './store.js';

export interface SandboxAppOptions {
  corsOrigins?: true | string[];
}

export function buildSandboxApp(store = new ScenarioStore(), options: SandboxAppOptions = {}) {
  const app = Fastify({ logger: false });

  void app.register(cors, {
    origin: options.corsOrigins ?? true,
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  app.get('/api/v1/health', async () => ({
    status: 'ok',
    service: 'trishul-psp-sandbox',
    dataMode: 'DETERMINISTIC_SIMULATION',
  }));

  app.get('/api/v1/scenarios', async () => ({ scenarios: store.list() }));

  app.post<{ Params: { scenarioId: string } }>(
    '/api/v1/scenarios/:scenarioId/reset',
    async (request, reply) => {
      const result = store.reset(request.params.scenarioId);
      if (!result) return reply.status(404).send({ error: 'SCENARIO_NOT_FOUND' });
      return result;
    },
  );

  app.post<{ Params: { scenarioId: string } }>(
    '/api/v1/scenarios/:scenarioId/next',
    async (request, reply) => {
      const result = store.next(request.params.scenarioId);
      if (!result) return reply.status(404).send({ error: 'SCENARIO_NOT_FOUND' });
      return result;
    },
  );

  return app;
}
