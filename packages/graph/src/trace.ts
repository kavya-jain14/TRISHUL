import {
  GraphEdgeSchema,
  GraphNodeSchema,
  GraphSnapshotSchema,
  ProviderEventSchema,
  type GraphEdge,
  type GraphSnapshot,
  type ProviderEvent,
} from '@trishul/contracts';

export interface TraceGraphInput {
  caseId: string;
  originalTransactionRef: string;
  beneficiaryAccount: string;
  events: readonly unknown[];
  currentGraph: GraphSnapshot | null;
  nextGraphVersion: number;
  generatedAt: string;
}

export interface TraceGraphResult {
  changed: boolean;
  graph: GraphSnapshot;
  financialEventIds: string[];
}

function endpointType(channel: 'ATM' | 'BRANCH' | 'MERCHANT' | 'OTHER') {
  if (channel === 'ATM') return 'ATM' as const;
  if (channel === 'BRANCH') return 'BRANCH' as const;
  if (channel === 'MERCHANT') return 'MERCHANT' as const;
  return 'GEO_ZONE' as const;
}

function coverageBoundary(events: readonly ProviderEvent[], beneficiaryAccount: string): string {
  const financial = events
    .filter((event) => event.type === 'TRANSFER' || event.type === 'CASH_OUT')
    .sort(
      (left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) ||
        left.eventId.localeCompare(right.eventId),
    );
  const latest = financial.at(-1);

  if (!latest) {
    return `Resolved to ${beneficiaryAccount}; awaiting authorised downstream provider events.`;
  }

  if (latest.type === 'CASH_OUT') {
    const location = latest.zone ?? latest.endpointReference ?? latest.channel;
    return `Observed cash-out at ${location}; downstream financial visibility ends at this event.`;
  }

  return `Last observed at ${latest.toAccount}; awaiting authorised downstream provider events.`;
}

export function buildTraceGraph(input: TraceGraphInput): TraceGraphResult {
  if (!Number.isSafeInteger(input.nextGraphVersion) || input.nextGraphVersion < 1) {
    throw new RangeError('nextGraphVersion must be a positive safe integer');
  }

  const events = input.events.map((event) => ProviderEventSchema.parse(event));
  const nodes = new Map(
    (input.currentGraph?.nodes ?? []).map((node) => [node.nodeId, structuredClone(node)]),
  );
  const edges = new Map(
    (input.currentGraph?.edges ?? []).map((edge) => [edge.edgeId, structuredClone(edge)]),
  );
  let changed = false;

  const upsertNode = (node: ReturnType<typeof GraphNodeSchema.parse>) => {
    const existing = nodes.get(node.nodeId);
    if (!existing) {
      nodes.set(node.nodeId, node);
      changed = true;
      return;
    }

    if (node.firstObservedAt < existing.firstObservedAt) {
      nodes.set(node.nodeId, { ...existing, firstObservedAt: node.firstObservedAt });
      changed = true;
    }
  };

  upsertNode(
    GraphNodeSchema.parse({
      nodeId: input.beneficiaryAccount,
      caseId: input.caseId,
      type: 'ACCOUNT',
      label: input.beneficiaryAccount,
      firstObservedAt:
        events.find((event) => event.type === 'RESOLVE_TRANSACTION')?.occurredAt ??
        input.generatedAt,
    }),
  );

  const financialEventIds: string[] = [];
  const orderedEvents = [...events].sort(
    (left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId),
  );

  for (const event of orderedEvents) {
    if (event.type === 'TRANSFER') {
      financialEventIds.push(event.eventId);
      upsertNode(
        GraphNodeSchema.parse({
          nodeId: event.fromAccount,
          caseId: input.caseId,
          type: 'ACCOUNT',
          label: event.fromAccount,
          firstObservedAt: event.occurredAt,
        }),
      );
      upsertNode(
        GraphNodeSchema.parse({
          nodeId: event.toAccount,
          caseId: input.caseId,
          type: 'ACCOUNT',
          label: event.toAccount,
          firstObservedAt: event.occurredAt,
        }),
      );

      const edge = GraphEdgeSchema.parse({
        edgeId: `edge:${event.eventId}`,
        caseId: input.caseId,
        fromNodeId: event.fromAccount,
        toNodeId: event.toAccount,
        type: event.transactionId === input.originalTransactionRef ? 'PAID_TO' : 'TRANSFERRED_TO',
        transactionId: event.transactionId,
        amount: event.amount,
        occurredAt: event.occurredAt,
        provenance: event.provenance,
      });
      if (!edges.has(edge.edgeId)) {
        edges.set(edge.edgeId, edge);
        changed = true;
      }
      continue;
    }

    if (event.type === 'CASH_OUT') {
      financialEventIds.push(event.eventId);
      upsertNode(
        GraphNodeSchema.parse({
          nodeId: event.account,
          caseId: input.caseId,
          type: 'ACCOUNT',
          label: event.account,
          firstObservedAt: event.occurredAt,
        }),
      );

      const endpointId = event.zone
        ? `zone:${event.zone}`
        : `endpoint:${event.endpointReference ?? event.eventId}`;
      upsertNode(
        GraphNodeSchema.parse({
          nodeId: endpointId,
          caseId: input.caseId,
          type: event.zone ? 'GEO_ZONE' : endpointType(event.channel),
          label: event.zone ?? event.endpointReference ?? `${event.channel} endpoint`,
          firstObservedAt: event.occurredAt,
        }),
      );

      const edge = GraphEdgeSchema.parse({
        edgeId: `edge:${event.eventId}`,
        caseId: input.caseId,
        fromNodeId: event.account,
        toNodeId: endpointId,
        type: 'WITHDREW_AT',
        amount: event.amount,
        occurredAt: event.occurredAt,
        provenance: event.provenance,
      });
      if (!edges.has(edge.edgeId)) {
        edges.set(edge.edgeId, edge);
        changed = true;
      }
    }
  }

  const graph = GraphSnapshotSchema.parse({
    caseId: input.caseId,
    graphVersion: changed
      ? input.nextGraphVersion
      : (input.currentGraph?.graphVersion ?? input.nextGraphVersion),
    generatedAt: changed
      ? input.generatedAt
      : (input.currentGraph?.generatedAt ?? input.generatedAt),
    coverageBoundary: coverageBoundary(orderedEvents, input.beneficiaryAccount),
    nodes: [...nodes.values()].sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
    edges: [...edges.values()].sort(
      (left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) || left.edgeId.localeCompare(right.edgeId),
    ),
  });

  return { changed, graph, financialEventIds };
}
