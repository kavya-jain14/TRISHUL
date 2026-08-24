import { z } from 'zod';
import { IdentifierSchema, IsoDateTimeSchema } from './common.js';

export const CredentialRoleSchema = z.enum([
  'INVESTIGATOR',
  'SUPERVISOR',
  'AUDITOR',
  'LEA_OFFICER',
]);

export const TrustCapabilitySchema = z.enum([
  'CASE_READ',
  'CASE_WRITE',
  'EVIDENCE_ANCHOR',
  'IDENTITY_RESOLUTION',
  'AUDIT_READ',
]);

export const TrustPurposeSchema = z.enum([
  'FRAUD_INVESTIGATION',
  'EVIDENCE_REVIEW',
  'COMPLIANCE_AUDIT',
  'LAW_ENFORCEMENT_REQUEST',
]);

export const PublicKeyPemSchema = z
  .string()
  .trim()
  .min(80)
  .max(4_096)
  .regex(/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----$/);

export const Base64SignatureSchema = z
  .string()
  .min(40)
  .max(1_024)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const CredentialClaimsSchema = z
  .object({
    credentialId: IdentifierSchema,
    issuerId: IdentifierSchema,
    subjectId: IdentifierSchema,
    role: CredentialRoleSchema,
    capabilities: z.array(TrustCapabilitySchema).min(1).max(20),
    allowedPurposes: z.array(TrustPurposeSchema).min(1).max(20),
    caseIds: z.array(IdentifierSchema).max(100).default([]),
    subjectPublicKeyPem: PublicKeyPemSchema,
    issuedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: 'Credential expiry must be later than issuance.',
      });
    }
    if (new Set(value.capabilities).size !== value.capabilities.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['capabilities'],
        message: 'Credential capabilities must be unique.',
      });
    }
    if (new Set(value.caseIds).size !== value.caseIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['caseIds'],
        message: 'Credential case scopes must be unique.',
      });
    }
  });

export const SignedCredentialSchema = z
  .object({
    claims: CredentialClaimsSchema,
    issuerSignature: Base64SignatureSchema,
  })
  .strict();

export const TrustChallengeRequestSchema = z
  .object({
    subjectId: IdentifierSchema,
    capability: TrustCapabilitySchema,
    purpose: TrustPurposeSchema,
    caseId: IdentifierSchema.optional(),
  })
  .strict();

export const TrustChallengeSchema = z
  .object({
    challengeId: z.string().uuid(),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
    subjectId: IdentifierSchema,
    capability: TrustCapabilitySchema,
    purpose: TrustPurposeSchema,
    caseId: IdentifierSchema.optional(),
    issuedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
  })
  .strict();

export const TrustVerificationRequestSchema = z
  .object({
    challengeId: z.string().uuid(),
    credential: SignedCredentialSchema,
    proofSignature: Base64SignatureSchema,
  })
  .strict();

export const TrustSessionSchema = z
  .object({
    sessionId: z.string().uuid(),
    subjectId: IdentifierSchema,
    role: CredentialRoleSchema,
    capabilities: z.array(TrustCapabilitySchema),
    purpose: TrustPurposeSchema,
    caseId: IdentifierSchema.optional(),
    issuedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
  })
  .strict();

export const TrustVerificationResultSchema = z
  .object({
    session: TrustSessionSchema,
    accessToken: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
    policyVersion: z.literal('credential-policy-v1'),
  })
  .strict();

export const TrustIssuerSchema = z
  .object({
    issuerId: IdentifierSchema,
    publicKeyPem: PublicKeyPemSchema,
    active: z.boolean(),
  })
  .strict();

export const TrustIssuerRegistrationRequestSchema = z
  .object({
    issuerId: IdentifierSchema,
    publicKeyPem: PublicKeyPemSchema,
    active: z.boolean().optional().default(true),
  })
  .strict();

export const TrustRevocationRequestSchema = z
  .object({
    credentialId: IdentifierSchema,
  })
  .strict();

export const TrustAuditRecordSchema = z
  .object({
    auditId: z.string().uuid(),
    timestamp: IsoDateTimeSchema,
    action: z.string(),
    actorId: IdentifierSchema,
    targetId: IdentifierSchema.optional(),
    details: z.record(z.unknown()),
    integrityHash: z.string(),
  })
  .strict();

export type CredentialRole = z.infer<typeof CredentialRoleSchema>;
export type TrustCapability = z.infer<typeof TrustCapabilitySchema>;
export type TrustPurpose = z.infer<typeof TrustPurposeSchema>;
export type CredentialClaims = z.infer<typeof CredentialClaimsSchema>;
export type SignedCredential = z.infer<typeof SignedCredentialSchema>;
export type TrustChallengeRequest = z.infer<typeof TrustChallengeRequestSchema>;
export type TrustChallenge = z.infer<typeof TrustChallengeSchema>;
export type TrustVerificationRequest = z.infer<typeof TrustVerificationRequestSchema>;
export type TrustSession = z.infer<typeof TrustSessionSchema>;
export type TrustVerificationResult = z.infer<typeof TrustVerificationResultSchema>;
export type TrustIssuer = z.infer<typeof TrustIssuerSchema>;
export type TrustIssuerRegistrationRequest = z.infer<typeof TrustIssuerRegistrationRequestSchema>;
export type TrustRevocationRequest = z.infer<typeof TrustRevocationRequestSchema>;
export type TrustAuditRecord = z.infer<typeof TrustAuditRecordSchema>;
