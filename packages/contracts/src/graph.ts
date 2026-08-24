import { z } from 'zod';
import { IdentifierSchema, IsoDateTimeSchema, MoneySchema, ProvenanceSchema } from './common.js';

export const GraphNodeTypeSchema = z.enum([
  'ACCOUNT',
  'VPA',
  'TRANSACTION',
  'COMPLAINT',
  'CASE',
  'DEVICE',
  'PHONE',
  'QR',
  'MERCHANT',
  'ATM',
  'BRANCH',
  'GEO_ZONE',
  'CREDENTIAL',
  'ISSUER',
  'NETWORK_CLUSTER',
]);

export const GraphEdgeTypeSchema = z.enum([
  'PAID_TO',
  'TRANSFERRED_TO',
  'REPORTED_IN',
  'USES_DEVICE',
  'LINKED_VPA',
  'GENERATED_BY',
  'WITHDREW_AT',
  'NEAR_ZONE',
  'HISTORICAL_ASSOCIATION',
  'CREDENTIAL_OF',
  'ISSUED_BY',
  'REVOKED_AT',
  'RELATED_CASE',
  'CONVERGES_WITH',
]);

export const GraphNodeSchema = z
  .object({
    nodeId: IdentifierSchema,
    caseId: IdentifierSchema,
    type: GraphNodeTypeSchema,
    label: z.string().trim().min(1).max(160),
    firstObservedAt: IsoDateTimeSchema,
  })
  .strict();

export const GraphEdgeSchema = z
  .object({
    edgeId: IdentifierSchema,
    caseId: IdentifierSchema,
    fromNodeId: IdentifierSchema,
    toNodeId: IdentifierSchema,
    type: GraphEdgeTypeSchema,
    transactionId: IdentifierSchema.optional(),
    amount: MoneySchema.optional(),
    occurredAt: IsoDateTimeSchema,
    provenance: ProvenanceSchema,
  })
  .strict();

export const GraphSnapshotSchema = z
  .object({
    caseId: IdentifierSchema,
    graphVersion: z.number().int().positive(),
    generatedAt: IsoDateTimeSchema,
    coverageBoundary: z.string().trim().min(1).max(240).optional(),
    nodes: z.array(GraphNodeSchema),
    edges: z.array(GraphEdgeSchema),
  })
  .strict();

export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type GraphSnapshot = z.infer<typeof GraphSnapshotSchema>;
