import { z } from 'zod';
import { IdentifierSchema, IsoDateTimeSchema } from './common.js';

export const AlertSeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const AlertKindSchema = z.enum([
  'TRACE_RISK',
  'EVIDENCE_INTEGRITY',
  'INTERVENTION',
  'SYSTEM',
]);

export const AlertJobPayloadSchema = z
  .object({
    alertId: IdentifierSchema,
    caseId: IdentifierSchema,
    severity: AlertSeveritySchema,
    kind: AlertKindSchema,
    title: z.string().trim().min(1).max(160),
    message: z.string().trim().min(1).max(2_000),
    sourceEventId: IdentifierSchema.optional(),
    sourceUrls: z.array(z.string().url()).max(20).default([]),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export type AlertJobPayload = z.infer<typeof AlertJobPayloadSchema>;
