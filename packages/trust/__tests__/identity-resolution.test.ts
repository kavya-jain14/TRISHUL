/**
 * Identity Resolution Tests
 *
 * Tests the most sensitive operation in the trust module:
 * - No active case → reject
 * - No valid authorization → reject
 * - Invalid account/case relationship → reject
 * - Wrong purpose → reject
 * - Expired nonce → reject
 * - Successful request → audit event generated + redacted info returned
 *
 * Owner: Vatsal Bhardwaj
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { IdentityResolutionService } from "../src/identity-resolution.js";
import { CredentialVerifier } from "../src/credential-verifier.js";
import { NonceStore } from "../src/nonce-store.js";
import { AccessController } from "../src/access-control.js";
import type { Credential } from "@trishul/contracts";
import type {
  CaseService,
  AuditService,
  BankKycLookupService,
  IssuerRegistry,
  RevocationRegistry,
  CaseContext,
} from "../src/types.js";

// ─── Test Fixtures ───────────────────────────────────────────────────────────

const ACTIVE_ISSUER_ID = "00000000-0000-0000-0000-000000000001";
const CASE_ID = "case-00000000-0000-0000-0000-000000000001";
const ACCOUNT_REF = "acc_001";

function makeCredential(
  overrides: Partial<Credential> = {}
): Credential {
  const now = new Date();
  return {
    id: "cred-00000000-0000-0000-0000-000000000001",
    issuerRef: ACTIVE_ISSUER_ID,
    subjectId: "user-00000000-0000-0000-0000-000000000001",
    role: "CYBER_CELL_OFFICER",
    purpose: "IDENTITY_RESOLUTION",
    validFrom: new Date(now.getTime() - 3600_000).toISOString(),
    validUntil: new Date(now.getTime() + 3600_000).toISOString(),
    status: "VERIFIED",
    publicKeyHash: "a".repeat(64),
    issuedAt: new Date(now.getTime() - 7200_000).toISOString(),
    ...overrides,
  };
}

function createMockIssuerRegistry(): IssuerRegistry {
  return {
    async getIssuer(issuerId: string) {
      if (issuerId === ACTIVE_ISSUER_ID) {
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
      return issuerId === ACTIVE_ISSUER_ID;
    },
  };
}

function createMockRevocationRegistry(): RevocationRegistry {
  return {
    async isRevoked() { return false; },
    async getRevocationReason() { return null; },
  };
}

function createMockCaseService(
  activeCases = new Map<string, CaseContext>([
    [
      CASE_ID,
      {
        caseId: CASE_ID,
        isActive: true,
        accountRefs: [ACCOUNT_REF, "acc_002"],
      },
    ],
  ])
): CaseService {
  return {
    async getCaseContext(caseId: string) {
      return activeCases.get(caseId) ?? null;
    },
  };
}

function createMockAuditService(): AuditService & { events: any[] } {
  const events: any[] = [];
  return {
    events,
    async record(event) {
      const id = `audit-${events.length + 1}`;
      events.push({ id, ...event });
      return id;
    },
  };
}

function createMockBankKycLookup(): BankKycLookupService {
  return {
    async resolveIdentity(accountRef: string) {
      return {
        maskedName: "V***l B***j",
        maskedAccountId: `****${accountRef.slice(-4)}`,
        institution: "Test Bank [SIMULATOR]",
        accountHolderConfirmed: true,
      };
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("IdentityResolutionService", () => {
  let service: IdentityResolutionService;
  let nonceStore: NonceStore;
  let auditService: ReturnType<typeof createMockAuditService>;

  beforeEach(() => {
    nonceStore = new NonceStore(5000, 60_000);
    auditService = createMockAuditService();

    service = new IdentityResolutionService(
      new CredentialVerifier(
        createMockIssuerRegistry(),
        createMockRevocationRegistry()
      ),
      nonceStore,
      new AccessController(),
      createMockCaseService(),
      auditService,
      createMockBankKycLookup()
    );
  });

  afterEach(() => {
    nonceStore.destroy();
  });

  it("should resolve identity with valid authorization", async () => {
    const credential = makeCredential();
    const { nonce } = nonceStore.issue(credential.subjectId);

    const result = await service.resolve({
      caseId: CASE_ID,
      accountRef: ACCOUNT_REF,
      investigatorCredential: credential,
      challengeNonce: nonce,
    });

    expect(result.status).toBe("RESOLVED");
    expect(result.redactedInfo).toBeDefined();
    expect(result.redactedInfo?.maskedName).toBe("V***l B***j");
    expect(result.redactedInfo?.accountHolderConfirmed).toBe(true);
    expect(result.auditRef).toBeDefined();

    // Verify audit events were generated
    expect(auditService.events.length).toBeGreaterThanOrEqual(2);
    const completedEvent = auditService.events.find(
      (e: any) => e.action === "IDENTITY_RESOLUTION_COMPLETED"
    );
    expect(completedEvent).toBeDefined();
  });

  it("should reject when no active case exists", async () => {
    const credential = makeCredential();
    const { nonce } = nonceStore.issue(credential.subjectId);

    const result = await service.resolve({
      caseId: "nonexistent-case-id",
      accountRef: ACCOUNT_REF,
      investigatorCredential: credential,
      challengeNonce: nonce,
    });

    expect(result.status).toBe("DENIED");
    expect(result.reason).toContain("No active case");
    expect(result.auditRef).toBeDefined();
  });

  it("should reject when credential has wrong purpose", async () => {
    const credential = makeCredential({ purpose: "CASE_INVESTIGATION" });
    const { nonce } = nonceStore.issue(credential.subjectId);

    const result = await service.resolve({
      caseId: CASE_ID,
      accountRef: ACCOUNT_REF,
      investigatorCredential: credential,
      challengeNonce: nonce,
    });

    expect(result.status).toBe("DENIED");
    expect(result.reason).toContain("Purpose mismatch");
    expect(result.auditRef).toBeDefined();
  });

  it("should reject when account is not associated with case", async () => {
    const credential = makeCredential();
    const { nonce } = nonceStore.issue(credential.subjectId);

    const result = await service.resolve({
      caseId: CASE_ID,
      accountRef: "unknown_account_ref",
      investigatorCredential: credential,
      challengeNonce: nonce,
    });

    expect(result.status).toBe("DENIED");
    expect(result.reason).toContain("not associated");
    expect(result.auditRef).toBeDefined();
  });

  it("should reject expired nonce", async () => {
    const credential = makeCredential();
    const shortNonceStore = new NonceStore(50, 60_000); // 50ms TTL
    const shortService = new IdentityResolutionService(
      new CredentialVerifier(
        createMockIssuerRegistry(),
        createMockRevocationRegistry()
      ),
      shortNonceStore,
      new AccessController(),
      createMockCaseService(),
      auditService,
      createMockBankKycLookup()
    );

    const { nonce } = shortNonceStore.issue(credential.subjectId);

    // Wait for nonce to expire
    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = await shortService.resolve({
      caseId: CASE_ID,
      accountRef: ACCOUNT_REF,
      investigatorCredential: credential,
      challengeNonce: nonce,
    });

    expect(result.status).toBe("DENIED");
    expect(result.reason).toContain("NONCE_EXPIRED");

    shortNonceStore.destroy();
  });

  it("should reject credential from inactive issuer", async () => {
    const credential = makeCredential({
      issuerRef: "00000000-0000-0000-0000-999999999999",
    });
    const { nonce } = nonceStore.issue(credential.subjectId);

    const result = await service.resolve({
      caseId: CASE_ID,
      accountRef: ACCOUNT_REF,
      investigatorCredential: credential,
      challengeNonce: nonce,
    });

    expect(result.status).toBe("DENIED");
    expect(result.reason).toContain("Credential verification failed");
    expect(result.auditRef).toBeDefined();
  });

  it("should generate audit events for every denial", async () => {
    const credential = makeCredential();
    const { nonce } = nonceStore.issue(credential.subjectId);

    // This will be denied because account is not associated
    await service.resolve({
      caseId: CASE_ID,
      accountRef: "unknown_ref",
      investigatorCredential: credential,
      challengeNonce: nonce,
    });

    const denialEvents = auditService.events.filter(
      (e: any) => e.action === "IDENTITY_RESOLUTION_DENIED"
    );
    expect(denialEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("should never expose raw identity data in audit events", async () => {
    const credential = makeCredential();
    const { nonce } = nonceStore.issue(credential.subjectId);

    await service.resolve({
      caseId: CASE_ID,
      accountRef: ACCOUNT_REF,
      investigatorCredential: credential,
      challengeNonce: nonce,
    });

    // Check that no audit event contains unmasked names or raw KYC data
    for (const event of auditService.events) {
      const eventStr = JSON.stringify(event);
      // Should not contain any raw name data
      expect(eventStr).not.toContain("Vatsal Bhardwaj");
      expect(eventStr).not.toContain("Aadhaar");
      expect(eventStr).not.toContain("PAN");
    }
  });
});
