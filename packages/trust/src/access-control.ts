/**
 * Access Controller
 *
 * Evaluates whether a verified credential grants access to a specific capability.
 * Maps role + purpose → permitted capabilities.
 *
 * NEVER grants unrestricted access simply because a user is authenticated.
 * Each capability must be explicitly mapped.
 *
 * Owner: Vatsal Bhardwaj
 */

import { randomBytes } from "crypto";
import type {
  Credential,
  AccessVerdict,
  AccessResult,
  Capability,
  InvestigatorRole,
  AccessPurpose,
} from "@trishul/contracts";
import type { AccessEvaluationContext, CaseContext } from "./types.js";

/**
 * Permission mapping: role + purpose → allowed capabilities.
 *
 * This is deliberately restrictive. Each role/purpose combination
 * grants only the minimum capabilities required.
 */
const PERMISSION_MAP: Record<
  string,
  Capability[]
> = {
  // Cyber Cell Officer — case investigation
  "CYBER_CELL_OFFICER:CASE_INVESTIGATION": [
    "EVIDENCE_ACCESS",
    "BANK_ACCOUNT_DETAIL",
  ],
  "CYBER_CELL_OFFICER:IDENTITY_RESOLUTION": [
    "IDENTITY_RESOLUTION",
    "BANK_ACCOUNT_DETAIL",
  ],
  "CYBER_CELL_OFFICER:EVIDENCE_REVIEW": ["EVIDENCE_ACCESS"],
  "CYBER_CELL_OFFICER:INTERVENTION_ACTION": [
    "INTERVENTION_CONTROL",
    "EVIDENCE_ACCESS",
  ],

  // Financial Intelligence Analyst — analysis focus
  "FINANCIAL_INTELLIGENCE_ANALYST:CASE_INVESTIGATION": [
    "EVIDENCE_ACCESS",
    "BANK_ACCOUNT_DETAIL",
    "INTELLIGENCE_EXPORT",
  ],
  "FINANCIAL_INTELLIGENCE_ANALYST:EVIDENCE_REVIEW": [
    "EVIDENCE_ACCESS",
    "INTELLIGENCE_EXPORT",
  ],
  "FINANCIAL_INTELLIGENCE_ANALYST:INTELLIGENCE_EXPORT": [
    "INTELLIGENCE_EXPORT",
    "EVIDENCE_ACCESS",
  ],

  // Nodal Officer — broad oversight
  "NODAL_OFFICER:CASE_INVESTIGATION": [
    "EVIDENCE_ACCESS",
    "BANK_ACCOUNT_DETAIL",
    "IDENTITY_RESOLUTION",
  ],
  "NODAL_OFFICER:IDENTITY_RESOLUTION": [
    "IDENTITY_RESOLUTION",
    "BANK_ACCOUNT_DETAIL",
  ],
  "NODAL_OFFICER:INTERVENTION_ACTION": [
    "INTERVENTION_CONTROL",
    "EVIDENCE_ACCESS",
  ],
  "NODAL_OFFICER:INTELLIGENCE_EXPORT": [
    "INTELLIGENCE_EXPORT",
    "EVIDENCE_ACCESS",
  ],

  // Supervising Officer — restricted oversight
  "SUPERVISING_OFFICER:CASE_INVESTIGATION": ["EVIDENCE_ACCESS"],
  "SUPERVISING_OFFICER:AUDIT_REVIEW": ["EVIDENCE_ACCESS"],

  // Bank Compliance Officer — bank-related only
  "BANK_COMPLIANCE_OFFICER:CASE_INVESTIGATION": ["BANK_ACCOUNT_DETAIL"],
  "BANK_COMPLIANCE_OFFICER:IDENTITY_RESOLUTION": [
    "IDENTITY_RESOLUTION",
    "BANK_ACCOUNT_DETAIL",
  ],

  // System Admin — system administration only, no case intelligence
  "SYSTEM_ADMIN:SYSTEM_ADMINISTRATION": [],
};

export class AccessController {
  /**
   * Evaluate whether a verified credential grants access to the requested capability.
   *
   * Checks:
   * 1. Role + purpose maps to allowed capabilities
   * 2. Requested capability is in the allowed set
   * 3. Case-bound operations require an active case
   */
  evaluate(context: AccessEvaluationContext): AccessResult {
    const { credential, requestedCapability, caseContext } = context;
    const now = new Date();

    // Build permission key
    const permKey = `${credential.role}:${credential.purpose}`;
    const allowedCapabilities = PERMISSION_MAP[permKey];

    // Role + purpose combination not recognized
    if (!allowedCapabilities) {
      return {
        verdict: "ROLE_INSUFFICIENT",
        reason: `No capabilities mapped for role=${credential.role} with purpose=${credential.purpose}`,
        grantedCapabilities: [],
        evaluatedAt: now.toISOString(),
      };
    }

    // Check if the requested capability is in the allowed set
    if (!allowedCapabilities.includes(requestedCapability)) {
      // Determine if this is a purpose mismatch or role insufficiency
      const anyRoleHasCapability = Object.entries(PERMISSION_MAP).some(
        ([key, caps]) =>
          key.startsWith(`${credential.role}:`) &&
          caps.includes(requestedCapability)
      );

      const verdict: AccessVerdict = anyRoleHasCapability
        ? "PURPOSE_MISMATCH"
        : "ROLE_INSUFFICIENT";

      return {
        verdict,
        reason: `Capability ${requestedCapability} is not granted for role=${credential.role} with purpose=${credential.purpose}`,
        grantedCapabilities: [],
        evaluatedAt: now.toISOString(),
      };
    }

    // Case-bound capabilities require an active case
    const caseBoundCapabilities: Capability[] = [
      "IDENTITY_RESOLUTION",
      "EVIDENCE_ACCESS",
      "INTERVENTION_CONTROL",
      "INTELLIGENCE_EXPORT",
    ];

    if (caseBoundCapabilities.includes(requestedCapability)) {
      if (!caseContext) {
        return {
          verdict: "DENIED",
          reason: `Capability ${requestedCapability} requires an active case context`,
          grantedCapabilities: [],
          evaluatedAt: now.toISOString(),
        };
      }

      if (!caseContext.isActive) {
        return {
          verdict: "DENIED",
          reason: `Case ${caseContext.caseId} is not active`,
          grantedCapabilities: [],
          evaluatedAt: now.toISOString(),
        };
      }
    }

    // Access granted — issue a session ID
    const sessionId = randomBytes(16).toString("hex") +
      "-" + randomBytes(4).toString("hex") +
      "-4" + randomBytes(3).toString("hex").slice(1) +
      "-" + randomBytes(4).toString("hex") +
      "-" + randomBytes(12).toString("hex");

    return {
      verdict: "AUTHORIZED",
      reason: `Access granted for ${requestedCapability} with role=${credential.role}, purpose=${credential.purpose}`,
      grantedCapabilities: [requestedCapability],
      sessionId,
      evaluatedAt: now.toISOString(),
    };
  }
}
