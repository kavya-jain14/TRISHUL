import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import type { CredentialClaims, SignedCredential, TrustChallenge } from '@trishul/contracts';
import { describe, expect, it } from 'vitest';
import {
  challengeProofPayload,
  credentialSigningPayload,
  InMemoryCredentialRegistry,
  TrustAccessError,
  TrustAccessService,
} from '../src/index.js';

const now = new Date('2026-08-24T12:00:00.000Z');

function keyPair() {
  const pair = generateKeyPairSync('ed25519');
  return {
    privateKey: pair.privateKey,
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function signature(privateKey: KeyObject, payload: string): string {
  return sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64');
}

function fixture() {
  const issuer = keyPair();
  const subject = keyPair();
  const registry = new InMemoryCredentialRegistry();
  registry.registerIssuer({ issuerId: 'issuer:bank-a', publicKeyPem: issuer.publicKeyPem });
  const service = new TrustAccessService(registry, {}, () => new Date(now));
  const claims: CredentialClaims = {
    credentialId: 'credential:investigator-a',
    issuerId: 'issuer:bank-a',
    subjectId: 'investigator:a',
    role: 'INVESTIGATOR',
    capabilities: ['CASE_READ', 'CASE_WRITE'],
    allowedPurposes: ['FRAUD_INVESTIGATION'],
    caseIds: ['case:alpha'],
    subjectPublicKeyPem: subject.publicKeyPem,
    issuedAt: '2026-08-24T11:00:00.000Z',
    expiresAt: '2026-08-24T14:00:00.000Z',
  };
  const credential = signedCredential(claims, issuer.privateKey);
  return { issuer, subject, registry, service, claims, credential };
}

function signedCredential(claims: CredentialClaims, issuerPrivateKey: KeyObject): SignedCredential {
  return {
    claims,
    issuerSignature: signature(issuerPrivateKey, credentialSigningPayload(claims)),
  };
}

function proof(
  challenge: TrustChallenge,
  claims: CredentialClaims,
  subjectPrivateKey: KeyObject,
): string {
  return signature(subjectPrivateKey, challengeProofPayload(challenge, claims));
}

describe('TrustAccessService', () => {
  it('binds a verified session to one capability, purpose, subject, and case', () => {
    const { service, subject, claims, credential } = fixture();
    const challenge = service.createChallenge({
      subjectId: claims.subjectId,
      capability: 'CASE_READ',
      purpose: 'FRAUD_INVESTIGATION',
      caseId: 'case:alpha',
    });

    const result = service.verify({
      challengeId: challenge.challengeId,
      credential,
      proofSignature: proof(challenge, claims, subject.privateKey),
    });

    expect(result.session).toMatchObject({
      subjectId: 'investigator:a',
      capabilities: ['CASE_READ'],
      purpose: 'FRAUD_INVESTIGATION',
      caseId: 'case:alpha',
    });
    expect(service.authorize(result.accessToken, 'CASE_READ', 'case:alpha')).toEqual(
      result.session,
    );
    expect(() => service.authorize(result.accessToken, 'CASE_WRITE', 'case:alpha')).toThrowError(
      expect.objectContaining({ code: 'TRUST_CAPABILITY_DENIED' }),
    );
    expect(() => service.authorize(result.accessToken, 'CASE_READ', 'case:beta')).toThrowError(
      expect.objectContaining({ code: 'TRUST_CASE_SCOPE_DENIED' }),
    );
  });

  it('rejects a forged issuer signature without burning the challenge', () => {
    const { service, subject, claims, credential } = fixture();
    const attacker = keyPair();
    const challenge = service.createChallenge({
      subjectId: claims.subjectId,
      capability: 'CASE_READ',
      purpose: 'FRAUD_INVESTIGATION',
      caseId: 'case:alpha',
    });
    const forged = signedCredential(claims, attacker.privateKey);
    const request = {
      challengeId: challenge.challengeId,
      proofSignature: proof(challenge, claims, subject.privateKey),
    };

    expect(() => service.verify({ ...request, credential: forged })).toThrowError(
      expect.objectContaining({
        code: 'TRUST_VERIFICATION_FAILED',
        reasonCodes: expect.arrayContaining(['SIGNATURE_INVALID']),
      }),
    );
    expect(service.verify({ ...request, credential }).session.subjectId).toBe('investigator:a');
  });

  it('binds the proof to the requested subject and does not consume a nonce on mismatch', () => {
    const { service, subject, issuer, claims, credential } = fixture();
    const challenge = service.createChallenge({
      subjectId: claims.subjectId,
      capability: 'CASE_READ',
      purpose: 'FRAUD_INVESTIGATION',
      caseId: 'case:alpha',
    });
    const mismatchedClaims = { ...claims, subjectId: 'investigator:other' };
    const mismatchedCredential = signedCredential(mismatchedClaims, issuer.privateKey);

    expect(() =>
      service.verify({
        challengeId: challenge.challengeId,
        credential: mismatchedCredential,
        proofSignature: proof(challenge, mismatchedClaims, subject.privateKey),
      }),
    ).toThrowError(
      expect.objectContaining({ reasonCodes: expect.arrayContaining(['SUBJECT_MISMATCH']) }),
    );

    expect(
      service.verify({
        challengeId: challenge.challengeId,
        credential,
        proofSignature: proof(challenge, claims, subject.privateKey),
      }).session.subjectId,
    ).toBe(claims.subjectId);
  });

  it('uses the same revocation source for registry writes and verification', () => {
    const { service, subject, registry, claims, credential } = fixture();
    registry.revokeCredential(claims.credentialId);
    const challenge = service.createChallenge({
      subjectId: claims.subjectId,
      capability: 'CASE_READ',
      purpose: 'FRAUD_INVESTIGATION',
      caseId: 'case:alpha',
    });

    expect(() =>
      service.verify({
        challengeId: challenge.challengeId,
        credential,
        proofSignature: proof(challenge, claims, subject.privateKey),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'CREDENTIAL_REVOKED',
        reasonCodes: expect.arrayContaining(['CREDENTIAL_REVOKED']),
      }),
    );
  });

  it('invalidates an existing session immediately when its credential is revoked', () => {
    const { service, subject, registry, claims, credential } = fixture();
    const challenge = service.createChallenge({
      subjectId: claims.subjectId,
      capability: 'CASE_READ',
      purpose: 'FRAUD_INVESTIGATION',
      caseId: 'case:alpha',
    });
    const result = service.verify({
      challengeId: challenge.challengeId,
      credential,
      proofSignature: proof(challenge, claims, subject.privateKey),
    });

    registry.revokeCredential(claims.credentialId);
    expect(() => service.authorize(result.accessToken, 'CASE_READ', 'case:alpha')).toThrowError(
      expect.objectContaining({ code: 'CREDENTIAL_REVOKED' }),
    );
  });

  it('rejects proof replay after the nonce is consumed', () => {
    const { service, subject, claims, credential } = fixture();
    const challenge = service.createChallenge({
      subjectId: claims.subjectId,
      capability: 'CASE_READ',
      purpose: 'FRAUD_INVESTIGATION',
      caseId: 'case:alpha',
    });
    const request = {
      challengeId: challenge.challengeId,
      credential,
      proofSignature: proof(challenge, claims, subject.privateKey),
    };

    service.verify(request);
    expect(() => service.verify(request)).toThrowError(
      expect.objectContaining({
        reasonCodes: expect.arrayContaining(['NONCE_REPLAY_OR_EXPIRED']),
      }),
    );
  });

  it('requires an explicit case scope for case-bound capabilities', () => {
    const { service } = fixture();
    expect(() =>
      service.createChallenge({
        subjectId: 'investigator:a',
        capability: 'IDENTITY_RESOLUTION',
        purpose: 'LAW_ENFORCEMENT_REQUEST',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<TrustAccessError>>({ code: 'CASE_SCOPE_REQUIRED' }),
    );
  });
});
