# Product and engineering lock

## Positioning

TRISHUL is one case-to-cash-out intelligence system:

1. **Trust:** PrivacyPass verifies receiver or investigator credentials, revocation state, role, and purpose.
2. **Risk:** TRINETRA evaluates observable payer, receiver, transaction, and network signals.
3. **Trace:** A complaint plus transaction reference anchors a case; authorised provider events expand the graph.
4. **Exposure:** The system recomputes a fraud-attributable range after commingling.
5. **Predict or abstain:** Exit mode is ranked first. Geo zone and time horizon are emitted only for dimensions that pass their Evidence Gate.
6. **Intervene and learn:** Authorised users receive evidence-backed intelligence, record actions, and capture outcomes.

## Claims we do not make

- TRISHUL does not detect a payer's human intent.
- KYC or a zero-knowledge credential does not mean the receiver is safe.
- One complaint, fast transfer, or network edge does not confirm a mule account.
- Blockchain does not trace private UPI transactions or reveal account ownership.
- The prototype does not have live NPCI, bank, or I4C data access.
- A map is not always available. `ABSTAIN` and `MONITORING` are correct outcomes.
- A ranked zone is not an exact ATM or guaranteed cash-out location.

## Core state machine

```text
NORMAL -> ANOMALOUS -> WATCH -> REPORTED -> ACTIVE -> TRACE -> EXPOSURE
       -> RISK_ASSESSED -> EXIT_MODE -> EVIDENCE_GATE
       -> PREDICT | ABSTAIN -> INTERVENTION | MONITORING -> OUTCOME -> CLOSED
```

Transitions are validated in `packages/contracts`; invalid jumps are rejected.

## Evidence rules

- Every graph edge records provider/source, source event reference, observation time, case link, and evidence state.
- Missing downstream provider visibility terminates the observed graph at an explicit boundary.
- Every forecast stores graph version, feature version, model/rule version, evidence coverage, reasons, and withheld dimensions.
- Important historical snapshots are append-only at the product level.
