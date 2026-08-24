# Evidence anchor backend slice

This checkpoint accelerates the backend integrity work from the later delivery stage. It does not change the Phase 4 prediction boundary: geo/time ranking and continuous reforecasting remain separate work.

## API flow

1. `POST /api/v1/cases/:caseId/evidence-anchors` accepts an evidence reference and JSON evidence. Every request requires `Idempotency-Key`.
2. TRISHUL canonicalises the JSON and computes its SHA-256 digest.
3. Only the evidence digest, a derived submission digest, and the timestamp cross the `EvidenceAnchorProvider` boundary.
4. The API persists a receipt containing provider, network, anchor reference, transaction hash, and timestamps. It never stores the submitted evidence body in the anchor table.
5. `POST /api/v1/evidence-anchors/:anchorId/verify` recomputes the supplied payload digest and verifies the provider receipt. Payload integrity and ledger integrity are reported independently.
6. `GET /api/v1/evidence-anchors/:anchorId` returns the stored receipt without raw evidence.

## Privacy and product boundary

- Blockchain is used for evidence integrity and anchoring, not to trace UPI transfers.
- No case ID, evidence reference, account reference, transaction reference, or raw evidence is sent to the provider.
- The development provider is an in-memory deterministic hashchain. Its receipt is explicitly labelled `TRISHUL_DEVELOPMENT_HASHCHAIN` on `in-memory-development`; it is not represented as a public-chain transaction.
- `REMOTE_GATEWAY` is the production adapter for an authorised chain/consortium-ledger gateway. It
  submits only the evidence/submission hashes and timestamp, receives the real network transaction
  receipt, and asks the gateway to verify the exact anchor reference and transaction hash.
- Production refuses to start with the development hashchain. The remote adapter requires HTTPS,
  a service token, bounded responses, an operation timeout, and submission-hash idempotency.
- A gateway receipt must echo the exact evidence and submission hashes before TRISHUL persists it;
  a valid-looking receipt for different hashes is rejected.
- Gateway responses are streamed through a 64 KiB hard cap instead of being buffered before their
  size is checked.

## Idempotency and immutability

- Repeating the same request with the same idempotency key returns the original receipt.
- Reusing that key with changed evidence returns `IDEMPOTENCY_KEY_REUSED`.
- Re-submitting the same case/evidence digest under another key reuses the original anchor rather than creating a second chain receipt.
- PostgreSQL uniqueness constraints protect submission digests, anchor references, transaction hashes, and case-scoped idempotency keys.

## Persistence

Migration `002_evidence_anchor_receipts.sql` stores only digest and receipt metadata linked to the existing internal case row. The PostgreSQL adapter reloads receipts and idempotency state after service recreation.

## Verified acceptance

- Canonical hashes are stable across JSON key order.
- Mutated evidence fails payload verification while the original ledger receipt remains valid.
- Provider inputs and HTTP receipts do not expose raw evidence or private account references.
- Unknown cases cannot create anchors.
- In-memory and PostgreSQL adapters cover create, replay, read, and verify flows.
- Remote-adapter tests cover receipt validation, exact transaction verification, privacy, secure
  configuration, bounded responses, and non-leaking errors.
- The full repository test, typecheck, format, and production-build gates remain green.
