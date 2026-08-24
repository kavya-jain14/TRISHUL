import { z } from 'zod';

export const IdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);

export const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const CurrencySchema = z.literal('INR');

export const MoneySchema = z
  .object({
    amountMinor: z.number().int().nonnegative(),
    currency: CurrencySchema.default('INR'),
  })
  .strict();

export const EvidenceStateSchema = z.enum(['OBSERVED', 'SIMULATED', 'SUBMITTED', 'VERIFIED']);

export const ProvenanceSchema = z
  .object({
    sourceType: z.enum(['BANK', 'PSP', 'FI', 'COMPLAINT', 'ANALYST', 'SIMULATOR']),
    sourceName: z.string().trim().min(1).max(128),
    sourceEventId: IdentifierSchema,
    observedAt: IsoDateTimeSchema,
    evidenceState: EvidenceStateSchema,
    integrityHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();

export type Money = z.infer<typeof MoneySchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
