import { z } from "zod";
import { geoCandidateSchema } from "../../contracts/src/case.ts";

export const transactionEventSchema = z
  .object({
    eventId: z.string().min(1),
    transactionId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    sequence: z.int().nonnegative(),
    occurredAt: z.iso.datetime({ offset: true }),
    fromAccountId: z.string().min(1),
    toAccountId: z.string().min(1),
    amountPaise: z.int().positive(),
    channel: z.enum(["UPI", "IMPS", "NEFT", "ATM_CASH_WITHDRAWAL"]),
    locationId: z.string().min(1).optional(),
    provenance: z.object({
      providerId: z.string().min(1),
      providerReference: z.string().min(1),
      recordedAt: z.iso.datetime({ offset: true })
    }).strict().default({ providerId: "DEMO_UNSPECIFIED", providerReference: "UNSPECIFIED", recordedAt: "2026-08-24T00:00:00.000Z" }),
    intelligence: z
      .object({
        complaintLinkCount: z.int().nonnegative().default(0),
        sharedDeviceCount: z.int().nonnegative().default(0),
        reportedMuleProximity: z.int().nonnegative().default(0),
        priorCashOutCount: z.int().nonnegative().default(0),
        geoCandidates: z.array(geoCandidateSchema).max(5).default([])
      })
      .strict()
      .default({ complaintLinkCount: 0, sharedDeviceCount: 0, reportedMuleProximity: 0, priorCashOutCount: 0, geoCandidates: [] }),
    source: z.enum(["SYNTHETIC_LEDGER", "AUTHORISED_PARTNER"])
  })
  .strict();

export type TransactionEvent = z.infer<typeof transactionEventSchema>;

export const traceSeedSchema = z
  .object({
    transactionId: z.string().min(1),
    caseId: z.string().min(1),
    maxHops: z.int().min(1).max(4).default(4)
  })
  .strict();

export type TraceSeed = z.infer<typeof traceSeedSchema>;

