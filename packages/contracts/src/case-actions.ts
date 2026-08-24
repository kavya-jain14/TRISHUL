import { z } from 'zod';
import { IdentifierSchema, IsoDateTimeSchema } from './common.js';

export const CaseActionTypeSchema = z.enum([
  'ALERT_BANK',
  'ALERT_LEA',
  'ESCALATE_CASE',
  'ADD_ANALYST_NOTE',
  'MARK_OUTCOME',
]);

export const CaseActionRequestSchema = z
  .object({
    actionId: IdentifierSchema,
    action: CaseActionTypeSchema,
    actorRef: IdentifierSchema,
    purpose: z.string().trim().min(1).max(240),
    rationale: z.string().trim().min(1).max(2_000),
    sourceUrls: z.array(z.string().url()).min(1).max(20),
    occurredAt: IsoDateTimeSchema,
  })
  .strict();

export const CaseActionRecordSchema = CaseActionRequestSchema.extend({
  caseId: IdentifierSchema,
  recordedAt: IsoDateTimeSchema,
}).strict();

export const CaseActionEventPayloadSchema = z
  .object({
    action: CaseActionRecordSchema,
  })
  .strict();

export type CaseActionRequest = z.infer<typeof CaseActionRequestSchema>;
export type CaseActionRecord = z.infer<typeof CaseActionRecordSchema>;
export type CaseActionEventPayload = z.infer<typeof CaseActionEventPayloadSchema>;
