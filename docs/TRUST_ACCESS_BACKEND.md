# Canonical Trust/Access backend

This module adds the first security-hardening slice to the existing npm/Fastify TRISHUL backend. It
does not introduce another API, package manager, database schema, or blockchain implementation.

## Verified flow

1. A trusted issuer signs fixed, canonical credential claims with Ed25519.
2. The API creates a short-lived challenge bound to one subject, purpose, capability, and case.
3. The credential subject signs that exact challenge with the credential-bound subject key.
4. Verification checks issuer trust, issuer signature, validity dates, unified revocation state,
   subject binding, role/capability policy, purpose, case scope, nonce freshness, and proof signature.
5. Only a successful proof consumes the nonce and creates a short-lived access session.
6. The optional Fastify guard enforces the session against the canonical Case routes. A session
   grants only the capability requested by the verified challenge, not every credential capability.
7. Session tokens are indexed by digest, and later credential revocation or issuer deactivation
   invalidates an already-issued session immediately.

Invalid signatures, mismatched subjects/cases, revoked credentials, replayed nonces, expired
sessions, and privilege escalation are rejected by negative tests.

## Prototype boundary

- This is signed challenge-response credential verification, not a claim that a full anonymous
  PrivacyPass/ZKP protocol is already implemented.
- The in-memory issuer, revocation, challenge, and session stores are replaceable development
  adapters. Production requires durable PostgreSQL or authorised institutional providers.
- Issuer registration and revocation are intentionally not exposed as public HTTP routes. Their
  production administration needs authenticated governance and audit anchoring first.
- `enforceTrustAccess` is opt-in so the deterministic presentation simulator remains runnable
  offline. A production composition root must enable it.

## Next hardening slice

- durable issuer/key-rotation and credential-revocation repositories;
- atomic challenge consumption and session persistence across API replicas;
- authenticated issuer/admin governance with append-only audit events;
- capability-gated evidence reads and two-person lawful identity resolution;
- a real PrivacyPass/ZKP verifier adapter once an issuer protocol and cryptographic suite are locked.
