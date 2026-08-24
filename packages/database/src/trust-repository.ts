import type { Pool } from 'pg';
import {
  IdentifierSchema,
  PublicKeyPemSchema,
  TrustAuditRecordSchema,
  TrustIssuerSchema,
  TrustSessionSchema,
  type TrustIssuer,
  type TrustAuditRecord,
  type TrustCapability,
  type TrustPurpose,
  type TrustSession,
} from '@trishul/contracts';

export interface StoredChallenge {
  challengeId: string;
  nonce: string;
  subjectId: string;
  capability: TrustCapability;
  purpose: TrustPurpose;
  caseId?: string;
  issuedAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface StoredSession {
  tokenDigest: string;
  credentialId: string;
  issuerId: string;
  session: TrustSession;
}

export interface TrustRepository {
  registerIssuer(issuerId: string, publicKeyPem: string, active: boolean): Promise<void>;
  setIssuerActive(issuerId: string, active: boolean): Promise<void>;
  revokeCredential(credentialId: string, revokedAt: string): Promise<void>;
  isRevoked(credentialId: string): Promise<boolean>;
  trustedIssuerPublicKey(issuerId: string): Promise<string | null>;
  getIssuers(): Promise<{ issuerId: string; publicKeyPem: string; active: boolean }[]>;
  getAuditRecords(): Promise<TrustAuditRecord[]>;
  appendAuditRecord(record: TrustAuditRecord): Promise<void>;

  saveChallenge(challenge: StoredChallenge): Promise<void>;
  getChallenge(challengeId: string): Promise<StoredChallenge | null>;
  consumeChallenge(challengeId: string, nonce: string, consumedAt: string): Promise<boolean>;

  saveSession(sessionData: StoredSession): Promise<void>;
  getSession(tokenDigest: string): Promise<StoredSession | null>;
}

export class PostgresTrustRepository implements TrustRepository {
  constructor(private readonly pool: Pool) {}

  async registerIssuer(issuerId: string, publicKeyPem: string, active: boolean): Promise<void> {
    const id = IdentifierSchema.parse(issuerId);
    const pem = PublicKeyPemSchema.parse(publicKeyPem);
    await this.pool.query(
      `INSERT INTO trust_issuers (issuer_id, public_key_pem, active)
       VALUES ($1, $2, $3)
       ON CONFLICT (issuer_id) DO UPDATE SET public_key_pem = $2, active = $3, updated_at = CURRENT_TIMESTAMP`,
      [id, pem, active],
    );
  }

  async setIssuerActive(issuerId: string, active: boolean): Promise<void> {
    const id = IdentifierSchema.parse(issuerId);
    await this.pool.query(
      `UPDATE trust_issuers SET active = $2, updated_at = CURRENT_TIMESTAMP WHERE issuer_id = $1`,
      [id, active],
    );
  }

  async revokeCredential(credentialId: string, revokedAt: string): Promise<void> {
    const id = IdentifierSchema.parse(credentialId);
    await this.pool.query(
      `INSERT INTO trust_revoked_credentials (credential_id, revoked_at)
       VALUES ($1, $2)
       ON CONFLICT (credential_id) DO NOTHING`,
      [id, revokedAt],
    );
  }

  async isRevoked(credentialId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM trust_revoked_credentials WHERE credential_id = $1`,
      [credentialId],
    );
    return result.rowCount !== null && result.rowCount > 0;
  }

  async trustedIssuerPublicKey(issuerId: string): Promise<string | null> {
    const result = await this.pool.query(
      `SELECT public_key_pem FROM trust_issuers WHERE issuer_id = $1 AND active = true`,
      [issuerId],
    );
    return result.rows[0]?.public_key_pem ?? null;
  }

  async getIssuers(): Promise<TrustIssuer[]> {
    const result = await this.pool.query(
      `SELECT issuer_id, public_key_pem, active FROM trust_issuers`,
    );
    return result.rows.map((row) =>
      TrustIssuerSchema.parse({
        issuerId: row.issuer_id,
        publicKeyPem: row.public_key_pem,
        active: row.active,
      }),
    );
  }

  async getAuditRecords(): Promise<TrustAuditRecord[]> {
    const result = await this.pool.query(
      `SELECT audit_id, timestamp, action, actor_id, target_id, details, integrity_hash FROM trust_audit_records ORDER BY timestamp DESC`,
    );
    return result.rows.map((row) =>
      TrustAuditRecordSchema.parse({
        auditId: row.audit_id,
        timestamp: row.timestamp.toISOString(),
        action: row.action,
        actorId: row.actor_id,
        ...(row.target_id ? { targetId: row.target_id } : {}),
        details: row.details,
        integrityHash: row.integrity_hash,
      }),
    );
  }

  async appendAuditRecord(record: TrustAuditRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO trust_audit_records (audit_id, timestamp, action, actor_id, target_id, details, integrity_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        record.auditId,
        record.timestamp,
        record.action,
        record.actorId,
        record.targetId ?? null,
        JSON.stringify(record.details),
        record.integrityHash,
      ],
    );
  }

  async saveChallenge(challenge: StoredChallenge): Promise<void> {
    await this.pool.query(
      `INSERT INTO trust_challenges 
        (challenge_id, nonce, subject_id, capability, purpose, case_id, issued_at, expires_at, consumed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        challenge.challengeId,
        challenge.nonce,
        challenge.subjectId,
        challenge.capability,
        challenge.purpose,
        challenge.caseId ?? null,
        challenge.issuedAt,
        challenge.expiresAt,
        challenge.consumedAt,
      ],
    );
  }

  async getChallenge(challengeId: string): Promise<StoredChallenge | null> {
    const result = await this.pool.query(
      `SELECT challenge_id, nonce, subject_id, capability, purpose, case_id, issued_at, expires_at, consumed_at
       FROM trust_challenges WHERE challenge_id = $1`,
      [challengeId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      challengeId: row.challenge_id,
      nonce: row.nonce,
      subjectId: row.subject_id,
      capability: row.capability as TrustCapability,
      purpose: row.purpose as TrustPurpose,
      caseId: row.case_id ?? undefined,
      issuedAt: row.issued_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      consumedAt: row.consumed_at?.toISOString() ?? null,
    };
  }

  async consumeChallenge(challengeId: string, nonce: string, consumedAt: string): Promise<boolean> {
    // Atomic nonce consumption. Uses consumed_at IS NULL as an idempotency/replay guard.
    const result = await this.pool.query(
      `UPDATE trust_challenges 
       SET consumed_at = $3 
       WHERE challenge_id = $1 AND nonce = $2 AND consumed_at IS NULL
         AND expires_at > $3::timestamptz`,
      [challengeId, nonce, consumedAt],
    );
    return result.rowCount !== null && result.rowCount > 0;
  }

  async saveSession(sessionData: StoredSession): Promise<void> {
    await this.pool.query(
      `INSERT INTO trust_sessions 
        (token_digest, session_id, credential_id, issuer_id, subject_id, role, capabilities, purpose, case_id, issued_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        sessionData.tokenDigest,
        sessionData.session.sessionId,
        sessionData.credentialId,
        sessionData.issuerId,
        sessionData.session.subjectId,
        sessionData.session.role,
        JSON.stringify(sessionData.session.capabilities),
        sessionData.session.purpose,
        sessionData.session.caseId ?? null,
        sessionData.session.issuedAt,
        sessionData.session.expiresAt,
      ],
    );
  }

  async getSession(tokenDigest: string): Promise<StoredSession | null> {
    const result = await this.pool.query(
      `SELECT token_digest, session_id, credential_id, issuer_id, subject_id, role, capabilities, purpose, case_id, issued_at, expires_at
       FROM trust_sessions WHERE token_digest = $1`,
      [tokenDigest],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      tokenDigest: row.token_digest,
      credentialId: row.credential_id,
      issuerId: row.issuer_id,
      session: TrustSessionSchema.parse({
        sessionId: row.session_id,
        subjectId: row.subject_id,
        role: row.role,
        capabilities:
          typeof row.capabilities === 'string' ? JSON.parse(row.capabilities) : row.capabilities,
        purpose: row.purpose,
        ...(row.case_id ? { caseId: row.case_id } : {}),
        issuedAt: row.issued_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
      }),
    };
  }
}
