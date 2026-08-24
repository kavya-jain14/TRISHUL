import { Pool } from 'pg';
import { buildApp } from './app.js';
import { InMemoryCaseRepository } from './modules/cases/case-repository.js';
import { CaseService } from './modules/cases/case-service.js';
import { PostgresCaseRepository } from './modules/cases/postgres-case-repository.js';

const port = Number.parseInt(process.env.API_PORT ?? '4000', 10);
const host = process.env.API_HOST ?? '0.0.0.0';
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;
const repository = pool ? new PostgresCaseRepository(pool) : new InMemoryCaseRepository();
const app = buildApp({
  logger: true,
  caseService: new CaseService(repository),
  persistenceMode: pool ? 'POSTGRESQL' : 'IN_MEMORY_DEVELOPMENT_ADAPTER',
});

if (pool) {
  app.addHook('onClose', async () => pool.end());
}

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
