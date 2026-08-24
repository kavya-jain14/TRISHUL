# TRISHUL repository instructions

## Non-negotiable product doctrine

- Never infer or label human intent.
- Keep trust, behavioural risk, network risk, and institutional outcome separate.
- A complaint anchors a case and contributes labelled network memory. It is not, by itself, proof that an account is fraudulent.
- Never create a graph edge without transaction/provider provenance.
- Never claim exact rupee identity after commingling; use a fraud-attributable exposure range.
- Geo and time dimensions must be able to abstain independently.
- `CONFIRMED` requires a trusted authorised outcome. Rules or models may only recommend `SUSPECTED_MULE`.
- Blockchain is limited to integrity anchors and credential/revocation references. It never creates private UPI edges or reveals KYC identity.

## Engineering rules

- Shared runtime contracts live in `packages/contracts` and land before dependent UI/API code.
- Money values use integer minor units. Never use binary floating point for rupees.
- Writes require an idempotency key at the HTTP boundary once their routes are implemented.
- Version important graph, risk, exposure, and forecast history; do not silently overwrite it.
- Use deterministic fixtures for the golden demo. The frontend must not invent backend graph edges.
- Tests must cover negative and abstention paths, not only the happy path.
- Run `npm run check` before opening or updating a PR.

## Git workflow

- Do not commit feature work directly to `main`.
- Pull latest before creating a branch.
- Use the branch names assigned in `docs/TEAM_WORKFLOW.md`.
- Keep PRs scoped to one owner/module and document contract changes.
