/**
 * Credential Verifier Tests
 *
 * Tests security-critical credential verification:
 * - Valid credential accepted
 * - Expired credential rejected
 * - Revoked credential rejected
 * - Wrong/inactive issuer rejected
 * - Not-yet-valid credential rejected
 * - Missing fields rejected
 *
 * Owner: Vatsal Bhardwaj
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CredentialVerifier } from "../src/credential-verifier.js";
import type { Credential } from "@trishul/contracts";
import type { IssuerRegistry, RevocationRegistry } from "../src/types.js";

// ─── Test Fixtures ───────────────────────────────────────────────────────────

const ACTIVE_ISSUER_ID = "00000000-0000-0000-0000-000000000001";
const INACTIVE_ISSUER_ID = "00000000-0000-0000-0000-000000000003";
const UNKNOWN_ISSUER_ID = "00000000-0000-0000-0000-999999999999";

function makeCredential(overrides: Partial<Credential> = {}): Credential {
  const now = new Date();
  return {
    id: "cred-00000000-0000-0000-0000-000000000001",
    issuerRef: ACTIVE_ISSUER_ID,
    subjectId: "user-00000000-0000-0000-0000-000000000001",
    role: "CYBER_CELL_OFFICER",
    purpose: "CASE_INVESTIGATION",
    validFrom: new Date(now.getTime() - 3600_000).toISOString(), // 1 hour ago
    validUntil: new Date(now.getTime() + 3600_000).toISOString(), // 1 hour from now
    status: "VERIFIED",
    publicKeyHash: "a".repeat(64),
    issuedAt: new Date(now.getTime() - 7200_000).toISOString(),
    ...overrides,
  };
}

function createMockIssuerRegistry(
  activeIssuers = new Set([ACTIVE_ISSUER_ID])
): IssuerRegistry {
  return {
    async getIssuer(issuerId: string) {
      if (activeIssuers.has(issuerId)) {
        return {
          id: issuerId,
          name: "Test Issuer",
          publicKey: "test_pub_key",
          active: true,
          registeredAt: "2026-01-01T00:00:00.000Z",
        };
      }
      return null;
    },
    async isIssuerActive(issuerId: string) {
      return activeIssuers.has(issuerId);
    },
  };
}

function createMockRevocationRegistry(
  revokedIds = new Map<string, string>()
): RevocationRegistry {
  return {
    async isRevoked(credentialId: string) {
      return revokedIds.has(credentialId);
    },
    async getRevocationReason(credentialId: string) {
      return revokedIds.get(credentialId) ?? null;
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("CredentialVerifier", () => {
  let verifier: CredentialVerifier;
  let revocationRegistry: ReturnType<typeof createMockRevocationRegistry>;

  beforeEach(() => {
    revocationRegistry = createMockRevocationRegistry();
    verifier = new CredentialVerifier(
      createMockIssuerRegistry(),
      revocationRegistry
    );
  });

  it("should accept a valid credential", async () => {
    const credential = makeCredential();
    const result = await verifier.verify(credential);

    expect(result.status).toBe("VERIFIED");
    expect(result.credential).toBeDefined();
    expect(result.reason).toContain("valid");
  });

  it("should reject an expired credential", async () => {
    const credential = makeCredential({
      validUntil: new Date(Date.now() - 3600_000).toISOString(), // expired 1 hour ago
    });

    const result = await verifier.verify(credential);

    expect(result.status).toBe("EXPIRED");
    expect(result.credential).toBeUndefined();
    expect(result.reason).toContain("expired");
  });

  it("should reject a not-yet-valid credential", async () => {
    const credential = makeCredential({
      validFrom: new Date(Date.now() + 3600_000).toISOString(), // valid in 1 hour
    });

    const result = await verifier.verify(credential);

    expect(result.status).toBe("INVALID");
    expect(result.reason).toContain("not yet valid");
  });

  it("should reject a revoked credential", async () => {
    const credential = makeCredential();

    // Add credential to revocation registry
    const revokedMap = new Map([[credential.id, "Compromised"]]);
    revocationRegistry = createMockRevocationRegistry(revokedMap);
    verifier = new CredentialVerifier(
      createMockIssuerRegistry(),
      revocationRegistry
    );

    const result = await verifier.verify(credential);

    expect(result.status).toBe("REVOKED");
    expect(result.reason).toContain("revoked");
    expect(result.reason).toContain("Compromised");
  });

  it("should reject a credential from an unknown issuer", async () => {
    const credential = makeCredential({ issuerRef: UNKNOWN_ISSUER_ID });

    const result = await verifier.verify(credential);

    expect(result.status).toBe("INVALID");
    expect(result.reason).toContain("not a trusted active issuer");
  });

  it("should reject a credential from an inactive issuer", async () => {
    const credential = makeCredential({ issuerRef: INACTIVE_ISSUER_ID });

    const result = await verifier.verify(credential);

    expect(result.status).toBe("INVALID");
    expect(result.reason).toContain("not a trusted active issuer");
  });

  it("should reject a credential with missing required fields", async () => {
    const credential = makeCredential({ id: "" });

    const result = await verifier.verify(credential);

    expect(result.status).toBe("INVALID");
    expect(result.reason).toContain("missing required fields");
  });
});
