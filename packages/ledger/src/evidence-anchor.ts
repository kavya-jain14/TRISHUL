import { createHash } from "node:crypto";
import { evidenceAnchorRequestSchema } from "../../contracts/src/case.ts";

export type EvidenceAnchor = {
  anchorId: string;
  caseId: string;
  evidenceId: string;
  evidenceHash: string;
  previousAnchorHash: string | null;
  anchorHash: string;
  anchoredAt: string;
};

type AnchorInput = { caseId: string; evidenceId: string; content: string; idempotencyKey: string; anchoredAt: string };

export class EvidenceAnchorLedger {
  readonly #anchors: EvidenceAnchor[] = [];
  readonly #anchorByIdempotencyKey = new Map<string, EvidenceAnchor>();

  anchor(rawInput: unknown): { status: "ANCHORED" | "IDEMPOTENT_REPLAY"; anchor: EvidenceAnchor } {
    const input: AnchorInput = evidenceAnchorRequestSchema.parse(rawInput);
    const existing = this.#anchorByIdempotencyKey.get(input.idempotencyKey);
    const evidenceHash = sha256(input.content);
    if (existing !== undefined) {
      if (existing.caseId !== input.caseId || existing.evidenceId !== input.evidenceId || existing.evidenceHash !== evidenceHash) throw new Error(`Idempotency key ${input.idempotencyKey} was reused with different evidence.`);
      return { status: "IDEMPOTENT_REPLAY", anchor: existing };
    }
    const previousAnchorHash = this.#anchors.at(-1)?.anchorHash ?? null;
    const anchor: EvidenceAnchor = Object.freeze({
      anchorId: `anchor-${this.#anchors.length + 1}`, caseId: input.caseId, evidenceId: input.evidenceId, evidenceHash, previousAnchorHash,
      anchorHash: sha256(JSON.stringify({ caseId: input.caseId, evidenceId: input.evidenceId, evidenceHash, previousAnchorHash, anchoredAt: input.anchoredAt })), anchoredAt: input.anchoredAt
    });
    this.#anchors.push(anchor);
    this.#anchorByIdempotencyKey.set(input.idempotencyKey, anchor);
    return { status: "ANCHORED", anchor };
  }

  verify(evidenceId: string, content: string): { valid: boolean; anchor?: EvidenceAnchor; reason: string } {
    const anchor = [...this.#anchors].reverse().find((item) => item.evidenceId === evidenceId);
    if (anchor === undefined) return { valid: false, reason: "No anchor exists for this evidence." };
    if (anchor.evidenceHash !== sha256(content)) return { valid: false, anchor, reason: "Evidence content hash does not match the anchored hash." };
    const chainValid = this.#anchors.every((item, index) => item.previousAnchorHash === (index === 0 ? null : this.#anchors[index - 1]?.anchorHash));
    return { valid: chainValid, anchor, reason: chainValid ? "Evidence and anchor chain are intact." : "The anchor chain is inconsistent." };
  }

  list(): readonly EvidenceAnchor[] {
    return [...this.#anchors];
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

