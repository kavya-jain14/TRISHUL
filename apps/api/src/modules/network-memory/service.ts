import { randomUUID } from 'node:crypto';
import { hashEvidence } from '@trishul/audit';
import {
  CrossCaseCorrelationSnapshotSchema,
  IdentifierSchema,
  IdempotencyKeySchema,
  type CrossCaseCorrelationRunResult,
  type GraphSnapshot,
} from '@trishul/contracts';
import { NetworkMemoryConflictError, type NetworkMemoryRepository } from '@trishul/database';
import { correlateCrossCaseNetworks } from '@trishul/intelligence';
import { ConflictError, NotFoundError } from '../../domain/errors.js';

type Clock = () => string;
type RunIdFactory = () => string;
type GraphLookup = (caseId: string) => Promise<GraphSnapshot>;

export class CrossCaseCorrelationService {
  constructor(
    private readonly repository: NetworkMemoryRepository,
    private readonly graphLookup: GraphLookup,
    private readonly clock: Clock = () => new Date().toISOString(),
    private readonly runId: RunIdFactory = () => randomUUID(),
  ) {}

  async correlate(
    rawCaseId: unknown,
    rawIdempotencyKey: unknown,
  ): Promise<CrossCaseCorrelationRunResult> {
    const caseId = IdentifierSchema.parse(rawCaseId);
    const idempotencyKey = IdempotencyKeySchema.parse(rawIdempotencyKey);
    const graph = await this.graphLookup(caseId);
    const historicalCases = (await this.repository.historicalCases(caseId)).sort((left, right) =>
      left.caseId.localeCompare(right.caseId),
    );
    const requestHash = hashEvidence({ graph, historicalCases });
    const correlation = correlateCrossCaseNetworks(graph, historicalCases, {
      correlationRunId: `correlation:${this.runId()}`,
      evaluatedAt: this.clock(),
      calculationInputHash: requestHash,
    });
    try {
      const result = await this.repository.record({
        idempotencyKey,
        requestHash,
        correlation,
      });
      return {
        correlation: result.correlation,
        replayed: result.status === 'IDEMPOTENT_REPLAY',
      };
    } catch (error) {
      if (error instanceof NetworkMemoryConflictError) {
        throw new ConflictError('NETWORK_MEMORY_IDEMPOTENCY_CONFLICT', error.message);
      }
      throw error;
    }
  }

  async latest(rawCaseId: unknown) {
    const caseId = IdentifierSchema.parse(rawCaseId);
    const correlation = await this.repository.latestForCase(caseId);
    if (!correlation) throw new NotFoundError('Cross-case correlation', caseId);
    return CrossCaseCorrelationSnapshotSchema.parse(correlation);
  }
}
