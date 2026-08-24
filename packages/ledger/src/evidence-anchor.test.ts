import assert from "node:assert/strict";
import test from "node:test";
import { EvidenceAnchorLedger } from "./evidence-anchor.ts";

test("anchors evidence without retaining its raw content and verifies integrity", () => {
  const anchors = new EvidenceAnchorLedger();
  const result = anchors.anchor({ caseId: "case-1", evidenceId: "evidence-1", content: "original complaint document", idempotencyKey: "anchor-1", anchoredAt: "2026-08-24T09:00:00.000Z" });
  assert.equal(result.status, "ANCHORED");
  assert.equal(JSON.stringify(result.anchor).includes("original complaint document"), false);
  assert.equal(anchors.verify("evidence-1", "original complaint document").valid, true);
  assert.equal(anchors.verify("evidence-1", "changed complaint document").valid, false);
});

test("keeps anchors idempotent and chained", () => {
  const anchors = new EvidenceAnchorLedger();
  const first = anchors.anchor({ caseId: "case-1", evidenceId: "evidence-1", content: "one", idempotencyKey: "anchor-1", anchoredAt: "2026-08-24T09:00:00.000Z" });
  assert.equal(anchors.anchor({ caseId: "case-1", evidenceId: "evidence-1", content: "one", idempotencyKey: "anchor-1", anchoredAt: "2026-08-24T09:00:00.000Z" }).status, "IDEMPOTENT_REPLAY");
  const second = anchors.anchor({ caseId: "case-1", evidenceId: "evidence-2", content: "two", idempotencyKey: "anchor-2", anchoredAt: "2026-08-24T09:01:00.000Z" });
  assert.equal(second.anchor.previousAnchorHash, first.anchor.anchorHash);
});

