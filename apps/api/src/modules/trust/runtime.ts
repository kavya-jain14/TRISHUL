import { IdentifierSchema, PublicKeyPemSchema } from '@trishul/contracts';
import { InMemoryCredentialRegistry, TrustAccessService } from '@trishul/trust';
import { z } from 'zod';

const TrustAccessModeSchema = z.enum(['DEVELOPMENT_OPTIONAL', 'ENFORCED']);

const TrustedIssuerSchema = z
  .object({
    issuerId: IdentifierSchema,
    publicKeyPem: PublicKeyPemSchema,
    active: z.boolean().default(true),
  })
  .strict();

const TrustedIssuersSchema = z.array(TrustedIssuerSchema).max(100);
const RevokedCredentialIdsSchema = z.array(IdentifierSchema).max(10_000);

export interface TrustAccessRuntime {
  service: TrustAccessService;
  enforceTrustAccess: boolean;
  mode: z.infer<typeof TrustAccessModeSchema>;
  activeIssuerCount: number;
  revokedCredentialCount: number;
}

export function trustAccessRuntimeFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): TrustAccessRuntime {
  const mode = TrustAccessModeSchema.parse(
    environment.TRISHUL_TRUST_ACCESS_MODE ?? 'DEVELOPMENT_OPTIONAL',
  );
  if (environment.NODE_ENV === 'production' && mode !== 'ENFORCED') {
    throw new Error('Production requires TRISHUL_TRUST_ACCESS_MODE=ENFORCED.');
  }

  const issuers = parseJson(
    environment.TRISHUL_TRUSTED_ISSUERS_JSON,
    TrustedIssuersSchema,
    'TRISHUL_TRUSTED_ISSUERS_JSON',
    [],
  );
  const revokedCredentialIds = parseJson(
    environment.TRISHUL_REVOKED_CREDENTIAL_IDS_JSON,
    RevokedCredentialIdsSchema,
    'TRISHUL_REVOKED_CREDENTIAL_IDS_JSON',
    [],
  );
  const activeIssuerCount = issuers.filter((issuer) => issuer.active).length;
  if (mode === 'ENFORCED' && activeIssuerCount === 0) {
    throw new Error('Enforced Trust/Access requires at least one active trusted issuer.');
  }

  const registry = new InMemoryCredentialRegistry();
  for (const issuer of issuers) {
    registry.registerIssuer({
      issuerId: issuer.issuerId,
      publicKeyPem: issuer.publicKeyPem,
      active: issuer.active ?? true,
    });
  }
  for (const credentialId of new Set(revokedCredentialIds)) {
    registry.revokeCredential(credentialId);
  }

  return {
    service: new TrustAccessService(registry),
    enforceTrustAccess: mode === 'ENFORCED',
    mode,
    activeIssuerCount,
    revokedCredentialCount: new Set(revokedCredentialIds).size,
  };
}

function parseJson<T>(raw: string | undefined, schema: z.ZodType<T>, name: string, fallback: T): T {
  if (!raw?.trim()) return fallback;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error(`${name} must contain valid JSON.`);
  }
  const result = schema.safeParse(decoded);
  if (!result.success) throw new Error(`${name} did not match the required contract.`);
  return result.data;
}
