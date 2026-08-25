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

## Durable persistence and identity boundary

- With `DATABASE_URL`, issuer state, revocations, challenges, token digests, sessions, trust audit
  records, and identity-resolution decisions use PostgreSQL migration `006_trust_persistence.sql`.
- Challenge consumption and identity decisions use conditional writes so replay or concurrent
  approval cannot create a second outcome.
- Identity resolution uses separate request and approval capabilities, requires the same case scope,
  and forbids the requester from deciding their own request.
- The API returns only an opaque provider reference. It never returns KYC, address, national ID, or
  other resolved PII.
- The reference-only provider is explicitly a development adapter. Production returns an unavailable
  response until an authorised institutional provider adapter is configured.

## Prototype boundary

- This is signed challenge-response credential verification, not a claim that a full anonymous
  PrivacyPass/ZKP protocol is already implemented.
- In-memory repositories are development adapters. Production startup requires PostgreSQL-backed
  Trust/Access persistence.
- Issuer registration and revocation are intentionally not exposed as public HTTP routes. Their
  production administration needs authenticated governance and audit anchoring first.
- `enforceTrustAccess` is optional only for the deterministic presentation simulator. Identity
  resolution remains authenticated even in that mode.

## Next hardening slice

- authenticated issuer/admin governance with append-only audit events;
- key rotation and retention policy;
- authorised institutional identity-provider integration with audited access delivery;
- a real PrivacyPass/ZKP verifier adapter once an issuer protocol and cryptographic suite are locked.
