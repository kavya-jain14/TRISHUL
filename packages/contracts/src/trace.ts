import { z } from 'zod';
import { IdentifierSchema } from './common.js';
import { GraphSnapshotSchema } from './graph.js';
import { ProviderEventSchema, ResolveTransactionEventSchema } from './provider-events.js';

export const IdempotencyKeySchema = IdentifierSchema.max(96);

export const ResolveTransactionRequestSchema = ResolveTransactionEventSchema;

export const ProviderEventBatchSchema = z
  .object({
    events: z.array(ProviderEventSchema).min(1).max(100),
  })
  .strict();

export const ProviderEventIngestResultSchema = z
  .object({
    caseId: IdentifierSchema,
    acceptedEventIds: z.array(IdentifierSchema),
    duplicateEventIds: z.array(IdentifierSchema),
    totalLedgerEvents: z.number().int().nonnegative(),
    replayed: z.boolean(),
  })
  .strict();

export const TraceRunResultSchema = z
  .object({
    caseId: IdentifierSchema,
    changed: z.boolean(),
    graphVersion: z.number().int().nonnegative(),
    processedEventIds: z.array(IdentifierSchema),
    nodeCount: z.number().int().nonnegative(),
    edgeCount: z.number().int().nonnegative(),
    coverageBoundary: z.string().trim().min(1).max(240),
    replayed: z.boolean(),
  })
  .strict();

export const CaseGraphResponseSchema = z
  .object({
    graph: GraphSnapshotSchema,
  })
  .strict();

export type ProviderEventBatch = z.infer<typeof ProviderEventBatchSchema>;
export type ProviderEventIngestResult = z.infer<typeof ProviderEventIngestResultSchema>;
export type TraceRunResult = z.infer<typeof TraceRunResultSchema>;
