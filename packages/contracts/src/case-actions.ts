import { z } from 'zod';
import { IdentifierSchema, IsoDateTimeSchema } from './common.js';
import { CredentialRoleSchema, TrustPurposeSchema } from './trust.js';

export const CaseActionTypeSchema = z.enum([
  'ALERT_BANK',
  'ALERT_LEA',
  'ESCALATE_CASE',
  'ADD_ANALYST_NOTE',
  'ADD_OUTCOME_NOTE',
]);

export const CaseActionRequestSchema = z
  .object({
    actionId: IdentifierSchema,
    action: CaseActionTypeSchema,
    rationale: z.string().trim().min(1).max(2_000),
    evidenceAnchorIds: z.array(IdentifierSchema).min(1).max(20),
    sourceUrls: z.array(z.string().url()).max(20).default([]),
    occurredAt: IsoDateTimeSchema,
  })
  .strict();

export const CaseActionRecordSchema = CaseActionRequestSchema.extend({
  caseId: IdentifierSchema,
  actorRef: IdentifierSchema,
  actorRole: CredentialRoleSchema,
  purpose: TrustPurposeSchema,
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
export type CaseActionType = z.infer<typeof CaseActionTypeSchema>;
