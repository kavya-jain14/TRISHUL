import cors from '@fastify/cors';
import { DevelopmentHashchainProvider } from '@trishul/audit';
import { InMemoryTrustRepository, TrustAccessError, TrustAccessService } from '@trishul/trust';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { DomainError } from './domain/errors.js';
import {
  InMemoryCaseActionRepository,
  InMemoryCommandCenterRepository,
  InMemoryNetworkMemoryRepository,
  InMemoryPaymentRiskRepository,
  type NetworkMemoryRepository,
  CommandCenterConflictError,
} from '@trishul/database';
import { registerCaseActionRoutes } from './modules/case-actions/routes.js';
import { CaseActionService } from './modules/case-actions/service.js';
import { InMemoryCaseRepository } from './modules/cases/case-repository.js';
import { CaseService } from './modules/cases/case-service.js';
import { registerCaseRoutes } from './modules/cases/routes.js';
import { InMemoryEvidenceAnchorRepository } from './modules/evidence-anchors/anchor-repository.js';
import { EvidenceAnchorService } from './modules/evidence-anchors/anchor-service.js';
import { registerEvidenceAnchorRoutes } from './modules/evidence-anchors/routes.js';
import { registerTrustAccessGuard } from './modules/trust/guard.js';
import { registerTrustRoutes } from './modules/trust/routes.js';
import {
  IdentityResolutionError,
  IdentityResolutionService,
  ReferenceOnlyDevelopmentIdentityProvider,
} from './modules/identity-resolution/identity-resolution-service.js';
import { InMemoryIdentityResolutionRepository } from './modules/identity-resolution/in-memory-identity-resolution-repository.js';
import { registerIdentityResolutionRoutes } from './modules/identity-resolution/routes.js';
import { registerPaymentRiskRoutes } from './modules/payment-risk/routes.js';
import { PaymentRiskService } from './modules/payment-risk/service.js';
import { registerNetworkMemoryRoutes } from './modules/network-memory/routes.js';
import { CrossCaseCorrelationService } from './modules/network-memory/service.js';
import { registerCommandCenterRoutes } from './modules/command-center/routes.js';
import { CommandCenterService } from './modules/command-center/service.js';

export interface BuildAppOptions {
  logger?: boolean;
  caseService?: CaseService;
  evidenceAnchorService?: EvidenceAnchorService;
  caseActionService?: CaseActionService;
  trustAccessService?: TrustAccessService;
  identityResolutionService?: IdentityResolutionService;
  paymentRiskService?: PaymentRiskService;
  networkMemoryRepository?: NetworkMemoryRepository;
  crossCaseCorrelationService?: CrossCaseCorrelationService;
  commandCenterService?: CommandCenterService;
  enforcePaymentRiskServiceToken?: boolean;
  paymentRiskServiceToken?: string;
  enforceTrustAccess?: boolean;
  persistenceMode?: 'IN_MEMORY_DEVELOPMENT_ADAPTER' | 'POSTGRESQL';
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  void app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  const networkMemoryRepository =
    options.networkMemoryRepository ?? new InMemoryNetworkMemoryRepository();
  const caseService =
    options.caseService ??
    new CaseService(new InMemoryCaseRepository(), undefined, (caseId, graphVersion, accountId) =>
      networkMemoryRepository.latestSignal(caseId, graphVersion, accountId),
    );
  const trustAccessService =
    options.trustAccessService ?? new TrustAccessService(new InMemoryTrustRepository());
  if (options.enforceTrustAccess) registerTrustAccessGuard(app, trustAccessService);
  const evidenceAnchorService =
    options.evidenceAnchorService ??
    new EvidenceAnchorService(
      new InMemoryEvidenceAnchorRepository(),
      new DevelopmentHashchainProvider(),
      (caseId) => caseService.getCase(caseId),
    );
  const caseActionService =
    options.caseActionService ??
    new CaseActionService(
      new InMemoryCaseActionRepository(),
      (caseId) => caseService.getCase(caseId),
      (anchorId) => evidenceAnchorService.get(anchorId),
    );
  registerCaseRoutes(app, caseService);
  const crossCaseCorrelationService =
    options.crossCaseCorrelationService ??
    new CrossCaseCorrelationService(networkMemoryRepository, (caseId) =>
      caseService.getLatestGraph(caseId),
    );
  registerNetworkMemoryRoutes(app, crossCaseCorrelationService);
  const commandCenterService =
    options.commandCenterService ??
    new CommandCenterService(new InMemoryCommandCenterRepository(), caseService);
  registerCommandCenterRoutes(app, commandCenterService, trustAccessService);
  registerCaseActionRoutes(app, caseActionService, trustAccessService);
  registerEvidenceAnchorRoutes(app, evidenceAnchorService);
  registerTrustRoutes(app, trustAccessService);

  const identityResolutionService =
    options.identityResolutionService ??
    new IdentityResolutionService(
      new InMemoryIdentityResolutionRepository(),
      new ReferenceOnlyDevelopmentIdentityProvider(),
      (caseId) => caseService.getCase(caseId),
    );
  registerIdentityResolutionRoutes(app, identityResolutionService, trustAccessService);
  const paymentRiskService =
    options.paymentRiskService ?? new PaymentRiskService(new InMemoryPaymentRiskRepository());
  registerPaymentRiskRoutes(app, paymentRiskService, {
    ...(options.enforcePaymentRiskServiceToken !== undefined
      ? { enforceServiceToken: options.enforcePaymentRiskServiceToken }
      : {}),
    ...(options.paymentRiskServiceToken ? { serviceToken: options.paymentRiskServiceToken } : {}),
  });

  app.get('/api/v1/health', async () => ({
    status: 'ok',
    service: 'trishul-api',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  }));

  app.get('/api/v1/system/manifest', async () => ({
    product: 'TRISHUL',
    phase: 'PHASE_7_COMMAND_CENTER_ALERTS',
    persistenceMode: options.persistenceMode ?? 'IN_MEMORY_DEVELOPMENT_ADAPTER',
    trustAccessMode: options.enforceTrustAccess ? 'ENFORCED' : 'OPTIONAL_DEVELOPMENT_ADAPTER',
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
      'DURABLE_CASE_ACTION_EVENTS',
      'PII_FREE_EVIDENCE_ANCHORING',
      'TAMPER_EVIDENT_VERIFICATION',
      'REPLACEABLE_BLOCKCHAIN_PROVIDER',
      'ISSUER_SIGNED_CREDENTIALS',
      'SUBJECT_BOUND_CHALLENGE_PROOF',
      'CAPABILITY_AND_CASE_SCOPED_ACCESS',
      'REPLAY_SAFE_NONCE_VERIFICATION',
      'TWO_PERSON_IDENTITY_RESOLUTION',
      'REFERENCE_ONLY_IDENTITY_RESPONSE',
      'EXPLAINABLE_PRE_PAYMENT_RISK',
      'PAYER_STEP_UP_DECISION',
      'TRUST_RISK_SEPARATION',
      'DURABLE_PAYMENT_RISK_HISTORY',
      'CROSS_CASE_NETWORK_MEMORY',
      'OPAQUE_CASE_CORRELATION',
      'TRUSTED_OUTCOME_WEIGHTING',
      'INTERNAL_CORRELATION_TO_MULE_RISK',
      'DETERMINISTIC_CASE_PRIORITY',
      'OPERATIONAL_INTERVENTION_STATES',
      'TRUST_SCOPED_COMMAND_CENTER',
      'DURABLE_ALERT_LIFECYCLE',
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

    if (error instanceof TrustAccessError) {
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
        reasonCodes: error.reasonCodes,
      });
    }

    if (error instanceof CommandCenterConflictError) {
      const statusCode = error.code.endsWith('NOT_FOUND') ? 404 : 409;
      return reply.status(statusCode).send({
        error: error.code,
        message: error.message,
      });
    }

    if (error instanceof IdentityResolutionError) {
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
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
