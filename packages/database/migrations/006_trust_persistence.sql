-- 006_trust_persistence.sql

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
    request_justification TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'FAILED')),
    decided_by VARCHAR(255),
    decision_justification TEXT,
    provider_reference VARCHAR(255),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMPTZ,
    CHECK (
        (status = 'PENDING' AND decided_by IS NULL AND resolved_at IS NULL)
        OR
        (status <> 'PENDING' AND decided_by IS NOT NULL AND decision_justification IS NOT NULL AND resolved_at IS NOT NULL)
    )
);

CREATE INDEX idx_identity_resolution_case_status
    ON trust_identity_resolution_requests(case_id, status);

CREATE TABLE trust_audit_records (
    audit_id UUID PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    action VARCHAR(255) NOT NULL,
    actor_id VARCHAR(255) NOT NULL,
    target_id VARCHAR(255),
    details JSONB NOT NULL,
    integrity_hash VARCHAR(255) NOT NULL
);
