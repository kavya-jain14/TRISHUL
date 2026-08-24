# Trust/Access runtime boundary

TRISHUL supports two explicit API modes:

- `DEVELOPMENT_OPTIONAL` keeps the deterministic presentation simulator usable without issuing
  credentials.
- `ENFORCED` requires a valid case-scoped Bearer session for canonical Case and Account routes.

Production fails to start unless `TRISHUL_TRUST_ACCESS_MODE=ENFORCED`, `DATABASE_URL` selects durable
PostgreSQL persistence, and the resulting repository contains at least one active issuer. Public
issuer keys may be bootstrapped through `TRISHUL_TRUSTED_ISSUERS_JSON`; issuer or subject private keys
must never be provided to the API.

`TRISHUL_REVOKED_CREDENTIAL_IDS_JSON` can preload emergency revocations into the selected repository.
There is no public issuer-registration, revocation, or audit-admin endpoint. Authenticated governance,
key rotation, and an authorised production identity provider remain required before rollout.

Identity-resolution routes always require verified case-scoped Bearer sessions, including in
`DEVELOPMENT_OPTIONAL` mode. Development returns a clearly simulated opaque provider reference;
production fails the operation until a real authorised provider is configured. Resolved PII never
crosses this API response boundary.
