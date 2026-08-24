import { hashEvidence } from '@trishul/audit';
import {
  CaseDetailSchema,
  ComplaintSubmissionSchema,
  IdempotencyKeySchema,
  ProviderEventBatchSchema,
  ProviderEventIngestResultSchema,
  ResolveTransactionRequestSchema,
  TraceRunResultSchema,
  assertCaseTransition,
  type CaseDetail,
  type ComplaintSubmission,
  type GraphSnapshot,
  type ProviderEvent,
  type ProviderEventIngestResult,
  type TraceRunResult,
} from '@trishul/contracts';
import { buildTraceGraph } from '@trishul/graph';
import { ConflictError, InvalidRequestError, NotFoundError } from '../../domain/errors.js';
import type { CaseRecord, CaseRepository, IdempotencyRecord } from './case-repository.js';

type Clock = () => string;

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
    };
    await this.repository.saveCase(record);
    const detail = this.toDetail(record);
    await this.storeReplay(operation, idempotencyKey, requestHash, detail);
    return { value: detail, replayed: false };
  }

  async getCase(caseId: string): Promise<CaseDetail> {
    return this.toDetail(await this.requireCase(caseId));
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
