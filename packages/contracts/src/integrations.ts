import { z } from "zod";

/** Event contract emitted by a bank/PSP adapter into Fuzail's ledger pipeline. */
export const providerTransactionEventSchema = z.object({
  eventId: z.string().min(1),
  transactionId: z.string().min(1),
  providerReference: z.string().min(1),
  providerId: z.string().min(1),
  occurredAt: z.iso.datetime({ offset: true }),
  source: z.enum(["SYNTHETIC_LEDGER", "AUTHORISED_PARTNER"])
}).strict();

const providerEventEnvelope = {
  eventId: z.string().min(1),
  providerId: z.string().min(1),
  providerReference: z.string().min(1),
  occurredAt: z.iso.datetime({ offset: true }),
  source: z.enum(["SYNTHETIC_LEDGER", "AUTHORISED_PARTNER"])
} as const;

export const providerCashOutEventSchema = z.object({
  ...providerEventEnvelope,
  type: z.literal("CASH_OUT"),
  caseId: z.string().min(1),
  transactionId: z.string().min(1),
  accountId: z.string().min(1),
  amountPaise: z.int().positive(),
  channel: z.enum(["ATM_CASH_WITHDRAWAL", "BRANCH_WITHDRAWAL", "MERCHANT_CASH_OUT"]),
  locationId: z.string().min(1).optional(),
  endpointReference: z.string().min(1).optional()
}).strict();

export const providerAccountStatusEventSchema = z.object({
  ...providerEventEnvelope,
  type: z.literal("ACCOUNT_STATUS"),
  accountId: z.string().min(1),
  status: z.enum(["ACTIVE", "UNDER_REVIEW", "RESTRICTED", "CLOSED"]),
  reason: z.string().min(1).optional()
}).strict();

export const providerResolveTransactionEventSchema = z.object({
  ...providerEventEnvelope,
  type: z.literal("RESOLVE_TRANSACTION"),
  caseId: z.string().min(1),
  originalReference: z.string().min(1),
  transactionId: z.string().min(1),
  beneficiaryAccountId: z.string().min(1),
  amountPaise: z.int().positive()
}).strict();

export const providerRestrictionActionEventSchema = z.object({
  ...providerEventEnvelope,
  type: z.literal("RESTRICTION_ACTION"),
  caseId: z.string().min(1),
  accountId: z.string().min(1),
  action: z.enum(["MONITOR", "ALERT_BANK", "RESTRICT", "RELEASE"]),
  actorReference: z.string().min(1),
  reason: z.string().min(1)
}).strict();

export const providerOutcomeEventSchema = z.object({
  ...providerEventEnvelope,
  type: z.literal("OUTCOME"),
  caseId: z.string().min(1),
  actualExitMode: z.enum(["STATIONARY", "FORWARD", "CASH_OUT"]),
  accountId: z.string().min(1),
  locationId: z.string().min(1).optional(),
  channel: z.enum(["UPI", "IMPS", "NEFT", "ATM_CASH_WITHDRAWAL", "BRANCH_WITHDRAWAL", "MERCHANT_CASH_OUT"]).optional()
}).strict();

export const providerOperationalEventSchema = z.discriminatedUnion("type", [
  providerCashOutEventSchema,
  providerAccountStatusEventSchema,
  providerResolveTransactionEventSchema,
  providerRestrictionActionEventSchema,
  providerOutcomeEventSchema
]);

export type ProviderOperationalEvent = z.infer<typeof providerOperationalEventSchema>;
export type ProviderResolveTransactionEvent = z.infer<typeof providerResolveTransactionEventSchema>;

export const complaintProviderResolutionRequestSchema = z.object({
  caseId: z.string().min(1),
  providerReference: z.string().min(1)
}).strict();

export type ComplaintProviderResolutionRequest = z.infer<typeof complaintProviderResolutionRequestSchema>;

/** Contract Vatsal's production trust registry must satisfy at the API boundary. */
export const credentialAccessResultSchema = z.object({
  grantId: z.string().min(1),
  caseId: z.string().min(1),
  expiresAt: z.iso.datetime({ offset: true })
}).strict();

