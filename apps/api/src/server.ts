import { Pool } from 'pg';
import { InMemoryCaseActionRepository, PostgresCaseActionRepository } from '@trishul/database';
import { DevelopmentHashchainProvider } from '@trishul/audit';
import { buildApp } from './app.js';
import { InMemoryCaseRepository } from './modules/cases/case-repository.js';
import { CaseService } from './modules/cases/case-service.js';
import { PostgresCaseRepository } from './modules/cases/postgres-case-repository.js';
import { CaseActionService } from './modules/case-actions/service.js';
import { InMemoryEvidenceAnchorRepository } from './modules/evidence-anchors/anchor-repository.js';
import { EvidenceAnchorService } from './modules/evidence-anchors/anchor-service.js';
import { PostgresEvidenceAnchorRepository } from './modules/evidence-anchors/postgres-anchor-repository.js';

const port = Number.parseInt(process.env.API_PORT ?? '4000', 10);
const host = process.env.API_HOST ?? '0.0.0.0';
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;
const repository = pool ? new PostgresCaseRepository(pool) : new InMemoryCaseRepository();
const caseService = new CaseService(repository);
const actionRepository = pool
  ? new PostgresCaseActionRepository(pool)
  : new InMemoryCaseActionRepository();
const anchorRepository = pool
  ? new PostgresEvidenceAnchorRepository(pool)
  : new InMemoryEvidenceAnchorRepository();
const evidenceAnchorService = new EvidenceAnchorService(
  anchorRepository,
  new DevelopmentHashchainProvider(),
  (caseId) => caseService.getCase(caseId),
);
const app = buildApp({
  logger: true,
  caseService,
  caseActionService: new CaseActionService(
    actionRepository,
    (caseId) => caseService.getCase(caseId),
    (anchorId) => evidenceAnchorService.get(anchorId),
  ),
  evidenceAnchorService,
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
