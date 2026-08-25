import { Pool } from 'pg';
import {
  InMemoryCaseActionRepository,
  InMemoryCommandCenterRepository,
  InMemoryNetworkMemoryRepository,
  InMemoryPaymentRiskRepository,
  PostgresCaseActionRepository,
  PostgresCommandCenterRepository,
  PostgresNetworkMemoryRepository,
  PostgresPaymentRiskRepository,
} from '@trishul/database';
import { PostgresIdentityResolutionRepository, PostgresTrustRepository } from '@trishul/database';
import { InMemoryTrustRepository } from '@trishul/trust';
import { buildApp } from './app.js';
import { InMemoryCaseRepository } from './modules/cases/case-repository.js';
import { CaseService } from './modules/cases/case-service.js';
import { PostgresCaseRepository } from './modules/cases/postgres-case-repository.js';
import { CaseActionService } from './modules/case-actions/service.js';
import { InMemoryEvidenceAnchorRepository } from './modules/evidence-anchors/anchor-repository.js';
import { EvidenceAnchorService } from './modules/evidence-anchors/anchor-service.js';
import { PostgresEvidenceAnchorRepository } from './modules/evidence-anchors/postgres-anchor-repository.js';
import { evidenceAnchorProviderFromEnvironment } from './modules/evidence-anchors/provider.js';
import { InMemoryIdentityResolutionRepository } from './modules/identity-resolution/in-memory-identity-resolution-repository.js';
import {
  IdentityResolutionService,
  ReferenceOnlyDevelopmentIdentityProvider,
  UnavailableIdentityResolutionProvider,
} from './modules/identity-resolution/identity-resolution-service.js';
import { trustAccessRuntimeFromEnvironment } from './modules/trust/runtime.js';
import { PaymentRiskService } from './modules/payment-risk/service.js';
import { CrossCaseCorrelationService } from './modules/network-memory/service.js';
import { CommandCenterService } from './modules/command-center/service.js';

const port = Number.parseInt(process.env.API_PORT ?? '4000', 10);
const host = process.env.API_HOST ?? '0.0.0.0';
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;
const repository = pool ? new PostgresCaseRepository(pool) : new InMemoryCaseRepository();
const networkMemoryRepository = pool
  ? new PostgresNetworkMemoryRepository(pool)
  : new InMemoryNetworkMemoryRepository();
const caseService = new CaseService(repository, undefined, (caseId, graphVersion, accountId) =>
  networkMemoryRepository.latestSignal(caseId, graphVersion, accountId),
);
const actionRepository = pool
  ? new PostgresCaseActionRepository(pool)
  : new InMemoryCaseActionRepository();
const anchorRepository = pool
  ? new PostgresEvidenceAnchorRepository(pool)
  : new InMemoryEvidenceAnchorRepository();
const evidenceAnchorService = new EvidenceAnchorService(
  anchorRepository,
  evidenceAnchorProviderFromEnvironment(),
  (caseId) => caseService.getCase(caseId),
);
const trustRepository = pool ? new PostgresTrustRepository(pool) : new InMemoryTrustRepository();
const trustRuntime = await trustAccessRuntimeFromEnvironment(process.env, {
  repository: trustRepository,
  durablePersistence: Boolean(pool),
});
const identityRepository = pool
  ? new PostgresIdentityResolutionRepository(pool)
  : new InMemoryIdentityResolutionRepository();
const identityProvider =
  process.env.NODE_ENV === 'production'
    ? new UnavailableIdentityResolutionProvider()
    : new ReferenceOnlyDevelopmentIdentityProvider();
const paymentRiskRepository = pool
  ? new PostgresPaymentRiskRepository(pool)
  : new InMemoryPaymentRiskRepository();
const commandCenterRepository = pool
  ? new PostgresCommandCenterRepository(pool)
  : new InMemoryCommandCenterRepository();
const enforcePaymentRiskServiceToken = process.env.NODE_ENV === 'production';
const paymentRiskServiceToken = process.env.TRISHUL_INTERNAL_SERVICE_TOKEN;
if (enforcePaymentRiskServiceToken && !paymentRiskServiceToken) {
  throw new Error('TRISHUL_INTERNAL_SERVICE_TOKEN is required in production.');
}
const app = buildApp({
  logger: true,
  caseService,
  caseActionService: new CaseActionService(
    actionRepository,
    (caseId) => caseService.getCase(caseId),
    (anchorId) => evidenceAnchorService.get(anchorId),
  ),
  evidenceAnchorService,
  trustAccessService: trustRuntime.service,
  enforceTrustAccess: trustRuntime.enforceTrustAccess,
  identityResolutionService: new IdentityResolutionService(
    identityRepository,
    identityProvider,
    (caseId) => caseService.getCase(caseId),
  ),
  paymentRiskService: new PaymentRiskService(paymentRiskRepository),
  commandCenterService: new CommandCenterService(commandCenterRepository, caseService),
  networkMemoryRepository,
  crossCaseCorrelationService: new CrossCaseCorrelationService(networkMemoryRepository, (caseId) =>
    caseService.getLatestGraph(caseId),
  ),
  enforcePaymentRiskServiceToken,
  ...(paymentRiskServiceToken ? { paymentRiskServiceToken } : {}),
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
