# Trust/Access runtime boundary

TRISHUL supports two explicit API modes:

- `DEVELOPMENT_OPTIONAL` keeps the deterministic presentation simulator usable without issuing
  credentials.
- `ENFORCED` requires a valid case-scoped Bearer session for canonical Case and Account routes.

Production fails to start unless `TRISHUL_TRUST_ACCESS_MODE=ENFORCED` and at least one active issuer
public key is supplied through `TRISHUL_TRUSTED_ISSUERS_JSON`. Only issuer public keys belong in this
configuration; issuer or subject private keys must never be provided to the API.

`TRISHUL_REVOKED_CREDENTIAL_IDS_JSON` can preload emergency revocations. Issuer registration,
revocation, challenges, and sessions are still in-memory in this checkpoint. Durable repositories,
key rotation, and authenticated two-person governance remain required before a production rollout.
