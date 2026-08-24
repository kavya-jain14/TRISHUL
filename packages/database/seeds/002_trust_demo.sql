-- ============================================
-- TRISHUL TRUST LAYER — DEMO SEED DATA
-- ============================================

-- 1. TRUSTED ISSUERS
INSERT INTO trust_issuers (
    issuer_id,
    public_key_pem,
    active,
    created_at,
    updated_at
)
VALUES
(
    'BANK_ALPHA_DEMO',
    '-----BEGIN PUBLIC KEY-----\nDEMO_BANK_ALPHA_PUBLIC_KEY\n-----END PUBLIC KEY-----',
    TRUE,
    NOW() - INTERVAL '30 days',
    NOW()
),
(
    'PSP_TRUST_DEMO',
    '-----BEGIN PUBLIC KEY-----\nDEMO_PSP_PUBLIC_KEY\n-----END PUBLIC KEY-----',
    TRUE,
    NOW() - INTERVAL '20 days',
    NOW()
),
(
    'OLD_BANK_DEMO',
    '-----BEGIN PUBLIC KEY-----\nDEMO_OLD_BANK_PUBLIC_KEY\n-----END PUBLIC KEY-----',
    FALSE,
    NOW() - INTERVAL '90 days',
    NOW() - INTERVAL '10 days'
);


-- 2. REVOKED CREDENTIAL
-- Demo: an old credential was revoked and should no longer be trusted.
INSERT INTO trust_revoked_credentials (
    credential_id,
    revoked_at
)
VALUES
(
    'cred-old-receiver-009',
    NOW() - INTERVAL '2 days'
);


-- 3. TRUST CHALLENGES
-- Challenge A = successfully consumed
INSERT INTO trust_challenges (
    challenge_id,
    nonce,
    subject_id,
    capability,
    purpose,
    case_id,
    issued_at,
    expires_at,
    consumed_at
)
VALUES
(
    '11111111-1111-4111-8111-111111111111',
    'nonce-trishul-demo-001',
    'receiver-account-AX92',
    'VERIFY_KYC_STATUS',
    'PRE_TRANSACTION_TRUST_CHECK',
    NULL,
    NOW() - INTERVAL '5 minutes',
    NOW() + INTERVAL '5 minutes',
    NOW() - INTERVAL '4 minutes'
);


-- Challenge B = active challenge for investigation access
INSERT INTO trust_challenges (
    challenge_id,
    nonce,
    subject_id,
    capability,
    purpose,
    case_id,
    issued_at,
    expires_at,
    consumed_at
)
VALUES
(
    '22222222-2222-4222-8222-222222222222',
    'nonce-trishul-case-101',
    'investigator-demo-01',
    'READ_CASE_INTELLIGENCE',
    'FRAUD_INVESTIGATION',
    'CASE-TRI-101',
    NOW(),
    NOW() + INTERVAL '10 minutes',
    NULL
);


-- Challenge C = expired, never consumed
INSERT INTO trust_challenges (
    challenge_id,
    nonce,
    subject_id,
    capability,
    purpose,
    case_id,
    issued_at,
    expires_at,
    consumed_at
)
VALUES
(
    '33333333-3333-4333-8333-333333333333',
    'nonce-expired-demo-003',
    'receiver-account-BX17',
    'VERIFY_KYC_STATUS',
    'PRE_TRANSACTION_TRUST_CHECK',
    NULL,
    NOW() - INTERVAL '30 minutes',
    NOW() - INTERVAL '20 minutes',
    NULL
);


-- 4. TRUST SESSION
-- Bank/PSP verified receiver credential.
INSERT INTO trust_sessions (
    token_digest,
    session_id,
    credential_id,
    issuer_id,
    subject_id,
    role,
    capabilities,
    purpose,
    case_id,
    issued_at,
    expires_at
)
VALUES
(
    '7d819c52a1dd73b6326431129996871aa3dc0ec68b634630272e5e58f498d907',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'cred-receiver-verified-001',
    'BANK_ALPHA_DEMO',
    'receiver-account-AX92',
    'ACCOUNT_HOLDER',
    '[
        "VERIFY_KYC_STATUS",
        "PROVE_ACCOUNT_VERIFIED"
    ]'::jsonb,
    'PRE_TRANSACTION_TRUST_CHECK',
    NULL,
    NOW(),
    NOW() + INTERVAL '30 minutes'
);


-- 5. CASE INTELLIGENCE SESSION
-- Authorised investigator gets scoped access only for CASE-TRI-101.
INSERT INTO trust_sessions (
    token_digest,
    session_id,
    credential_id,
    issuer_id,
    subject_id,
    role,
    capabilities,
    purpose,
    case_id,
    issued_at,
    expires_at
)
VALUES
(
    '8b54873142ad01fae55a5e467d346d2e58fa045067b2ab3a839d5619e2444173',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cred-investigator-demo-001',
    'PSP_TRUST_DEMO',
    'investigator-demo-01',
    'AUTHORISED_INVESTIGATOR',
    '[
        "READ_CASE_INTELLIGENCE",
        "READ_TRACE_GRAPH",
        "READ_EXPOSURE",
        "READ_RISK_ASSESSMENT"
    ]'::jsonb,
    'FRAUD_INVESTIGATION',
    'CASE-TRI-101',
    NOW(),
    NOW() + INTERVAL '45 minutes'
);
