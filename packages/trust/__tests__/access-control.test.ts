/**
 * Access Controller Tests
 *
 * Tests authorization logic:
 * - Correct role + purpose + valid credential → AUTHORIZED
 * - Authenticated but unauthorized (wrong role) → ROLE_INSUFFICIENT
 * - Wrong purpose → PURPOSE_MISMATCH
 * - Case-bound capability without case context → DENIED
 * - Inactive case → DENIED
 *
 * Owner: Vatsal Bhardwaj
 */

import { describe, it, expect } from "vitest";
import { AccessController } from "../src/access-control.js";
import type { Credential, Capability } from "@trishul/contracts";
import type { CaseContext } from "../src/types.js";

// ─── Test Fixtures ───────────────────────────────────────────────────────────

function makeCredential(
  role: Credential["role"],
  purpose: Credential["purpose"]
): Credential {
  const now = new Date();
  return {
    id: "cred-test-001",
    issuerRef: "issuer-test-001",
    subjectId: "user-test-001",
    role,
    purpose,
    validFrom: new Date(now.getTime() - 3600_000).toISOString(),
    validUntil: new Date(now.getTime() + 3600_000).toISOString(),
    status: "VERIFIED",
    publicKeyHash: "a".repeat(64),
    issuedAt: new Date(now.getTime() - 7200_000).toISOString(),
  };
}

const ACTIVE_CASE: CaseContext = {
  caseId: "case-001",
  isActive: true,
  accountRefs: ["acc_001"],
};

const INACTIVE_CASE: CaseContext = {
  caseId: "case-002",
  isActive: false,
  accountRefs: [],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("AccessController", () => {
  const controller = new AccessController();

  describe("Authorized access", () => {
    it("should authorize CYBER_CELL_OFFICER for EVIDENCE_ACCESS with CASE_INVESTIGATION purpose", () => {
      const credential = makeCredential(
        "CYBER_CELL_OFFICER",
        "CASE_INVESTIGATION"
      );
      const result = controller.evaluate({
        credential,
        requestedCapability: "EVIDENCE_ACCESS",
        caseContext: ACTIVE_CASE,
      });

      expect(result.verdict).toBe("AUTHORIZED");
      expect(result.grantedCapabilities).toContain("EVIDENCE_ACCESS");
      expect(result.sessionId).toBeDefined();
    });

    it("should authorize NODAL_OFFICER for IDENTITY_RESOLUTION with IDENTITY_RESOLUTION purpose", () => {
      const credential = makeCredential(
        "NODAL_OFFICER",
        "IDENTITY_RESOLUTION"
      );
      const result = controller.evaluate({
        credential,
        requestedCapability: "IDENTITY_RESOLUTION",
        caseContext: ACTIVE_CASE,
      });

      expect(result.verdict).toBe("AUTHORIZED");
      expect(result.grantedCapabilities).toContain("IDENTITY_RESOLUTION");
    });

    it("should authorize FINANCIAL_INTELLIGENCE_ANALYST for INTELLIGENCE_EXPORT", () => {
      const credential = makeCredential(
        "FINANCIAL_INTELLIGENCE_ANALYST",
        "INTELLIGENCE_EXPORT"
      );
      const result = controller.evaluate({
        credential,
        requestedCapability: "INTELLIGENCE_EXPORT",
        caseContext: ACTIVE_CASE,
      });

      expect(result.verdict).toBe("AUTHORIZED");
    });
  });

  describe("Denied access — role insufficient", () => {
    it("should deny SUPERVISING_OFFICER for IDENTITY_RESOLUTION (role has no path to this capability)", () => {
      const credential = makeCredential(
        "SUPERVISING_OFFICER",
        "CASE_INVESTIGATION"
      );
      const result = controller.evaluate({
        credential,
        requestedCapability: "IDENTITY_RESOLUTION",
        caseContext: ACTIVE_CASE,
      });

      expect(result.verdict).toBe("ROLE_INSUFFICIENT");
      expect(result.grantedCapabilities).toHaveLength(0);
    });

    it("should deny SYSTEM_ADMIN for EVIDENCE_ACCESS", () => {
      const credential = makeCredential(
        "SYSTEM_ADMIN",
        "SYSTEM_ADMINISTRATION"
      );
      const result = controller.evaluate({
        credential,
        requestedCapability: "EVIDENCE_ACCESS",
      });

      expect(result.verdict).toBe("ROLE_INSUFFICIENT");
    });
  });

  describe("Denied access — purpose mismatch", () => {
    it("should deny CYBER_CELL_OFFICER with EVIDENCE_REVIEW purpose requesting BANK_ACCOUNT_DETAIL", () => {
      const credential = makeCredential(
        "CYBER_CELL_OFFICER",
        "EVIDENCE_REVIEW"
      );
      const result = controller.evaluate({
        credential,
        requestedCapability: "BANK_ACCOUNT_DETAIL",
        caseContext: ACTIVE_CASE,
      });

      // CYBER_CELL_OFFICER can get BANK_ACCOUNT_DETAIL with CASE_INVESTIGATION purpose
      // but not with EVIDENCE_REVIEW, so this is a PURPOSE_MISMATCH
      expect(result.verdict).toBe("PURPOSE_MISMATCH");
    });
  });

  describe("Denied access — case-bound capabilities", () => {
    it("should deny case-bound capability without case context", () => {
      const credential = makeCredential(
        "CYBER_CELL_OFFICER",
        "CASE_INVESTIGATION"
      );
      const result = controller.evaluate({
        credential,
        requestedCapability: "EVIDENCE_ACCESS",
        // No caseContext provided
      });

      expect(result.verdict).toBe("DENIED");
      expect(result.reason).toContain("requires an active case");
    });

    it("should deny case-bound capability for inactive case", () => {
      const credential = makeCredential(
        "CYBER_CELL_OFFICER",
        "CASE_INVESTIGATION"
      );
      const result = controller.evaluate({
        credential,
        requestedCapability: "EVIDENCE_ACCESS",
        caseContext: INACTIVE_CASE,
      });

      expect(result.verdict).toBe("DENIED");
      expect(result.reason).toContain("not active");
    });
  });

  describe("BANK_ACCOUNT_DETAIL — not case-bound", () => {
    it("should authorize BANK_ACCOUNT_DETAIL without case context (not case-bound)", () => {
      const credential = makeCredential(
        "CYBER_CELL_OFFICER",
        "CASE_INVESTIGATION"
      );
      const result = controller.evaluate({
        credential,
        requestedCapability: "BANK_ACCOUNT_DETAIL",
        // BANK_ACCOUNT_DETAIL is not in caseBoundCapabilities
      });

      expect(result.verdict).toBe("AUTHORIZED");
    });
  });
});
