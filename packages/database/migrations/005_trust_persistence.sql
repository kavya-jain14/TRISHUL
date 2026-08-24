-- 005_trust_persistence.sql

CREATE TABLE trust_issuers (
    issuer_id VARCHAR(255) PRIMARY KEY,
    public_key_pem TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE trust_revoked_credentials (
    credential_id VARCHAR(255) PRIMARY KEY,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE trust_challenges (
    challenge_id UUID PRIMARY KEY,
    nonce VARCHAR(255) NOT NULL UNIQUE,
    subject_id VARCHAR(255) NOT NULL,
    capability VARCHAR(255) NOT NULL,
    purpose VARCHAR(255) NOT NULL,
    case_id VARCHAR(255),
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);

-- Index for checking active/unconsumed nonces
CREATE INDEX idx_trust_challenges_nonce ON trust_challenges(nonce) WHERE consumed_at IS NULL;

CREATE TABLE trust_sessions (
    token_digest VARCHAR(255) PRIMARY KEY,
    session_id UUID NOT NULL UNIQUE,
    credential_id VARCHAR(255) NOT NULL,
    issuer_id VARCHAR(255) NOT NULL,
    subject_id VARCHAR(255) NOT NULL,
    role VARCHAR(255) NOT NULL,
    capabilities JSONB NOT NULL,
    purpose VARCHAR(255) NOT NULL,
    case_id VARCHAR(255),
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

-- Index to quickly clear expired sessions if needed
CREATE INDEX idx_trust_sessions_expires_at ON trust_sessions(expires_at);

CREATE TABLE trust_identity_resolution_requests (
    request_id UUID PRIMARY KEY,
    case_id VARCHAR(255) NOT NULL,
    investigator_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    supervisor_id VARCHAR(255),
    provider_reference VARCHAR(255),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMPTZ
);

CREATE TABLE trust_audit_records (
    audit_id UUID PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    action VARCHAR(255) NOT NULL,
    actor_id VARCHAR(255) NOT NULL,
    target_id VARCHAR(255),
    details JSONB NOT NULL,
    integrity_hash VARCHAR(255) NOT NULL
);

