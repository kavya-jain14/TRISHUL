import { z } from 'zod';
import { IsoDateTimeSchema } from './common.js';

export const BlockchainAnchorReceiptSchema = z
  .object({
    txRef: z.string(),
    anchorTimestamp: IsoDateTimeSchema,
  })
  .strict();

export type BlockchainAnchorReceipt = z.infer<typeof BlockchainAnchorReceiptSchema>;

export interface BlockchainAnchorService {
  anchor(hash: string, metadata: Record<string, string>): Promise<BlockchainAnchorReceipt>;
  verify(txRef: string, expectedHash: string): Promise<boolean>;
}
