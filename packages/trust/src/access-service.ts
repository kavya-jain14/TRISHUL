import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify as verifySignature,
} from 'node:crypto';
import {
  CredentialClaimsSchema,
  IdentifierSchema,
  PublicKeyPemSchema,
  TrustChallengeRequestSchema,
  TrustVerificationRequestSchema,
  type CredentialClaims,
  type CredentialRole,
  type TrustCapability,
  type TrustChallenge,
  type TrustChallengeRequest,
  type TrustSession,
  type TrustVerificationRequest,
  type TrustVerificationResult,
  type BlockchainAnchorService,
} from '@trishul/contracts';
import type { TrustRepository, StoredChallenge, StoredSession } from '@trishul/database';
import { evaluateCredentialPolicy } from './credential-policy.js';

export interface TrustVerifierAdapter {
  verifyIssuer(publicKeyPem: string, claims: CredentialClaims, signature: string): boolean | Promise<boolean>;
  verifyProof(publicKeyPem: string, challenge: TrustChallenge | StoredChallenge, claims: CredentialClaims, signature: string): boolean | Promise<boolean>;
}

/**
 * PROTOCOL-COMPATIBLE DEMO VERIFIER
 * This uses standard Ed25519 signatures to simulate the cryptographic boundary.
 * In the future, this should be replaced with an actual anonymous PrivacyPass/ZKP verifier.
 */
export class DemoSignatureVerifier implements TrustVerifierAdapter {
  verifyIssuer(publicKeyPem: string, claims: CredentialClaims, signature: string): boolean {
    return verifyDetached(publicKeyPem, credentialSigningPayload(claims), signature);
  }

  verifyProof(publicKeyPem: string, challenge: TrustChallenge | StoredChallenge, claims: CredentialClaims, signature: string): boolean {
    return verifyDetached(publicKeyPem, challengeProofPayload(challenge, claims), signature);
  }
}

const ROLE_CAPABILITIES: Record<CredentialRole, readonly TrustCapability[]> = {
  INVESTIGATOR: ['CASE_READ', 'CASE_WRITE', 'EVIDENCE_ANCHOR'],
  SUPERVISOR: ['CASE_READ', 'CASE_WRITE', 'EVIDENCE_ANCHOR', 'IDENTITY_RESOLUTION', 'AUDIT_READ'],
  AUDITOR: ['CASE_READ', 'EVIDENCE_ANCHOR', 'AUDIT_READ'],
  LEA_OFFICER: ['CASE_READ', 'EVIDENCE_ANCHOR', 'IDENTITY_RESOLUTION'],
};

const CASE_BOUND_CAPABILITIES = new Set<TrustCapability>([
  'CASE_READ',
  'CASE_WRITE',
  'EVIDENCE_ANCHOR',
  'IDENTITY_RESOLUTION',
]);

export class TrustAccessError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly reasonCodes: readonly string[],
  ) {
    super(message);
    this.name = 'TrustAccessError';
  }
}

export class InMemoryTrustRepository implements TrustRepository {
  private readonly issuers = new Map<string, { issuerId: string; publicKeyPem: string; active: boolean }>();
  private readonly revokedCredentialIds = new Map<string, string>(); // id -> timestamp
  private readonly challenges = new Map<string, StoredChallenge>();
  private readonly sessions = new Map<string, StoredSession>();

  async registerIssuer(issuerId: string, publicKeyPem: string, active: boolean): Promise<void> {
    const id = IdentifierSchema.parse(issuerId);
    const pem = PublicKeyPemSchema.parse(publicKeyPem);
    this.issuers.set(id, { issuerId: id, publicKeyPem: pem, active });
  }

  async setIssuerActive(issuerId: string, active: boolean): Promise<void> {
    const id = IdentifierSchema.parse(issuerId);
    const existing = this.issuers.get(id);
    if (!existing) {
      throw new TrustAccessError('ISSUER_NOT_FOUND', `Issuer ${id} was not found.`, 404, ['ISSUER_NOT_FOUND']);
    }
    this.issuers.set(id, { ...existing, active });
  }

  async revokeCredential(credentialId: string, revokedAt: string): Promise<void> {
    this.revokedCredentialIds.set(IdentifierSchema.parse(credentialId), revokedAt);
  }

  async isRevoked(credentialId: string): Promise<boolean> {
    return this.revokedCredentialIds.has(credentialId);
  }

  async trustedIssuerPublicKey(issuerId: string): Promise<string | null> {
    const issuer = this.issuers.get(issuerId);
    return issuer?.active ? issuer.publicKeyPem : null;
  }

  async getIssuers(): Promise<{ issuerId: string; publicKeyPem: string; active: boolean }[]> {
    return Array.from(this.issuers.values());
  }

  async getAuditRecords(): Promise<any[]> {
    return []; // In memory not implemented for audit
  }

  async appendAuditRecord(record: {
    auditId: string;
    timestamp: string;
    action: string;
    actorId: string;
    targetId?: string;
    details: Record<string, unknown>;
    integrityHash: string;
  }): Promise<void> {
    // In memory not implemented for audit
  }

  async saveChallenge(challenge: StoredChallenge): Promise<void> {
    this.challenges.set(challenge.challengeId, challenge);
  }

  async getChallenge(challengeId: string): Promise<StoredChallenge | null> {
    return this.challenges.get(challengeId) ?? null;
  }

  async consumeChallenge(challengeId: string, nonce: string, consumedAt: string): Promise<boolean> {
    const challenge = this.challenges.get(challengeId);
    if (challenge && challenge.nonce === nonce && challenge.consumedAt === null) {
      challenge.consumedAt = consumedAt;
      return true;
    }
    return false;
  }

  async saveSession(sessionData: StoredSession): Promise<void> {
    this.sessions.set(sessionData.tokenDigest, sessionData);
  }

  async getSession(tokenDigest: string): Promise<StoredSession | null> {
    return this.sessions.get(tokenDigest) ?? null;
  }
}

export interface TrustAccessServiceConfig {
  challengeTtlMs?: number;
  sessionTtlMs?: number;
}

export class TrustAccessService {
  private readonly challengeTtlMs: number;
  private readonly sessionTtlMs: number;

  constructor(
    private readonly repository: TrustRepository,
    private readonly blockchainAnchorService?: BlockchainAnchorService,
    config: TrustAccessServiceConfig = {},
    private readonly clock: () => Date = () => new Date(),
    private readonly verifier: TrustVerifierAdapter = new DemoSignatureVerifier(),
  ) {
    this.challengeTtlMs = positiveDuration(config.challengeTtlMs ?? 120_000, 'challengeTtlMs');
    this.sessionTtlMs = positiveDuration(config.sessionTtlMs ?? 600_000, 'sessionTtlMs');
  }

  async createChallenge(rawRequest: TrustChallengeRequest): Promise<TrustChallenge> {
    const request = TrustChallengeRequestSchema.parse(rawRequest);
    if (CASE_BOUND_CAPABILITIES.has(request.capability) && !request.caseId) {
      throw new TrustAccessError(
        'CASE_SCOPE_REQUIRED',
        `${request.capability} requires an explicit case scope.`,
        400,
        ['CASE_SCOPE_REQUIRED'],
      );
    }

    const issuedAt = this.clock();
    const challenge: StoredChallenge = {
      challengeId: randomUUID(),
      nonce: randomBytes(32).toString('base64url'),
      subjectId: request.subjectId,
      capability: request.capability,
      purpose: request.purpose,
      ...(request.caseId ? { caseId: request.caseId } : {}),
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + this.challengeTtlMs).toISOString(),
      consumedAt: null,
    };
    await this.repository.saveChallenge(challenge);
    return publicChallenge(challenge);
  }

  async verify(rawRequest: TrustVerificationRequest): Promise<TrustVerificationResult> {
    const request = TrustVerificationRequestSchema.parse(rawRequest);
    const challenge = await this.repository.getChallenge(request.challengeId);
    if (!challenge) {
      throw new TrustAccessError('TRUST_CHALLENGE_INVALID', 'The challenge does not exist.', 401, [
        'CHALLENGE_NOT_FOUND',
      ]);
    }

    const now = this.clock();
    const claims = request.credential.claims;
    const issuerPublicKey = await this.repository.trustedIssuerPublicKey(claims.issuerId);
    const nonceFresh =
      challenge.consumedAt === null && now.getTime() < Date.parse(challenge.expiresAt);
    const roleMatches = ROLE_CAPABILITIES[claims.role].includes(challenge.capability);
    const purposeAllowed = claims.allowedPurposes.includes(challenge.purpose);
    const issuerSignatureValid =
      issuerPublicKey !== null &&
      (await this.verifier.verifyIssuer(
        issuerPublicKey,
        claims,
        request.credential.issuerSignature,
      ));
    
    const isRevoked = await this.repository.isRevoked(claims.credentialId);
    
    const policy = evaluateCredentialPolicy({
      issuerTrusted: issuerPublicKey !== null,
      signatureValid: issuerSignatureValid,
      revoked: isRevoked,
      nonceFresh,
      roleMatches,
      purposeAllowed,
    });
    const reasonCodes = policy.status === 'VERIFIED' ? [] : [...policy.reasonCodes];

    if (Date.parse(claims.issuedAt) > now.getTime()) reasonCodes.push('CREDENTIAL_NOT_YET_VALID');
    if (Date.parse(claims.expiresAt) <= now.getTime()) reasonCodes.push('CREDENTIAL_EXPIRED');
    if (claims.subjectId !== challenge.subjectId) reasonCodes.push('SUBJECT_MISMATCH');
    if (!claims.capabilities.includes(challenge.capability))
      reasonCodes.push('CAPABILITY_MISMATCH');
    if (challenge.caseId && !claims.caseIds.includes(challenge.caseId)) {
      reasonCodes.push('CASE_SCOPE_MISMATCH');
    }
    if (
      !(await this.verifier.verifyProof(
        claims.subjectPublicKeyPem,
        challenge,
        claims,
        request.proofSignature,
      ))
    ) {
      reasonCodes.push('PROOF_SIGNATURE_INVALID');
    }

    const uniqueReasons = [...new Set(reasonCodes)];
    if (uniqueReasons.length > 0) {
      await this.logAudit('VERIFICATION_FAILED', claims.subjectId, claims.credentialId, { reasons: uniqueReasons, challengeId: challenge.challengeId });
      throw new TrustAccessError(
        policy.status === 'REVOKED' ? 'CREDENTIAL_REVOKED' : 'TRUST_VERIFICATION_FAILED',
        'The credential proof did not satisfy the trust policy.',
        401,
        uniqueReasons,
      );
    }

    const consumed = await this.repository.consumeChallenge(challenge.challengeId, challenge.nonce, now.toISOString());
    if (!consumed) {
      await this.logAudit('VERIFICATION_FAILED', claims.subjectId, claims.credentialId, { reasons: ['NONCE_REPLAY_OR_EXPIRED'], challengeId: challenge.challengeId });
      throw new TrustAccessError(
        'TRUST_VERIFICATION_FAILED',
        'The credential proof did not satisfy the trust policy.',
        401,
        ['NONCE_REPLAY_OR_EXPIRED'],
      );
    }

    const credentialExpiry = Date.parse(claims.expiresAt);
    const session: TrustSession = {
      sessionId: randomUUID(),
      subjectId: claims.subjectId,
      role: claims.role,
      capabilities: [challenge.capability],
      purpose: challenge.purpose,
      ...(challenge.caseId ? { caseId: challenge.caseId } : {}),
      issuedAt: now.toISOString(),
      expiresAt: new Date(
        Math.min(now.getTime() + this.sessionTtlMs, credentialExpiry),
      ).toISOString(),
    };
    const accessToken = randomBytes(32).toString('base64url');
    await this.repository.saveSession({
      tokenDigest: tokenDigest(accessToken),
      credentialId: claims.credentialId,
      issuerId: claims.issuerId,
      session,
    });
    
    await this.logAudit('SESSION_ESTABLISHED', claims.subjectId, session.sessionId, { credentialId: claims.credentialId, capabilities: session.capabilities });
    return { session, accessToken, policyVersion: 'credential-policy-v1' };
  }

  async authorize(accessToken: string, capability: TrustCapability, caseId?: string): Promise<TrustSession> {
    const stored = await this.repository.getSession(tokenDigest(accessToken));
    if (!stored || Date.parse(stored.session.expiresAt) <= this.clock().getTime()) {
      throw new TrustAccessError(
        'TRUST_SESSION_INVALID',
        'A fresh verified trust session is required.',
        401,
        ['SESSION_MISSING_OR_EXPIRED'],
      );
    }
    
    const isRevoked = await this.repository.isRevoked(stored.credentialId);
    const trustedIssuerPublicKey = await this.repository.trustedIssuerPublicKey(stored.issuerId);

    if (isRevoked || trustedIssuerPublicKey === null) {
      throw new TrustAccessError(
        'CREDENTIAL_REVOKED',
        'The credential backing this session is no longer trusted.',
        401,
        ['CREDENTIAL_REVOKED_OR_ISSUER_INACTIVE'],
      );
    }
    if (!stored.session.capabilities.includes(capability)) {
      throw new TrustAccessError(
        'TRUST_CAPABILITY_DENIED',
        `The session does not grant ${capability}.`,
        403,
        ['CAPABILITY_NOT_GRANTED'],
      );
    }
    if (caseId && stored.session.caseId !== caseId) {
      throw new TrustAccessError(
        'TRUST_CASE_SCOPE_DENIED',
        `The session is not bound to case ${caseId}.`,
        403,
        ['CASE_SCOPE_MISMATCH'],
      );
    }
    return stored.session;
  }

  // Admin / Supervisor Methods
  async registerIssuer(issuerId: string, publicKeyPem: string, active: boolean = true): Promise<void> {
    await this.repository.registerIssuer(issuerId, publicKeyPem, active);
    const receipt = this.blockchainAnchorService ? await this.blockchainAnchorService.anchor(
      createHash('sha256').update(issuerId + publicKeyPem).digest('hex'),
      { action: 'REGISTER_ISSUER', issuerId }
    ) : undefined;
    await this.logAudit('ISSUER_REGISTERED', 'admin', issuerId, { active, publicKeyPemSnippet: publicKeyPem.substring(0, 30), receipt });
  }

  async setIssuerActive(issuerId: string, active: boolean): Promise<void> {
    await this.repository.setIssuerActive(issuerId, active);
    await this.logAudit(active ? 'ISSUER_ACTIVATED' : 'ISSUER_DEACTIVATED', 'admin', issuerId, {});
  }

  async revokeCredential(credentialId: string): Promise<void> {
    const timestamp = this.clock().toISOString();
    await this.repository.revokeCredential(credentialId, timestamp);
    const receipt = this.blockchainAnchorService ? await this.blockchainAnchorService.anchor(
      createHash('sha256').update(credentialId + timestamp).digest('hex'),
      { action: 'REVOKE_CREDENTIAL', credentialId }
    ) : undefined;
    await this.logAudit('CREDENTIAL_REVOKED', 'admin', credentialId, { receipt });
  }

  async getIssuers(): Promise<{ issuerId: string; publicKeyPem: string; active: boolean }[]> {
    return this.repository.getIssuers();
  }

  async getTrustAudit(): Promise<any[]> {
    return this.repository.getAuditRecords();
  }

  private async logAudit(action: string, actorId: string, targetId: string | undefined, details: Record<string, unknown>) {
    const timestamp = this.clock().toISOString();
    const auditId = randomUUID();
    // Simple hash for integrity
    const hashData = JSON.stringify({ auditId, timestamp, action, actorId, targetId, details });
    const integrityHash = createHash('sha256').update(hashData).digest('hex');
    const record: any = {
      auditId,
      timestamp,
      action,
      actorId,
      details,
      integrityHash
    };
    if (targetId) record.targetId = targetId;
    await this.repository.appendAuditRecord(record);
  }
}

export function credentialSigningPayload(rawClaims: CredentialClaims): string {
  const claims = CredentialClaimsSchema.parse(rawClaims);
  return JSON.stringify([
    'TRISHUL_CREDENTIAL_V1',
    claims.credentialId,
    claims.issuerId,
    claims.subjectId,
    claims.role,
    [...claims.capabilities].sort(),
    [...claims.allowedPurposes].sort(),
    [...claims.caseIds].sort(),
    claims.subjectPublicKeyPem,
    claims.issuedAt,
    claims.expiresAt,
  ]);
}

export function challengeProofPayload(
  rawChallenge: TrustChallenge,
  rawClaims: CredentialClaims,
): string {
  const challenge = publicChallenge(rawChallenge);
  const claims = CredentialClaimsSchema.parse(rawClaims);
  return JSON.stringify([
    'TRISHUL_CHALLENGE_PROOF_V1',
    challenge.challengeId,
    challenge.nonce,
    challenge.subjectId,
    challenge.capability,
    challenge.purpose,
    challenge.caseId ?? null,
    challenge.expiresAt,
    claims.credentialId,
  ]);
}

function publicChallenge(challenge: TrustChallenge | StoredChallenge): TrustChallenge {
  return {
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    subjectId: challenge.subjectId,
    capability: challenge.capability,
    purpose: challenge.purpose,
    ...(challenge.caseId ? { caseId: challenge.caseId } : {}),
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
  };
}

function verifyDetached(publicKeyPem: string, payload: string, signature: string): boolean {
  try {
    return verifySignature(
      null,
      Buffer.from(payload, 'utf8'),
      createPublicKey(publicKeyPem),
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}

function positiveDuration(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function tokenDigest(accessToken: string): string {
  return createHash('sha256').update(accessToken, 'utf8').digest('hex');
}
