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

/** Contract Vatsal's production trust registry must satisfy at the API boundary. */
export const credentialAccessResultSchema = z.object({
  grantId: z.string().min(1),
  caseId: z.string().min(1),
  expiresAt: z.iso.datetime({ offset: true })
}).strict();

