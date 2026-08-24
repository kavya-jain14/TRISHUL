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
} from '@trishul/contracts';
import { evaluateCredentialPolicy } from './credential-policy.js';

interface IssuerRecord {
  issuerId: string;
  publicKeyPem: string;
  active: boolean;
}

interface StoredChallenge extends TrustChallenge {
  consumedAt: string | null;
}

interface StoredSession {
  credentialId: string;
  issuerId: string;
  session: TrustSession;
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

export class InMemoryCredentialRegistry {
  private readonly issuers = new Map<string, IssuerRecord>();
  private readonly revokedCredentialIds = new Set<string>();

  registerIssuer(input: { issuerId: string; publicKeyPem: string; active?: boolean }): void {
    const issuerId = IdentifierSchema.parse(input.issuerId);
    const publicKeyPem = PublicKeyPemSchema.parse(input.publicKeyPem);
    this.issuers.set(issuerId, {
      issuerId,
      publicKeyPem,
      active: input.active ?? true,
    });
  }

  setIssuerActive(issuerId: string, active: boolean): void {
    const id = IdentifierSchema.parse(issuerId);
    const existing = this.issuers.get(id);
    if (!existing) {
      throw new TrustAccessError('ISSUER_NOT_FOUND', `Issuer ${id} was not found.`, 404, [
        'ISSUER_NOT_FOUND',
      ]);
    }
    this.issuers.set(id, { ...existing, active });
  }

  revokeCredential(credentialId: string): void {
    this.revokedCredentialIds.add(IdentifierSchema.parse(credentialId));
  }

  isRevoked(credentialId: string): boolean {
    return this.revokedCredentialIds.has(credentialId);
  }

  trustedIssuerPublicKey(issuerId: string): string | null {
    const issuer = this.issuers.get(issuerId);
    return issuer?.active ? issuer.publicKeyPem : null;
  }
}

export interface TrustAccessServiceConfig {
  challengeTtlMs?: number;
  sessionTtlMs?: number;
}

export class TrustAccessService {
  private readonly challenges = new Map<string, StoredChallenge>();
  private readonly sessions = new Map<string, StoredSession>();
  private readonly challengeTtlMs: number;
  private readonly sessionTtlMs: number;

  constructor(
    private readonly registry: InMemoryCredentialRegistry,
    config: TrustAccessServiceConfig = {},
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.challengeTtlMs = positiveDuration(config.challengeTtlMs ?? 120_000, 'challengeTtlMs');
    this.sessionTtlMs = positiveDuration(config.sessionTtlMs ?? 600_000, 'sessionTtlMs');
  }

  createChallenge(rawRequest: TrustChallengeRequest): TrustChallenge {
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
    this.challenges.set(challenge.challengeId, challenge);
    return publicChallenge(challenge);
  }

  verify(rawRequest: TrustVerificationRequest): TrustVerificationResult {
    const request = TrustVerificationRequestSchema.parse(rawRequest);
    const challenge = this.challenges.get(request.challengeId);
    if (!challenge) {
      throw new TrustAccessError('TRUST_CHALLENGE_INVALID', 'The challenge does not exist.', 401, [
        'CHALLENGE_NOT_FOUND',
      ]);
    }

    const now = this.clock();
    const claims = request.credential.claims;
    const issuerPublicKey = this.registry.trustedIssuerPublicKey(claims.issuerId);
    const nonceFresh =
      challenge.consumedAt === null && now.getTime() < Date.parse(challenge.expiresAt);
    const roleMatches = ROLE_CAPABILITIES[claims.role].includes(challenge.capability);
    const purposeAllowed = claims.allowedPurposes.includes(challenge.purpose);
    const issuerSignatureValid =
      issuerPublicKey !== null &&
      verifyDetached(
        issuerPublicKey,
        credentialSigningPayload(claims),
        request.credential.issuerSignature,
      );
    const policy = evaluateCredentialPolicy({
      issuerTrusted: issuerPublicKey !== null,
      signatureValid: issuerSignatureValid,
      revoked: this.registry.isRevoked(claims.credentialId),
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
      !verifyDetached(
        claims.subjectPublicKeyPem,
        challengeProofPayload(challenge, claims),
        request.proofSignature,
      )
    ) {
      reasonCodes.push('PROOF_SIGNATURE_INVALID');
    }

    const uniqueReasons = [...new Set(reasonCodes)];
    if (uniqueReasons.length > 0) {
      throw new TrustAccessError(
        policy.status === 'REVOKED' ? 'CREDENTIAL_REVOKED' : 'TRUST_VERIFICATION_FAILED',
        'The credential proof did not satisfy the trust policy.',
        401,
        uniqueReasons,
      );
    }

    challenge.consumedAt = now.toISOString();
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
    this.sessions.set(tokenDigest(accessToken), {
      credentialId: claims.credentialId,
      issuerId: claims.issuerId,
      session,
    });
    return { session, accessToken, policyVersion: 'credential-policy-v1' };
  }

  authorize(accessToken: string, capability: TrustCapability, caseId?: string): TrustSession {
    const stored = this.sessions.get(tokenDigest(accessToken));
    if (!stored || Date.parse(stored.session.expiresAt) <= this.clock().getTime()) {
      throw new TrustAccessError(
        'TRUST_SESSION_INVALID',
        'A fresh verified trust session is required.',
        401,
        ['SESSION_MISSING_OR_EXPIRED'],
      );
    }
    if (
      this.registry.isRevoked(stored.credentialId) ||
      this.registry.trustedIssuerPublicKey(stored.issuerId) === null
    ) {
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
