import { hashEvidence } from '@trishul/audit';
import {
  CommandCenterAlertSchema,
  CommandCenterSnapshotSchema,
  CasePriorityFeaturesSchema,
  CasePrioritySnapshotSchema,
  IdentifierSchema,
  type CommandCenterAlert,
  type CommandCenterSnapshot,
  type CasePriorityFeatures,
  type CasePrioritySnapshot,
  type TrustSession,
} from '@trishul/contracts';
import { type AlertLifecycleInput, type CommandCenterRepository } from '@trishul/database';
import { evaluateCasePriority } from '@trishul/intelligence';
import { ForbiddenError } from '../../domain/errors.js';
import type { CaseRecord } from '../cases/case-repository.js';
import type { CaseService } from '../cases/case-service.js';

type Clock = () => string;

export class CommandCenterService {
  constructor(
    private readonly repository: CommandCenterRepository,
    private readonly cases: CaseService,
    private readonly clock: Clock = () => new Date().toISOString(),
  ) {}

  async prioritize(caseId: string, idempotencyKey: string) {
    const id = IdentifierSchema.parse(caseId);
    const key = IdentifierSchema.parse(idempotencyKey);
    const record = await this.cases.getOperationalCaseRecord(id);
    const features = priorityFeatures(record);
    const calculationInputHash = hashEvidence({
      caseId: id,
      graphVersion: record.summary.graphVersion,
      features,
      featureVersion: 'case-priority-features-v1',
      ruleVersion: 'case-priority-v1',
    });
    const calculatedAt = this.clock();
    const priorityRunId = `priority:${hashEvidence({ calculationInputHash, key }).slice(0, 24)}`;
    const decision = evaluateCasePriority(features);
    const snapshot = CasePrioritySnapshotSchema.parse({
      priorityRunId,
      caseId: id,
      graphVersion: record.summary.graphVersion,
      ...decision,
      features,
      featureVersion: 'case-priority-features-v1',
      ruleVersion: 'case-priority-v1',
      calculationInputHash,
      calculatedAt,
    });
    const alert = alertFor(snapshot);
    return this.repository.recordPriority({
      snapshot,
      alert,
      idempotencyKey: key,
      requestHash: calculationInputHash,
    });
  }

  async latest(caseId: string): Promise<CasePrioritySnapshot | null> {
    return this.repository.latestPriorityForCase(IdentifierSchema.parse(caseId));
  }

  async alerts(caseId: string): Promise<readonly CommandCenterAlert[]> {
    return this.repository.listAlertsForCase(IdentifierSchema.parse(caseId));
  }

  async dashboard(session: TrustSession): Promise<CommandCenterSnapshot> {
    if (!session.capabilities.includes('COMMAND_CENTER_READ')) {
      throw new ForbiddenError(
        'COMMAND_CENTER_CAPABILITY_REQUIRED',
        'A command-center scoped trust session is required.',
      );
    }
    const scopeCaseIds = [...new Set(session.caseIds)].sort();
    const records = await Promise.all(
      scopeCaseIds.map((caseId) => this.cases.getOperationalCaseRecord(caseId)),
    );
    const priorities = await this.repository.latestPrioritiesForCases(scopeCaseIds);
    const priorityByCase = new Map(priorities.map((snapshot) => [snapshot.caseId, snapshot]));
    const alertsByCase = new Map(
      await Promise.all(
        scopeCaseIds.map(
          async (caseId) => [caseId, await this.repository.listAlertsForCase(caseId)] as const,
        ),
      ),
    );
    const items = records
      .map((record) => {
        const alerts = alertsByCase.get(record.summary.caseId) ?? [];
        return {
          summary: record.summary,
          reportedAmountMinor: record.complaint.reportedAmount.amountMinor,
          priority: priorityByCase.get(record.summary.caseId) ?? null,
          openAlertCount: alerts.filter((alert) => alert.status === 'OPEN').length,
          latestAlert: alerts[0] ?? null,
        };
      })
      .sort((left, right) => {
        const scoreDelta =
          (right.priority?.priorityScore ?? -1) - (left.priority?.priorityScore ?? -1);
        return scoreDelta || right.summary.updatedAt.localeCompare(left.summary.updatedAt);
      });

    return CommandCenterSnapshotSchema.parse({
      generatedAt: this.clock(),
      scopeCaseIds,
      counts: {
        totalCases: items.length,
        activeInterventionWindows: items.filter(
          (item) => item.priority?.operationalState === 'ACTIVE_INTERVENTION_WINDOW',
        ).length,
        openAlerts: items.reduce((sum, item) => sum + item.openAlertCount, 0),
        abstainingCases: items.filter(
          (item) => item.priority?.features.evidenceGateDecision === 'ABSTAIN',
        ).length,
      },
      cases: items,
      ruleVersion: 'case-priority-v1',
    });
  }

  async acknowledge(
    caseId: string,
    alertId: string,
    rationale: string,
    idempotencyKey: string,
    principal: TrustSession,
  ) {
    this.authorizeCaseWrite(caseId, principal);
    return this.repository.acknowledgeAlert(
      lifecycleInput(caseId, alertId, rationale, idempotencyKey, principal, this.clock()),
    );
  }

  async resolve(
    caseId: string,
    alertId: string,
    rationale: string,
    idempotencyKey: string,
    principal: TrustSession,
  ) {
    this.authorizeCaseWrite(caseId, principal);
    if (principal.role !== 'SUPERVISOR') {
      throw new ForbiddenError(
        'ALERT_RESOLUTION_ROLE_DENIED',
        'Only a supervisor may resolve a command-center alert.',
      );
    }
    return this.repository.resolveAlert(
      lifecycleInput(caseId, alertId, rationale, idempotencyKey, principal, this.clock()),
    );
  }

  private authorizeCaseWrite(caseId: string, principal: TrustSession): void {
    if (principal.caseId !== caseId || !principal.capabilities.includes('CASE_WRITE')) {
      throw new ForbiddenError(
        'ALERT_CASE_SCOPE_DENIED',
        'The verified trust session does not grant alert lifecycle access for this case.',
      );
    }
  }
}

function priorityFeatures(record: CaseRecord): CasePriorityFeatures {
  const graphVersion = record.summary.graphVersion;
  const exposure = [...record.exposureSnapshots]
    .reverse()
    .find((snapshot) => snapshot.graphVersion === graphVersion);
  const assessments = record.muleAssessments.filter(
    (assessment) => assessment.graphVersion === graphVersion,
  );
  const exitMode = [...record.exitModeSnapshots]
    .reverse()
    .find((snapshot) => snapshot.graphVersion === graphVersion);
  const evidenceGate = [...record.evidenceGateSnapshots]
    .reverse()
    .find((snapshot) => snapshot.graphVersion === graphVersion);
  const forecast = [...record.forecastSnapshots]
    .reverse()
    .find((snapshot) => snapshot.graphVersion === graphVersion);
  const outcomeEvents = record.providerEvents.filter((event) => event.type === 'OUTCOME');
  const latestOutcome = outcomeEvents.at(-1);
  const complaintLagMinutes = Math.max(
    0,
    Math.floor(
      (Date.parse(record.complaint.reportedAt) -
        Date.parse(record.complaint.transactionOccurredAt)) /
        60_000,
    ),
  );
  return CasePriorityFeaturesSchema.parse({
    reportedAmountMinor: record.complaint.reportedAmount.amountMinor,
    maximumAttributableMinor: Math.max(
      0,
      ...(exposure?.states.map((state) => state.maximumAttributableMinor) ?? []),
    ),
    highestMuleRiskScore: Math.max(0, ...assessments.map((assessment) => assessment.score)),
    crossCaseLinkage: Math.max(
      0,
      ...assessments.map((assessment) => assessment.features.network.crossCaseLinkage),
    ),
    exitMode: exitMode?.selectedMode ?? 'NOT_ASSESSED',
    evidenceGateDecision: evidenceGate?.overallDecision ?? 'NOT_ASSESSED',
    highestRiskTimeBucket:
      forecast?.time.decision === 'PREDICT' ? forecast.time.highestRiskBucket : null,
    forecastConfidence: forecast?.confidence ?? 0,
    observedCashOut:
      record.providerEvents.some((event) => event.type === 'CASH_OUT') ||
      latestOutcome?.actualExitMode === 'CASH_OUT',
    institutionalOutcome: latestOutcome?.institutionalOutcome ?? 'NONE',
    complaintLagMinutes,
  });
}

function alertFor(snapshot: CasePrioritySnapshot): CommandCenterAlert | null {
  if (snapshot.operationalState === 'MONITORING' || snapshot.operationalState === 'OUTCOME_KNOWN') {
    return null;
  }
  const severity =
    snapshot.priorityBand === 'CRITICAL'
      ? 'CRITICAL'
      : snapshot.priorityBand === 'HIGH'
        ? 'HIGH'
        : 'MEDIUM';
  const kind =
    snapshot.operationalState === 'ACTIVE_INTERVENTION_WINDOW' ? 'INTERVENTION' : 'TRACE_RISK';
  const title = {
    ACTIVE_INTERVENTION_WINDOW: 'Active intervention window detected',
    ELEVATED_HORIZON: 'Elevated fraud-fund movement horizon',
    CASH_OUT_MAY_HAVE_OCCURRED: 'Cash-out may have occurred',
  }[snapshot.operationalState];
  const message =
    snapshot.operationalState === 'ACTIVE_INTERVENTION_WINDOW'
      ? 'Evidence-backed timing and movement signals support urgent authorised review.'
      : snapshot.operationalState === 'CASH_OUT_MAY_HAVE_OCCURRED'
        ? 'Observed evidence indicates reconstruction, correlation, and outcome recording are required.'
        : 'Current exposure, account-risk, or movement evidence supports monitoring and escalation preparation.';
  const deduplicationKey = `${snapshot.caseId}:${snapshot.priorityRunId}:${snapshot.operationalState}`;
  return CommandCenterAlertSchema.parse({
    alertId: `alert:${hashEvidence(deduplicationKey).slice(0, 24)}`,
    caseId: snapshot.caseId,
    severity,
    kind,
    title,
    message,
    sourceUrls: [],
    priorityRunId: snapshot.priorityRunId,
    deduplicationKey,
    reasonCodes: snapshot.reasonCodes,
    recommendedActions: snapshot.recommendedActions,
    status: 'OPEN',
    createdAt: snapshot.calculatedAt,
    acknowledgedAt: null,
    acknowledgedBy: null,
    acknowledgementRationale: null,
    resolvedAt: null,
    resolvedBy: null,
    resolutionRationale: null,
  });
}

function lifecycleInput(
  caseId: string,
  alertId: string,
  rationale: string,
  idempotencyKey: string,
  principal: TrustSession,
  occurredAt: string,
): AlertLifecycleInput {
  const input = {
    alertId: IdentifierSchema.parse(alertId),
    caseId: IdentifierSchema.parse(caseId),
    actorRef: principal.subjectId,
    rationale,
    idempotencyKey: IdentifierSchema.parse(idempotencyKey),
    occurredAt,
  };
  return { ...input, requestHash: hashEvidence(input) };
}
