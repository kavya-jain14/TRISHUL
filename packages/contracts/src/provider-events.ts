import { z } from 'zod';
import { IdentifierSchema, IsoDateTimeSchema, MoneySchema, ProvenanceSchema } from './common.js';

const ProviderEventBaseSchema = z.object({
  eventId: IdentifierSchema,
  caseId: IdentifierSchema,
  occurredAt: IsoDateTimeSchema,
  provenance: ProvenanceSchema,
});

export const TransferEventSchema = ProviderEventBaseSchema.extend({
  type: z.literal('TRANSFER'),
  transactionId: IdentifierSchema,
  providerRef: IdentifierSchema,
  fromAccount: IdentifierSchema,
  toAccount: IdentifierSchema,
  amount: MoneySchema,
}).strict();

export const CashOutEventSchema = ProviderEventBaseSchema.extend({
  type: z.literal('CASH_OUT'),
  account: IdentifierSchema,
  amount: MoneySchema,
  channel: z.enum(['ATM', 'BRANCH', 'MERCHANT', 'OTHER']),
  zone: IdentifierSchema.optional(),
  endpointReference: IdentifierSchema.optional(),
}).strict();

export const AccountStatusEventSchema = ProviderEventBaseSchema.extend({
  type: z.literal('ACCOUNT_STATUS'),
  account: IdentifierSchema,
  status: z.enum(['ACTIVE', 'WATCH', 'RESTRICTED', 'CLOSED']),
}).strict();

export const ResolveTransactionEventSchema = ProviderEventBaseSchema.extend({
  type: z.literal('RESOLVE_TRANSACTION'),
  originalRef: IdentifierSchema,
  beneficiaryAccount: IdentifierSchema,
  provider: z.string().trim().min(1).max(128),
}).strict();

export const RestrictionEventSchema = ProviderEventBaseSchema.extend({
  type: z.literal('RESTRICTION'),
  account: IdentifierSchema,
  action: z.enum(['REVIEW_REQUESTED', 'RESTRICTION_REQUESTED', 'RESTRICTED', 'RELEASED']),
  actorReference: IdentifierSchema,
}).strict();

export const OutcomeEventSchema = ProviderEventBaseSchema.extend({
  type: z.literal('OUTCOME'),
  actualExitMode: z.enum(['STATIONARY', 'FORWARDED', 'CASH_OUT', 'UNKNOWN']),
  zone: IdentifierSchema.optional(),
  cashOutAt: IsoDateTimeSchema.optional(),
  institutionalOutcome: z.enum(['UNRESOLVED', 'SUSPECTED', 'CONFIRMED', 'CLEARED']),
}).strict();

export const ProviderEventSchema = z.discriminatedUnion('type', [
  TransferEventSchema,
  CashOutEventSchema,
  AccountStatusEventSchema,
  ResolveTransactionEventSchema,
  RestrictionEventSchema,
  OutcomeEventSchema,
]);

export type ProviderEvent = z.infer<typeof ProviderEventSchema>;
