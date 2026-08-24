import { hashEvidence, type EvidenceAnchorProvider } from './evidence-hash.js';

interface HashchainEntry {
  evidenceHash: string;
  submissionHash: string;
  anchoredAt: string;
  previousTransactionHash: string | null;
  transactionHash: string;
  anchorReference: string;
}

/**
 * Deterministic development adapter for the blockchain boundary.
 *
 * It stores only hashes and receipt metadata, never case IDs, evidence references,
 * raw evidence, account identifiers, or other PII. A production adapter can replace
 * this provider without changing the API/service contracts.
 */
export class DevelopmentHashchainProvider implements EvidenceAnchorProvider {
  readonly #entriesBySubmission = new Map<string, HashchainEntry>();
  readonly #entriesByReference = new Map<string, HashchainEntry>();
  #head: string | null = null;

  async anchor(input: {
    evidenceHash: string;
    submissionHash: string;
    anchoredAt: string;
  }): Promise<{
    provider: string;
    network: string;
    anchorReference: string;
    transactionHash: string;
  }> {
    const replay = this.#entriesBySubmission.get(input.submissionHash);
    if (replay) {
      if (replay.evidenceHash !== input.evidenceHash) {
        throw new Error('Anchor submission hash was reused with a different evidence hash');
      }
      return this.#receipt(replay);
    }

    const transactionHash = hashEvidence({
      domain: 'TRISHUL_EVIDENCE_ANCHOR_V1',
      evidenceHash: input.evidenceHash,
      submissionHash: input.submissionHash,
      anchoredAt: input.anchoredAt,
      previousTransactionHash: this.#head,
    });
    const entry: HashchainEntry = {
      ...input,
      previousTransactionHash: this.#head,
      transactionHash,
      anchorReference: `anchor:${transactionHash}`,
    };
    this.#entriesBySubmission.set(input.submissionHash, entry);
    this.#entriesByReference.set(entry.anchorReference, entry);
    this.#head = transactionHash;
    return this.#receipt(entry);
  }

  async verify(input: {
    evidenceHash: string;
    submissionHash: string;
    anchorReference: string;
    transactionHash: string;
  }): Promise<boolean> {
    const entry = this.#entriesByReference.get(input.anchorReference);
    if (!entry) return false;

    const recalculated = hashEvidence({
      domain: 'TRISHUL_EVIDENCE_ANCHOR_V1',
      evidenceHash: entry.evidenceHash,
      submissionHash: entry.submissionHash,
      anchoredAt: entry.anchoredAt,
      previousTransactionHash: entry.previousTransactionHash,
    });
    return (
      entry.evidenceHash === input.evidenceHash &&
      entry.submissionHash === input.submissionHash &&
      entry.transactionHash === input.transactionHash &&
      entry.transactionHash === recalculated
    );
  }

  #receipt(entry: HashchainEntry) {
    return {
      provider: 'TRISHUL_DEVELOPMENT_HASHCHAIN',
      network: 'in-memory-development',
      anchorReference: entry.anchorReference,
      transactionHash: entry.transactionHash,
    };
  }
}
