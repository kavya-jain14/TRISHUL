import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import type { CredentialClaims, SignedCredential, TrustChallenge } from '@trishul/contracts';
import { describe, expect, it } from 'vitest';
import {
  challengeProofPayload,
  credentialSigningPayload,
  InMemoryTrustRepository,
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
  const registry = new InMemoryTrustRepository();
  registry.registerIssuer('issuer:bank-a', issuer.publicKeyPem, true);
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
  it('binds a verified session to one capability, purpose, subject, and case', async () => {
    const { service, subject, claims, credential } = fixture();
    const challenge = await service.createChallenge({
      subjectId: claims.subjectId,
      capability: 'CASE_READ',
      purpose: 'FRAUD_INVESTIGATION',
      caseId: 'case:alpha',
    });

    const result = await service.verify({
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
    expect(await service.authorize(result.accessToken, 'CASE_READ', 'case:alpha')).toEqual(
      result.session,
    );
    await expect(
      service.authorize(result.accessToken, 'CASE_WRITE', 'case:alpha'),
    ).rejects.toThrowError(expect.objectContaining({ code: 'TRUST_CAPABILITY_DENIED' }));
    await expect(
      service.authorize(result.accessToken, 'CASE_READ', 'case:beta'),
    ).rejects.toThrowError(expect.objectContaining({ code: 'TRUST_CASE_SCOPE_DENIED' }));
  });

  it('rejects a forged issuer signature without burning the challenge', async () => {
    const { service, subject, claims, credential } = fixture();
    const attacker = keyPair();
    const challenge = await service.createChallenge({
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

    await expect(service.verify({ ...request, credential: forged })).rejects.toThrowError(
      expect.objectContaining({
        code: 'TRUST_VERIFICATION_FAILED',
        reasonCodes: expect.arrayContaining(['SIGNATURE_INVALID']),
      }),
    );
    expect((await service.verify({ ...request, credential })).session.subjectId).toBe(
      'investigator:a',
    );
  });

  it('binds the proof to the requested subject and does not consume a nonce on mismatch', async () => {
    const { service, subject, issuer, claims, credential } = fixture();
    const challenge = await service.createChallenge({
      subjectId: claims.subjectId,
      capability: 'CASE_READ',
      purpose: 'FRAUD_INVESTIGATION',
      caseId: 'case:alpha',
    });
    const mismatchedClaims = { ...claims, subjectId: 'investigator:other' };
    const mismatchedCredential = signedCredential(mismatchedClaims, issuer.privateKey);

    await expect(
      service.verify({
        challengeId: challenge.challengeId,
        credential: mismatchedCredential,
        proofSignature: proof(challenge, mismatchedClaims, subject.privateKey),
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ reasonCodes: expect.arrayContaining(['SUBJECT_MISMATCH']) }),
    );

    expect(
      (
        await service.verify({
          challengeId: challenge.challengeId,
          credential,
          proofSignature: proof(challenge, claims, subject.privateKey),
        })
      ).session.subjectId,
    ).toBe(claims.subjectId);
  });

  it('uses the same revocation source for registry writes and verification', async () => {
    const { service, subject, registry, claims, credential } = fixture();
    await registry.revokeCredential(claims.credentialId, new Date().toISOString());
    const challenge = await service.createChallenge({
      subjectId: claims.subjectId,
      capability: 'CASE_READ',
      purpose: 'FRAUD_INVESTIGATION',
      caseId: 'case:alpha',
    });

    await expect(
      service.verify({
        challengeId: challenge.challengeId,
        credential,
        proofSignature: proof(challenge, claims, subject.privateKey),
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: 'CREDENTIAL_REVOKED',
        reasonCodes: expect.arrayContaining(['CREDENTIAL_REVOKED']),
      }),
    );
  });

  it('invalidates an existing session immediately when its credential is revoked', async () => {
    const { service, subject, registry, claims, credential } = fixture();
    const challenge = await service.createChallenge({
      subjectId: claims.subjectId,
      capability: 'CASE_READ',
      purpose: 'FRAUD_INVESTIGATION',
      caseId: 'case:alpha',
    });
    const result = await service.verify({
      challengeId: challenge.challengeId,
      credential,
      proofSignature: proof(challenge, claims, subject.privateKey),
    });

    await registry.revokeCredential(claims.credentialId, new Date().toISOString());
    await expect(
      service.authorize(result.accessToken, 'CASE_READ', 'case:alpha'),
    ).rejects.toThrowError(expect.objectContaining({ code: 'CREDENTIAL_REVOKED' }));
  });

  it('rejects proof replay after the nonce is consumed', async () => {
    const { service, subject, claims, credential } = fixture();
    const challenge = await service.createChallenge({
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

    await service.verify(request);
    await expect(service.verify(request)).rejects.toThrowError(
      expect.objectContaining({
        reasonCodes: expect.arrayContaining(['NONCE_REPLAY_OR_EXPIRED']),
      }),
    );
  });

  it('requires an explicit case scope for case-bound capabilities', async () => {
    const { service } = fixture();
    await expect(
      service.createChallenge({
        subjectId: 'investigator:a',
        capability: 'IDENTITY_RESOLUTION_REQUEST',
        purpose: 'LAW_ENFORCEMENT_REQUEST',
      }),
    ).rejects.toThrowError(
      expect.objectContaining<Partial<TrustAccessError>>({ code: 'CASE_SCOPE_REQUIRED' }),
    );
  });

  it('preserves credential case scopes for a non-case command-center session', async () => {
    const { service, subject, issuer, claims } = fixture();
    const commandClaims: CredentialClaims = {
      ...claims,
      capabilities: ['COMMAND_CENTER_READ'],
      caseIds: ['case:alpha', 'case:beta'],
    };
    const challenge = await service.createChallenge({
      subjectId: commandClaims.subjectId,
      capability: 'COMMAND_CENTER_READ',
      purpose: 'FRAUD_INVESTIGATION',
    });
    const result = await service.verify({
      challengeId: challenge.challengeId,
      credential: signedCredential(commandClaims, issuer.privateKey),
      proofSignature: proof(challenge, commandClaims, subject.privateKey),
    });

    expect(result.session).toMatchObject({
      capabilities: ['COMMAND_CENTER_READ'],
      caseIds: ['case:alpha', 'case:beta'],
    });
    expect(await service.authorize(result.accessToken, 'COMMAND_CENTER_READ')).toEqual(
      result.session,
    );
  });
});
