import { hashEvidence } from '@trishul/audit';
import {
  AccountRiskRequestSchema,
  CaseDetailSchema,
  ComplaintSubmissionSchema,
  EvidenceGateSnapshotSchema,
  ExposureRecomputeRequestSchema,
  ExposureSnapshotSchema,
  ExitModeRequestSchema,
  ExitModeSnapshotSchema,
  ForecastEvidenceRequestSchema,
  ForecastRunRequestSchema,
  ForecastSnapshotSchema,
  IdempotencyKeySchema,
  MuleAssessmentSnapshotSchema,
  ProviderEventBatchSchema,
  ProviderEventIngestResultSchema,
  ResolveTransactionRequestSchema,
  TraceRunResultSchema,
  assertCaseTransition,
  type CaseDetail,
  type ComplaintSubmission,
  type EvidenceGateSnapshot,
  type ExposureSnapshot,
  type ExitModeSnapshot,
  type ForecastSnapshot,
  type GraphSnapshot,
  type MuleAssessmentSnapshot,
  type ProviderEvent,
  type ProviderEventIngestResult,
  type TraceRunResult,
} from '@trishul/contracts';
import type { CrossCaseSignalReference } from '@trishul/database';
import { buildTraceGraph, calculateGraphExposure } from '@trishul/graph';
import { assessMuleRisk, deriveMuleRiskFeatures } from '@trishul/intelligence';
import {
  deriveExitModeFeatures,
  evaluateEvidenceGate,
  rankExitModes,
  rankGeoZones,
  rankTimeHorizons,
} from '@trishul/prediction';
import { ConflictError, InvalidRequestError, NotFoundError } from '../../domain/errors.js';
import type { CaseRecord, CaseRepository, IdempotencyRecord } from './case-repository.js';

type Clock = () => string;
type CrossCaseSignalLookup = (
  caseId: string,
  graphVersion: number,
  accountId: string,
) => Promise<CrossCaseSignalReference | null>;

interface ReplayResult<T> {
  value: T;
  replayed: boolean;
}

function sameCaseEvent(event: ProviderEvent, caseId: string): void {
  if (event.caseId !== caseId) {
    throw new InvalidRequestError(
      'CASE_EVENT_MISMATCH',
      `Provider event ${event.eventId} belongs to ${event.caseId}, not ${caseId}`,
    );
  }
}

export class CaseService {
  constructor(
    private readonly repository: CaseRepository,
    private readonly clock: Clock = () => new Date().toISOString(),
    private readonly crossCaseSignalLookup: CrossCaseSignalLookup = async () => null,
  ) {}

  async createComplaint(
    rawPayload: unknown,
    rawIdempotencyKey: unknown,
  ): Promise<ReplayResult<CaseDetail>> {
    const payload = ComplaintSubmissionSchema.parse(rawPayload);
    const idempotencyKey = IdempotencyKeySchema.parse(rawIdempotencyKey);
    const operation = 'complaint:create';
    const requestHash = hashEvidence(payload);
    const replay = await this.readReplay<CaseDetail>(operation, idempotencyKey, requestHash);
    if (replay) return { value: CaseDetailSchema.parse(replay), replayed: true };

    const duplicateComplaint = await this.repository.findCaseByComplaintId(payload.complaintId);
    if (duplicateComplaint) {
      throw new ConflictError(
        'COMPLAINT_ALREADY_EXISTS',
        `Complaint ${payload.complaintId} already exists; replay it with its original idempotency key`,
      );
    }

    const timestamp = this.clock();
    const record: CaseRecord = {
      summary: {
        caseId: `case:${payload.complaintId}`,
        complaintId: payload.complaintId,
        state: 'REPORTED',
        originalTransactionRef: payload.originalTransactionRef,
        graphVersion: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      complaint: payload,
      resolvedBeneficiaryAccount: null,
      providerEvents: [],
      providerEventHashes: {},
      processedEventIds: [],
      graphVersions: [],
      exposureSnapshots: [],
      muleAssessments: [],
      exitModeSnapshots: [],
      evidenceGateSnapshots: [],
      forecastSnapshots: [],
    };
    await this.repository.saveCase(record);
    const detail = this.toDetail(record);
    await this.storeReplay(operation, idempotencyKey, requestHash, detail);
    return { value: detail, replayed: false };
  }

  async getCase(caseId: string): Promise<CaseDetail> {
    return this.toDetail(await this.requireCase(caseId));
  }

  /** Internal read model input; never exposed directly over HTTP. */
  async getOperationalCaseRecord(caseId: string): Promise<CaseRecord> {
    return structuredClone(await this.requireCase(caseId));
  }

  async resolveTransaction(
    caseId: string,
    rawEvent: unknown,
    rawIdempotencyKey: unknown,
  ): Promise<ReplayResult<CaseDetail>> {
    const event = ResolveTransactionRequestSchema.parse(rawEvent);
    const idempotencyKey = IdempotencyKeySchema.parse(rawIdempotencyKey);
    sameCaseEvent(event, caseId);
    const operation = `case:${caseId}:resolve`;
    const requestHash = hashEvidence(event);
    const replay = await this.readReplay<CaseDetail>(operation, idempotencyKey, requestHash);
    if (replay) return { value: CaseDetailSchema.parse(replay), replayed: true };

    const record = await this.requireCase(caseId);
    if (event.originalRef !== record.summary.originalTransactionRef) {
      throw new ConflictError(
        'TRANSACTION_REFERENCE_MISMATCH',
        `Resolution reference ${event.originalRef} does not match the reported transaction`,
      );
    }

    if (
      record.resolvedBeneficiaryAccount &&
      record.resolvedBeneficiaryAccount !== event.beneficiaryAccount
    ) {
      throw new ConflictError(
        'RESOLUTION_CONFLICT',
        'The case is already resolved to a different beneficiary account',
      );
    }

    this.addProviderEvent(record, event);
    record.resolvedBeneficiaryAccount = event.beneficiaryAccount;
    if (record.summary.state === 'REPORTED') {
      assertCaseTransition('REPORTED', 'ACTIVE');
      record.summary.state = 'ACTIVE';
    }
    record.summary.updatedAt = this.clock();
    await this.repository.saveCase(record);
    const detail = this.toDetail(record);
    await this.storeReplay(operation, idempotencyKey, requestHash, detail);
    return { value: detail, replayed: false };
  }

  async ingestProviderEvents(
    caseId: string,
    rawBatch: unknown,
    rawIdempotencyKey: unknown,
  ): Promise<ProviderEventIngestResult> {
    const batch = ProviderEventBatchSchema.parse(rawBatch);
    const idempotencyKey = IdempotencyKeySchema.parse(rawIdempotencyKey);
    const operation = `case:${caseId}:provider-events`;
    const requestHash = hashEvidence(batch);
    const replay = await this.readReplay<ProviderEventIngestResult>(
      operation,
      idempotencyKey,
      requestHash,
    );
    if (replay) return ProviderEventIngestResultSchema.parse({ ...replay, replayed: true });

    const record = await this.requireCase(caseId);
    if (!record.resolvedBeneficiaryAccount) {
      throw new ConflictError(
        'CASE_NOT_RESOLVED',
        'Resolve the reported transaction before ingesting downstream events',
      );
    }

    const acceptedEventIds: string[] = [];
    const duplicateEventIds: string[] = [];
    for (const event of batch.events) {
      sameCaseEvent(event, caseId);
      if (event.type === 'RESOLVE_TRANSACTION') {
        throw new InvalidRequestError(
          'USE_RESOLUTION_ENDPOINT',
          'RESOLVE_TRANSACTION events must use the resolve-transaction endpoint',
        );
      }
      const added = this.addProviderEvent(record, event);
      (added ? acceptedEventIds : duplicateEventIds).push(event.eventId);
    }

    record.providerEvents.sort(
      (left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) ||
        left.eventId.localeCompare(right.eventId),
    );
    if (acceptedEventIds.length > 0) record.summary.updatedAt = this.clock();
    await this.repository.saveCase(record);

    const result = ProviderEventIngestResultSchema.parse({
      caseId,
      acceptedEventIds,
      duplicateEventIds,
      totalLedgerEvents: record.providerEvents.length,
      replayed: false,
    });
    await this.storeReplay(operation, idempotencyKey, requestHash, result);
    return result;
  }

  async trace(caseId: string, rawIdempotencyKey: unknown): Promise<TraceRunResult> {
    const idempotencyKey = IdempotencyKeySchema.parse(rawIdempotencyKey);
    const record = await this.requireCase(caseId);
    const operation = `case:${caseId}:trace`;
    const traceRequest = { caseId };
    const requestHash = hashEvidence(traceRequest);
    const replay = await this.readReplay<TraceRunResult>(operation, idempotencyKey, requestHash);
    if (replay) return TraceRunResultSchema.parse({ ...replay, replayed: true });

    if (!record.resolvedBeneficiaryAccount) {
      throw new ConflictError(
        'CASE_NOT_RESOLVED',
        'Resolve the reported transaction before running TRACE',
      );
    }

    const currentGraph = record.graphVersions.at(-1) ?? null;
    const generatedAt = this.clock();
    const trace = buildTraceGraph({
      caseId,
      originalTransactionRef: record.summary.originalTransactionRef,
      beneficiaryAccount: record.resolvedBeneficiaryAccount,
      events: record.providerEvents,
      currentGraph,
      nextGraphVersion: record.summary.graphVersion + 1,
      generatedAt,
    });

    const previouslyProcessed = new Set(record.processedEventIds);
    const newlyProcessed = record.providerEvents
      .map((event) => event.eventId)
      .filter((eventId) => !previouslyProcessed.has(eventId));
    record.processedEventIds = [...previouslyProcessed, ...newlyProcessed];

    if (trace.changed) {
      record.graphVersions.push(trace.graph);
      record.summary.graphVersion = trace.graph.graphVersion;
      record.summary.updatedAt = generatedAt;
    }
    if (record.summary.state === 'ACTIVE') {
      assertCaseTransition('ACTIVE', 'TRACE');
      record.summary.state = 'TRACE';
    } else if (
      trace.changed &&
      (record.summary.state === 'EXPOSURE' ||
        record.summary.state === 'RISK_ASSESSED' ||
        record.summary.state === 'EXIT_MODE' ||
        record.summary.state === 'EVIDENCE_GATE' ||
        record.summary.state === 'PREDICT' ||
        record.summary.state === 'ABSTAIN')
    ) {
      assertCaseTransition(record.summary.state, 'TRACE');
      record.summary.state = 'TRACE';
    }
    await this.repository.saveCase(record);

    const result = TraceRunResultSchema.parse({
      caseId,
      changed: trace.changed,
      graphVersion: record.summary.graphVersion,
      processedEventIds: newlyProcessed,
      nodeCount: trace.graph.nodes.length,
      edgeCount: trace.graph.edges.length,
      coverageBoundary: trace.graph.coverageBoundary,
      replayed: false,
    });
    await this.storeReplay(operation, idempotencyKey, requestHash, result);
    return result;
  }

  async getLatestGraph(caseId: string): Promise<GraphSnapshot> {
    const record = await this.requireCase(caseId);
    const graph = record.graphVersions.at(-1);
    if (!graph) {
      throw new ConflictError('GRAPH_NOT_AVAILABLE', 'Run TRACE before requesting the graph');
    }
    return graph;
  }

  async getLedger(caseId: string): Promise<ProviderEvent[]> {
    const record = await this.requireCase(caseId);
    return structuredClone(record.providerEvents);
  }

  async recomputeExposure(
    caseId: string,
    rawPayload: unknown,
    rawIdempotencyKey: unknown,
  ): Promise<ReplayResult<ExposureSnapshot>> {
    const payload = ExposureRecomputeRequestSchema.parse(rawPayload);
    const idempotencyKey = IdempotencyKeySchema.parse(rawIdempotencyKey);
    const record = await this.requireCase(caseId);
    const graph = record.graphVersions.at(-1);
    if (!graph) {
      throw new ConflictError('GRAPH_NOT_AVAILABLE', 'Run TRACE before calculating exposure');
    }

    const operation = `case:${caseId}:exposure`;
    const calculationInputHash = hashEvidence({ graphVersion: graph.graphVersion, ...payload });
    const replay = await this.readReplay<ExposureSnapshot>(
      operation,
      idempotencyKey,
      calculationInputHash,
    );
    if (replay) return { value: ExposureSnapshotSchema.parse(replay), replayed: true };

    const accountBalances = new Map<string, number>();
    for (const balance of payload.accountBalances) {
      if (accountBalances.has(balance.accountId)) {
        throw new InvalidRequestError(
          'DUPLICATE_ACCOUNT_BALANCE',
          `Balance evidence for ${balance.accountId} was supplied more than once`,
        );
      }
      accountBalances.set(balance.accountId, balance.knownCleanBalanceMinor);
    }

    const existing = record.exposureSnapshots.find(
      (snapshot) => snapshot.graphVersion === graph.graphVersion,
    );
    if (existing) {
      if (existing.calculationInputHash !== calculationInputHash) {
        throw new ConflictError(
          'EXPOSURE_VERSION_IMMUTABLE',
          'Exposure evidence changed for an already-calculated graph version; run TRACE with new evidence first',
        );
      }
      await this.storeReplay(operation, idempotencyKey, calculationInputHash, existing);
      return { value: existing, replayed: false };
    }

    let calculated;
    try {
      calculated = calculateGraphExposure({
        edges: graph.edges.flatMap((edge) => {
          if (
            edge.type !== 'PAID_TO' &&
            edge.type !== 'TRANSFERRED_TO' &&
            edge.type !== 'WITHDREW_AT'
          ) {
            return [];
          }
          return [
            {
              edgeId: edge.edgeId,
              fromNodeId: edge.fromNodeId,
              toNodeId: edge.toNodeId,
              type: edge.type,
              occurredAt: edge.occurredAt,
              ...(edge.amount ? { amount: edge.amount } : {}),
            },
          ];
        }),
        knownCleanBalancesMinor: Object.fromEntries(accountBalances),
      });
    } catch (error) {
      if (error instanceof RangeError) {
        throw new InvalidRequestError('EXPOSURE_EVIDENCE_INVALID', error.message);
      }
      throw error;
    }

    const calculatedAt = this.clock();
    const snapshot = ExposureSnapshotSchema.parse({
      snapshotId: `exposure:${calculationInputHash.slice(0, 24)}`,
      caseId,
      graphVersion: graph.graphVersion,
      calculationInputHash,
      calculatedAt,
      states: calculated.map((state) => ({
        exposureStateId: `exposure-state:${hashEvidence({ caseId, graphVersion: graph.graphVersion, accountId: state.accountId }).slice(0, 20)}`,
        caseId,
        graphVersion: graph.graphVersion,
        calculationInputHash,
        calculatedAt,
        balanceProvenance: payload.accountBalances.find(
          (balance) => balance.accountId === state.accountId,
        )?.provenance,
        ...state,
      })),
    });

    record.exposureSnapshots.push(snapshot);
    if (record.summary.state === 'TRACE') {
      assertCaseTransition('TRACE', 'EXPOSURE');
      record.summary.state = 'EXPOSURE';
    }
    record.summary.updatedAt = calculatedAt;
    await this.repository.saveCase(record);
    await this.storeReplay(operation, idempotencyKey, calculationInputHash, snapshot);
    return { value: snapshot, replayed: false };
  }

  async getLatestExposure(caseId: string): Promise<ExposureSnapshot> {
    const record = await this.requireCase(caseId);
    const currentGraphVersion = record.summary.graphVersion;
    const exposure = record.exposureSnapshots.find(
      (snapshot) => snapshot.graphVersion === currentGraphVersion,
    );
    if (!exposure) {
      throw new ConflictError(
        'EXPOSURE_NOT_AVAILABLE',
        'Calculate exposure for the latest TRACE graph before requesting it',
      );
    }
    return exposure;
  }

  async assessAccountRisk(
    accountId: string,
    rawPayload: unknown,
    rawIdempotencyKey: unknown,
  ): Promise<ReplayResult<MuleAssessmentSnapshot>> {
    const payload = AccountRiskRequestSchema.parse(rawPayload);
    const idempotencyKey = IdempotencyKeySchema.parse(rawIdempotencyKey);
    const record = await this.requireCase(payload.caseId);
    const graph = record.graphVersions.at(-1);
    if (!graph) {
      throw new ConflictError('GRAPH_NOT_AVAILABLE', 'Run TRACE before assessing account risk');
    }
    const currentExposure = record.exposureSnapshots.find(
      (snapshot) => snapshot.graphVersion === graph.graphVersion,
    );
    if (!currentExposure) {
      throw new ConflictError(
        'EXPOSURE_NOT_AVAILABLE',
        'Calculate exposure for the latest graph before assessing account risk',
      );
    }
    if (!currentExposure.states.some((state) => state.accountId === accountId)) {
      throw new InvalidRequestError(
        'ACCOUNT_NOT_FRAUD_REACHABLE',
        `Account ${accountId} has no exposure state in graph version ${graph.graphVersion}`,
      );
    }

    const internalCrossCaseSignal = await this.crossCaseSignalLookup(
      payload.caseId,
      graph.graphVersion,
      accountId,
    );
    const effectiveProviderSignals = internalCrossCaseSignal
      ? {
          ...payload.providerSignals,
          crossCaseLinkage: internalCrossCaseSignal.crossCaseLinkage,
        }
      : payload.providerSignals;
    const operation = `case:${payload.caseId}:account:${accountId}:risk`;
    const calculationInputHash = hashEvidence({
      graphVersion: graph.graphVersion,
      accountId,
      providerSignals: effectiveProviderSignals,
      crossCaseCorrelationRunId: internalCrossCaseSignal?.correlationRunId ?? null,
      trustedOutcome: payload.trustedOutcome,
    });
    const replay = await this.readReplay<MuleAssessmentSnapshot>(
      operation,
      idempotencyKey,
      calculationInputHash,
    );
    if (replay) return { value: MuleAssessmentSnapshotSchema.parse(replay), replayed: true };

    const existing = record.muleAssessments.find(
      (assessment) =>
        assessment.graphVersion === graph.graphVersion && assessment.accountId === accountId,
    );
    if (existing) {
      if (existing.calculationInputHash !== calculationInputHash) {
        throw new ConflictError(
          'RISK_VERSION_IMMUTABLE',
          'Risk evidence changed for an already-assessed account and graph version',
        );
      }
      await this.storeReplay(operation, idempotencyKey, calculationInputHash, existing);
      return { value: existing, replayed: false };
    }

    let features;
    try {
      features = deriveMuleRiskFeatures(graph, accountId, effectiveProviderSignals);
    } catch (error) {
      if (error instanceof RangeError) {
        throw new InvalidRequestError('RISK_EVIDENCE_INVALID', error.message);
      }
      throw error;
    }
    const result = assessMuleRisk({
      ...features,
      trustedOutcome: payload.trustedOutcome.status,
    });
    const assessedAt = this.clock();
    const assessment = MuleAssessmentSnapshotSchema.parse({
      assessmentId: `mule-assessment:${calculationInputHash.slice(0, 20)}`,
      caseId: payload.caseId,
      accountId,
      graphVersion: graph.graphVersion,
      state: result.state,
      score: result.score,
      reasonCodes: result.reasonCodes,
      features,
      featureVersion: 'mule-features-v1',
      ruleVersion: result.ruleVersion,
      calculationInputHash,
      signalProvenance: payload.providerSignals.provenance,
      ...(internalCrossCaseSignal
        ? { crossCaseCorrelationRunId: internalCrossCaseSignal.correlationRunId }
        : {}),
      trustedOutcome: payload.trustedOutcome,
      assessedAt,
    });

    record.muleAssessments.push(assessment);
    if (record.summary.state === 'EXPOSURE') {
      assertCaseTransition('EXPOSURE', 'RISK_ASSESSED');
      record.summary.state = 'RISK_ASSESSED';
    }
    record.summary.updatedAt = assessedAt;
    await this.repository.saveCase(record);
    await this.storeReplay(operation, idempotencyKey, calculationInputHash, assessment);
    return { value: assessment, replayed: false };
  }

  async getRiskSnapshots(caseId: string): Promise<MuleAssessmentSnapshot[]> {
    const record = await this.requireCase(caseId);
    return structuredClone(record.muleAssessments).sort(
      (left, right) =>
        left.graphVersion - right.graphVersion || left.accountId.localeCompare(right.accountId),
    );
  }

  async assessExitMode(
    caseId: string,
    rawPayload: unknown,
    rawIdempotencyKey: unknown,
  ): Promise<ReplayResult<ExitModeSnapshot>> {
    const payload = ExitModeRequestSchema.parse(rawPayload);
    const idempotencyKey = IdempotencyKeySchema.parse(rawIdempotencyKey);
    const record = await this.requireCase(caseId);
    const graph = record.graphVersions.at(-1);
    if (!graph) {
      throw new ConflictError('GRAPH_NOT_AVAILABLE', 'Run TRACE before assessing exit mode');
    }
    const exposure = record.exposureSnapshots
      .find((snapshot) => snapshot.graphVersion === graph.graphVersion)
      ?.states.find((state) => state.accountId === payload.accountId);
    if (!exposure) {
      throw new ConflictError(
        'EXPOSURE_NOT_AVAILABLE',
        `Calculate current exposure for ${payload.accountId} before assessing exit mode`,
      );
    }
    const risk = record.muleAssessments.find(
      (assessment) =>
        assessment.graphVersion === graph.graphVersion &&
        assessment.accountId === payload.accountId,
    );
    if (!risk) {
      throw new ConflictError(
        'RISK_ASSESSMENT_REQUIRED',
        `Assess current risk for ${payload.accountId} before assessing exit mode`,
      );
    }

    const operation = `case:${caseId}:exit-mode`;
    const calculationInputHash = hashEvidence({ graphVersion: graph.graphVersion, ...payload });
    const replay = await this.readReplay<ExitModeSnapshot>(
      operation,
      idempotencyKey,
      calculationInputHash,
    );
    if (replay) return { value: ExitModeSnapshotSchema.parse(replay), replayed: true };

    const existing = record.exitModeSnapshots.find(
      (snapshot) => snapshot.graphVersion === graph.graphVersion,
    );
    if (existing) {
      if (existing.calculationInputHash !== calculationInputHash) {
        throw new ConflictError(
          'EXIT_MODE_VERSION_IMMUTABLE',
          'Exit-mode evidence changed for an already-assessed graph version',
        );
      }
      await this.storeReplay(operation, idempotencyKey, calculationInputHash, existing);
      return { value: existing, replayed: false };
    }

    const evaluatedAt = this.clock();
    let features;
    try {
      features = deriveExitModeFeatures(
        graph,
        exposure,
        risk,
        payload.providerSignals,
        evaluatedAt,
      );
    } catch (error) {
      if (error instanceof RangeError) {
        throw new InvalidRequestError('EXIT_MODE_EVIDENCE_INVALID', error.message);
      }
      throw error;
    }
    const ranked = rankExitModes(features);
    const snapshot = ExitModeSnapshotSchema.parse({
      exitModeRunId: `exit-mode:${calculationInputHash.slice(0, 22)}`,
      caseId,
      accountId: payload.accountId,
      graphVersion: graph.graphVersion,
      selectedMode: ranked.selectedMode,
      confidence: ranked.confidence,
      rankedModes: ranked.rankedModes,
      features,
      featureVersion: 'exit-features-v1',
      modelVersion: ranked.modelVersion,
      ruleVersion: ranked.ruleVersion,
      calculationInputHash,
      signalProvenance: payload.providerSignals.provenance,
      evaluatedAt,
    });

    record.exitModeSnapshots.push(snapshot);
    if (record.summary.state === 'RISK_ASSESSED') {
      assertCaseTransition('RISK_ASSESSED', 'EXIT_MODE');
      record.summary.state = 'EXIT_MODE';
    }
    record.summary.updatedAt = evaluatedAt;
    await this.repository.saveCase(record);
    await this.storeReplay(operation, idempotencyKey, calculationInputHash, snapshot);
    return { value: snapshot, replayed: false };
  }

  async getLatestExitMode(caseId: string): Promise<ExitModeSnapshot> {
    const record = await this.requireCase(caseId);
    const snapshot = record.exitModeSnapshots.find(
      (candidate) => candidate.graphVersion === record.summary.graphVersion,
    );
    if (!snapshot) {
      throw new ConflictError(
        'EXIT_MODE_NOT_AVAILABLE',
        'Assess exit mode for the latest graph before requesting it',
      );
    }
    return snapshot;
  }

  async evaluateForecastEvidence(
    caseId: string,
    rawPayload: unknown,
    rawIdempotencyKey: unknown,
  ): Promise<ReplayResult<EvidenceGateSnapshot>> {
    const payload = ForecastEvidenceRequestSchema.parse(rawPayload);
    const idempotencyKey = IdempotencyKeySchema.parse(rawIdempotencyKey);
    const record = await this.requireCase(caseId);
    const exitMode = record.exitModeSnapshots.find(
      (snapshot) =>
        snapshot.graphVersion === record.summary.graphVersion &&
        snapshot.accountId === payload.accountId,
    );
    if (!exitMode) {
      throw new ConflictError(
        'EXIT_MODE_NOT_AVAILABLE',
        'Assess exit mode for the latest graph and account before running the Evidence Gate',
      );
    }

    const operation = `case:${caseId}:forecast-evidence`;
    const calculationInputHash = hashEvidence({
      graphVersion: record.summary.graphVersion,
      exitModeRunId: exitMode.exitModeRunId,
      ...payload,
    });
    const replay = await this.readReplay<EvidenceGateSnapshot>(
      operation,
      idempotencyKey,
      calculationInputHash,
    );
    if (replay) return { value: EvidenceGateSnapshotSchema.parse(replay), replayed: true };

    const existing = record.evidenceGateSnapshots.find(
      (snapshot) => snapshot.graphVersion === record.summary.graphVersion,
    );
    if (existing) {
      if (existing.calculationInputHash !== calculationInputHash) {
        throw new ConflictError(
          'EVIDENCE_GATE_VERSION_IMMUTABLE',
          'Evidence Gate inputs changed for an already-evaluated graph version',
        );
      }
      await this.storeReplay(operation, idempotencyKey, calculationInputHash, existing);
      return { value: existing, replayed: false };
    }

    const geo = evaluateEvidenceGate(payload.geo, exitMode.selectedMode);
    const time = evaluateEvidenceGate(payload.time, exitMode.selectedMode);
    const overallDecision =
      geo.decision === 'PASS' && time.decision === 'PASS'
        ? 'PREDICT'
        : geo.decision === 'PASS' || time.decision === 'PASS'
          ? 'PARTIAL'
          : 'ABSTAIN';
    const evaluatedAt = this.clock();
    const snapshot = EvidenceGateSnapshotSchema.parse({
      evidenceGateRunId: `evidence-gate:${calculationInputHash.slice(0, 20)}`,
      caseId,
      accountId: payload.accountId,
      graphVersion: record.summary.graphVersion,
      exitModeRunId: exitMode.exitModeRunId,
      exitMode: exitMode.selectedMode,
      overallDecision,
      geo,
      time,
      featureVersion: 'evidence-features-v1',
      ruleVersion: 'evidence-gate-v2',
      calculationInputHash,
      evaluatedAt,
    });

    if (record.summary.state === 'EXIT_MODE') {
      assertCaseTransition('EXIT_MODE', 'EVIDENCE_GATE');
      record.summary.state = 'EVIDENCE_GATE';
    }
    if (record.summary.state === 'EVIDENCE_GATE') {
      const nextState = overallDecision === 'ABSTAIN' ? 'ABSTAIN' : 'PREDICT';
      assertCaseTransition('EVIDENCE_GATE', nextState);
      record.summary.state = nextState;
    }
    record.evidenceGateSnapshots.push(snapshot);
    record.summary.updatedAt = evaluatedAt;
    await this.repository.saveCase(record);
    await this.storeReplay(operation, idempotencyKey, calculationInputHash, snapshot);
    return { value: snapshot, replayed: false };
  }

  async getLatestForecastEvidence(caseId: string): Promise<EvidenceGateSnapshot> {
    const record = await this.requireCase(caseId);
    const snapshot = record.evidenceGateSnapshots.find(
      (candidate) => candidate.graphVersion === record.summary.graphVersion,
    );
    if (!snapshot) {
      throw new ConflictError(
        'EVIDENCE_GATE_NOT_AVAILABLE',
        'Run the Evidence Gate for the latest graph before requesting forecast readiness',
      );
    }
    return snapshot;
  }

  async runForecast(
    caseId: string,
    rawPayload: unknown,
    rawIdempotencyKey: unknown,
  ): Promise<ReplayResult<ForecastSnapshot>> {
    const payload = ForecastRunRequestSchema.parse(rawPayload);
    const idempotencyKey = IdempotencyKeySchema.parse(rawIdempotencyKey);
    const record = await this.requireCase(caseId);
    const gate = record.evidenceGateSnapshots.find(
      (snapshot) =>
        snapshot.graphVersion === record.summary.graphVersion &&
        snapshot.accountId === payload.accountId,
    );
    if (!gate) {
      throw new ConflictError(
        'EVIDENCE_GATE_NOT_AVAILABLE',
        'Run the Evidence Gate for the latest graph and account before ranking a forecast',
      );
    }
    if (gate.geo.decision === 'PASS' && payload.geoCandidates.length === 0) {
      throw new InvalidRequestError(
        'GEO_CANDIDATES_REQUIRED',
        'Geo evidence passed its gate, so at least one authorised candidate zone is required',
      );
    }
    if (gate.geo.decision === 'ABSTAIN' && payload.geoCandidates.length > 0) {
      throw new InvalidRequestError(
        'GEO_FORECAST_WITHHELD',
        'Geo candidates cannot be ranked when the geo Evidence Gate abstains',
      );
    }
    if (gate.time.decision === 'PASS' && payload.timeHorizons.length !== 5) {
      throw new InvalidRequestError(
        'TIME_HORIZONS_REQUIRED',
        'Time evidence passed its gate, so all five non-overlapping horizon buckets are required',
      );
    }
    if (gate.time.decision === 'ABSTAIN' && payload.timeHorizons.length > 0) {
      throw new InvalidRequestError(
        'TIME_FORECAST_WITHHELD',
        'Time horizons cannot be ranked when the time Evidence Gate abstains',
      );
    }

    const operation = `case:${caseId}:forecast-ranking`;
    const calculationInputHash = hashEvidence({
      graphVersion: record.summary.graphVersion,
      evidenceGateRunId: gate.evidenceGateRunId,
      ...payload,
    });
    const replay = await this.readReplay<ForecastSnapshot>(
      operation,
      idempotencyKey,
      calculationInputHash,
    );
    if (replay) return { value: ForecastSnapshotSchema.parse(replay), replayed: true };

    const existing = record.forecastSnapshots.find(
      (snapshot) => snapshot.graphVersion === record.summary.graphVersion,
    );
    if (existing) {
      if (existing.calculationInputHash !== calculationInputHash) {
        throw new ConflictError(
          'FORECAST_VERSION_IMMUTABLE',
          'Forecast inputs changed for an already-ranked graph version',
        );
      }
      await this.storeReplay(operation, idempotencyKey, calculationInputHash, existing);
      return { value: existing, replayed: false };
    }

    let geo: ForecastSnapshot['geo'];
    let time: ForecastSnapshot['time'];
    try {
      geo =
        gate.geo.decision === 'PASS'
          ? rankGeoZones(payload.geoCandidates, gate.geo)
          : {
              decision: 'ABSTAIN',
              reasonCodes: [...new Set([...gate.geo.reasonCodes, ...gate.geo.missingEvidence])],
            };
      time =
        gate.time.decision === 'PASS'
          ? rankTimeHorizons(payload.timeHorizons, gate.time)
          : {
              decision: 'ABSTAIN',
              reasonCodes: [...new Set([...gate.time.reasonCodes, ...gate.time.missingEvidence])],
            };
    } catch (error) {
      if (error instanceof RangeError) {
        throw new InvalidRequestError('FORECAST_EVIDENCE_INVALID', error.message);
      }
      throw error;
    }

    const predictedConfidences = [
      geo.decision === 'PREDICT' ? geo.confidence : null,
      time.decision === 'PREDICT' ? time.confidence : null,
    ].filter((value): value is number => value !== null);
    const confidence =
      predictedConfidences.length === 0
        ? 0
        : Number(
            (
              predictedConfidences.reduce((sum, value) => sum + value, 0) /
              predictedConfidences.length
            ).toFixed(3),
          );
    const generatedAt = this.clock();
    const previousPredictionRunId = record.forecastSnapshots
      .filter((snapshot) => snapshot.graphVersion < record.summary.graphVersion)
      .sort((left, right) => right.graphVersion - left.graphVersion)[0]?.predictionRunId;
    const snapshot = ForecastSnapshotSchema.parse({
      predictionRunId: `forecast:${calculationInputHash.slice(0, 23)}`,
      previousPredictionRunId: previousPredictionRunId ?? null,
      evidenceGateRunId: gate.evidenceGateRunId,
      caseId,
      accountId: payload.accountId,
      graphVersion: record.summary.graphVersion,
      generatedAt,
      exitMode: gate.exitMode,
      evidenceGateDecision: gate.overallDecision,
      geo,
      time,
      featureVersion: 'forecast-features-v1',
      modelVersion: 'deterministic-forecast-v1',
      ruleVersion: 'forecast-policy-v2',
      calculationInputHash,
      confidence,
      reasonCodes: [
        geo.decision === 'PREDICT' ? 'GEO_FORECAST_EMITTED' : 'GEO_FORECAST_WITHHELD',
        time.decision === 'PREDICT' ? 'TIME_FORECAST_EMITTED' : 'TIME_FORECAST_WITHHELD',
        previousPredictionRunId ? 'REFORECAST_AFTER_GRAPH_CHANGE' : 'INITIAL_FORECAST',
      ],
    });

    record.forecastSnapshots.push(snapshot);
    record.summary.updatedAt = generatedAt;
    await this.repository.saveCase(record);
    await this.storeReplay(operation, idempotencyKey, calculationInputHash, snapshot);
    return { value: snapshot, replayed: false };
  }

  async getLatestForecast(caseId: string): Promise<ForecastSnapshot> {
    const record = await this.requireCase(caseId);
    const snapshot = record.forecastSnapshots.find(
      (candidate) => candidate.graphVersion === record.summary.graphVersion,
    );
    if (!snapshot) {
      throw new ConflictError(
        'FORECAST_NOT_AVAILABLE',
        'Rank zone/time outputs for the latest graph before requesting the forecast',
      );
    }
    return snapshot;
  }

  private addProviderEvent(record: CaseRecord, event: ProviderEvent): boolean {
    const eventHash = hashEvidence(event);
    const existingHash = record.providerEventHashes[event.eventId];
    if (existingHash && existingHash !== eventHash) {
      throw new ConflictError(
        'PROVIDER_EVENT_CONFLICT',
        `Provider event ${event.eventId} was replayed with different content`,
      );
    }
    if (existingHash) return false;

    record.providerEvents.push(event);
    record.providerEventHashes[event.eventId] = eventHash;
    return true;
  }

  private async requireCase(caseId: string): Promise<CaseRecord> {
    const record = await this.repository.getCase(caseId);
    if (!record) throw new NotFoundError('Case', caseId);
    return record;
  }

  private toDetail(record: CaseRecord): CaseDetail {
    return CaseDetailSchema.parse({
      summary: record.summary,
      complaint: record.complaint,
      resolvedBeneficiaryAccount: record.resolvedBeneficiaryAccount,
      providerEventCount: record.providerEvents.length,
      processedEventCount: record.processedEventIds.length,
      latestCoverageBoundary: record.graphVersions.at(-1)?.coverageBoundary ?? null,
      latestExposureGraphVersion: record.exposureSnapshots.at(-1)?.graphVersion ?? null,
      riskAssessmentCount: record.muleAssessments.length,
      latestExitModeGraphVersion: record.exitModeSnapshots.at(-1)?.graphVersion ?? null,
      latestEvidenceGateGraphVersion: record.evidenceGateSnapshots.at(-1)?.graphVersion ?? null,
      latestForecastGraphVersion: record.forecastSnapshots.at(-1)?.graphVersion ?? null,
    });
  }

  private async readReplay<T>(
    operation: string,
    key: string,
    requestHash: string,
  ): Promise<T | null> {
    const existing = await this.repository.getIdempotency(operation, key);
    if (!existing) return null;
    if (existing.requestHash !== requestHash) {
      throw new ConflictError(
        'IDEMPOTENCY_KEY_REUSED',
        'The idempotency key was already used with a different request',
      );
    }
    return structuredClone(existing.response) as T;
  }

  private async storeReplay(
    operation: string,
    key: string,
    requestHash: string,
    response: unknown,
  ): Promise<void> {
    const record: IdempotencyRecord = { operation, key, requestHash, response };
    await this.repository.saveIdempotency(record);
  }
}
