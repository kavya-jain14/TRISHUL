import { createHash } from 'node:crypto';
import {
  CrossCaseCorrelationSnapshotSchema,
  HistoricalCaseEvidenceSchema,
  type AccountCorrelationSignal,
  type CrossCaseCorrelationSnapshot,
  type GraphEdge,
  type GraphSnapshot,
  type HistoricalCaseEvidence,
  type HistoricalInstitutionalOutcome,
} from '@trishul/contracts';

const FINANCIAL_EDGE_TYPES = new Set(['PAID_TO', 'TRANSFERRED_TO']);
const OUTCOME_MULTIPLIER: Record<HistoricalInstitutionalOutcome['status'], number> = {
  CONFIRMED: 1,
  SUSPECTED: 0.6,
  NO_INSTITUTIONAL_OUTCOME: 0.35,
  CLEARED: 0,
};

export interface CrossCaseCorrelationContext {
  correlationRunId: string;
  evaluatedAt: string;
  calculationInputHash: string;
}

function roundSignal(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 10_000) / 10_000;
}

function financialEdges(graph: GraphSnapshot): GraphEdge[] {
  return graph.edges.filter((edge) => FINANCIAL_EDGE_TYPES.has(edge.type));
}

function downstreamAccounts(graph: GraphSnapshot, accountId: string, maxDepth = 3): Set<string> {
  const accountIds = new Set(
    graph.nodes.filter((node) => node.type === 'ACCOUNT').map((node) => node.nodeId),
  );
  const reached = new Set<string>();
  const visited = new Set([accountId]);
  const queue = [{ accountId, depth: 0 }];
  const edges = financialEdges(graph);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth >= maxDepth) continue;
    for (const edge of edges) {
      if (edge.fromNodeId !== current.accountId || !accountIds.has(edge.toNodeId)) continue;
      reached.add(edge.toNodeId);
      if (visited.has(edge.toNodeId)) continue;
      visited.add(edge.toNodeId);
      queue.push({ accountId: edge.toNodeId, depth: current.depth + 1 });
    }
  }
  reached.delete(accountId);
  return reached;
}

function reportedNetworkAccounts(graph: GraphSnapshot): Set<string> {
  const roots = new Set(
    graph.edges.filter((edge) => edge.type === 'PAID_TO').map((edge) => edge.toNodeId),
  );
  const accounts = new Set<string>();
  for (const root of roots) {
    accounts.add(root);
    for (const account of downstreamAccounts(graph, root)) accounts.add(account);
  }
  return accounts;
}

function reachableEdgeKeys(graph: GraphSnapshot, accountId: string): Set<string> {
  const reachable = downstreamAccounts(graph, accountId);
  const nodes = new Set([accountId, ...reachable]);
  return new Set(
    financialEdges(graph)
      .filter((edge) => nodes.has(edge.fromNodeId) && nodes.has(edge.toNodeId))
      .map((edge) => `${edge.type}:${edge.fromNodeId}->${edge.toNodeId}`),
  );
}

function allEdgeKeys(graph: GraphSnapshot): Set<string> {
  return new Set(
    financialEdges(graph).map((edge) => `${edge.type}:${edge.fromNodeId}->${edge.toNodeId}`),
  );
}

function intersection<T>(left: Set<T>, right: Set<T>): T[] {
  return [...left].filter((value) => right.has(value));
}

function opaqueMatchReference(historicalCaseId: string, accountId: string): string {
  const digest = createHash('sha256')
    .update(`cross-case-match:v1:${historicalCaseId}:${accountId}`)
    .digest('hex');
  return `match:${digest.slice(0, 24)}`;
}

function outcomeReason(status: HistoricalInstitutionalOutcome['status']): string {
  switch (status) {
    case 'CONFIRMED':
      return 'TRUSTED_CONFIRMED_OUTCOME';
    case 'SUSPECTED':
      return 'SUSPECTED_OUTCOME_DISCOUNTED';
    case 'CLEARED':
      return 'CLEARED_HISTORY_EXCLUDED';
    case 'NO_INSTITUTIONAL_OUTCOME':
      return 'UNRESOLVED_HISTORY_DISCOUNTED';
  }
}

function signalForAccount(
  currentGraph: GraphSnapshot,
  accountId: string,
  historicalCases: HistoricalCaseEvidence[],
): AccountCorrelationSignal {
  const currentDownstream = downstreamAccounts(currentGraph, accountId);
  const currentEdgeKeys = reachableEdgeKeys(currentGraph, accountId);
  const sharedDownstream = new Set<string>();

  const matches = historicalCases.flatMap((history) => {
    const historicalAccounts = reportedNetworkAccounts(history.graph);
    const directAccountReuse = historicalAccounts.has(accountId);
    const sharedAccounts = intersection(currentDownstream, historicalAccounts).sort();
    const sharedEdges = intersection(currentEdgeKeys, allEdgeKeys(history.graph)).sort();
    if (!directAccountReuse && sharedAccounts.length === 0 && sharedEdges.length === 0) return [];

    for (const sharedAccount of sharedAccounts) sharedDownstream.add(sharedAccount);
    const rawSimilarity =
      (directAccountReuse ? 0.45 : 0) +
      Math.min(1, sharedAccounts.length / 2) * 0.35 +
      Math.min(1, sharedEdges.length / 2) * 0.2;
    const evidenceWeight = roundSignal(rawSimilarity * OUTCOME_MULTIPLIER[history.outcome.status]);
    const reasonCodes = [
      ...(directAccountReuse ? ['DIRECT_ACCOUNT_REUSE'] : []),
      ...(sharedAccounts.length > 0 ? ['SHARED_DOWNSTREAM_CONVERGENCE'] : []),
      ...(sharedEdges.length > 0 ? ['REPEATED_FINANCIAL_EDGE'] : []),
      outcomeReason(history.outcome.status),
    ];
    return [
      {
        matchReference: opaqueMatchReference(history.caseId, accountId),
        historicalGraphVersion: history.graph.graphVersion,
        outcomeStatus: history.outcome.status,
        directAccountReuse,
        sharedDownstreamAccountCount: sharedAccounts.length,
        sharedEdgeCount: sharedEdges.length,
        evidenceWeight,
        reasonCodes,
      },
    ];
  });

  matches.sort((left, right) => left.matchReference.localeCompare(right.matchReference));
  const crossCaseLinkage = roundSignal(
    1 - matches.reduce((remaining, match) => remaining * (1 - match.evidenceWeight), 1),
  );
  const reasonCodes = [...new Set(matches.flatMap((match) => match.reasonCodes))].sort();

  return {
    accountId,
    crossCaseLinkage,
    matchedCaseCount: matches.length,
    confirmedOutcomeCaseCount: matches.filter((match) => match.outcomeStatus === 'CONFIRMED')
      .length,
    suspectedOutcomeCaseCount: matches.filter((match) => match.outcomeStatus === 'SUSPECTED')
      .length,
    clearedOutcomeCaseCount: matches.filter((match) => match.outcomeStatus === 'CLEARED').length,
    sharedDownstreamAccountIds: [...sharedDownstream].sort(),
    reasonCodes: reasonCodes.length > 0 ? reasonCodes : ['NO_CROSS_CASE_NETWORK_MATCH'],
    matches,
  };
}

export function correlateCrossCaseNetworks(
  currentGraph: GraphSnapshot,
  rawHistoricalCases: HistoricalCaseEvidence[],
  context: CrossCaseCorrelationContext,
): CrossCaseCorrelationSnapshot {
  const historicalCases = rawHistoricalCases
    .map((history) => HistoricalCaseEvidenceSchema.parse(history))
    .filter((history) => history.caseId !== currentGraph.caseId)
    .sort(
      (left, right) =>
        left.caseId.localeCompare(right.caseId) ||
        left.graph.graphVersion - right.graph.graphVersion,
    );
  const accountIds = [...reportedNetworkAccounts(currentGraph)].sort();

  return CrossCaseCorrelationSnapshotSchema.parse({
    correlationRunId: context.correlationRunId,
    caseId: currentGraph.caseId,
    graphVersion: currentGraph.graphVersion,
    evaluatedAt: context.evaluatedAt,
    accountSignals: accountIds.map((accountId) =>
      signalForAccount(currentGraph, accountId, historicalCases),
    ),
    ruleVersion: 'cross-case-correlation-v1',
    calculationInputHash: context.calculationInputHash,
  });
}
