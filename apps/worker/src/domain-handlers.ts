import {
  EvidenceAnchorJobSchema,
  ExposureRecomputationJobSchema,
  ForecastRefreshJobSchema,
  RiskReassessmentJobSchema,
  TraceGraphExpansionJobSchema,
} from '@trishul/contracts';
import type { OutboxJobType } from '@trishul/database';
import type { CaseOperations } from './api-client.js';
import type { StructuredLogger } from './logger.js';
import type { JobHandler } from './runtime.js';

export function createDomainHandlers(
  operations: CaseOperations,
  logger: StructuredLogger,
): Partial<Record<OutboxJobType, JobHandler>> {
  return {
    TRACE_GRAPH_EXPANSION: async (payload) => {
      const job = TraceGraphExpansionJobSchema.parse(payload);
      await operations.trace(job);
      completed(logger, 'trace_graph_expansion_dispatched', job.caseId);
    },
    EXPOSURE_RECOMPUTE: async (payload) => {
      const job = ExposureRecomputationJobSchema.parse(payload);
      await operations.recomputeExposure(job);
      completed(logger, 'exposure_recomputation_dispatched', job.caseId);
    },
    RISK_REASSESSMENT: async (payload) => {
      const job = RiskReassessmentJobSchema.parse(payload);
      await operations.reassessRisk(job);
      completed(logger, 'risk_reassessment_dispatched', job.request.caseId, {
        accountId: job.accountId,
      });
    },
    FORECAST_REFRESH: async (payload) => {
      const job = ForecastRefreshJobSchema.parse(payload);
      await operations.refreshForecast(job);
      completed(logger, 'forecast_refresh_dispatched', job.caseId, {
        accountId: job.forecast.request.accountId,
      });
    },
    EVIDENCE_ANCHOR: async (payload) => {
      const job = EvidenceAnchorJobSchema.parse(payload);
      await operations.anchorEvidence(job);
      completed(logger, 'evidence_anchor_dispatched', job.caseId, {
        evidenceRef: job.request.evidenceRef,
      });
    },
  };
}

function completed(
  logger: StructuredLogger,
  event: string,
  caseId: string,
  fields: Record<string, unknown> = {},
): void {
  logger.log('info', event, {
    deliveryMode: 'CANONICAL_API',
    caseId,
    ...fields,
  });
}
