/**
 * TRISHUL API Server
 *
 * Entry point for the API application.
 * Mounts trust, identity-resolution, and audit route modules.
 *
 * Other team members add their route modules here:
 * - Kavya: intelligence orchestration routes
 * - Fuzail: transaction/event routes
 * - Sandhya: case/complaint routes
 * - Vanshika: prediction routes
 *
 * Owner: Vatsal Bhardwaj (trust/access routes)
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { logger } from "hono/logger";
import { cors } from "hono/cors";

// Trust engine
import {
  CredentialVerifier,
  ChallengeResponseService,
  NonceStore,
  AccessController,
  IdentityResolutionService,
  CredentialRegistryService,
} from "@trishul/trust";

// Audit
import { AuditLogger, BlockchainSimulator } from "@trishul/audit";

// Routes
import { createTrustRoutes } from "./routes/trust.js";
import { createIdentityResolutionRoutes } from "./routes/identity-resolution.js";
import { createAuditRoutes } from "./routes/audit.js";

// ─── Initialize Services ────────────────────────────────────────────────────

// Blockchain simulator [SIMULATOR]
const blockchainSimulator = new BlockchainSimulator();

// Audit logger with blockchain anchoring
const auditLogger = new AuditLogger(blockchainSimulator, true);

// Nonce store (5-minute TTL)
const nonceStore = new NonceStore(5 * 60 * 1000);

/**
 * [SIMULATOR] In-memory issuer registry.
 * In production, this would query the issuers table in PostgreSQL.
 */
const issuerRegistry = {
  async getIssuer(issuerId: string) {
    const issuers = simulatedIssuers();
    return issuers.get(issuerId) ?? null;
  },
  async isIssuerActive(issuerId: string) {
    const issuers = simulatedIssuers();
    const issuer = issuers.get(issuerId);
    return issuer?.active ?? false;
  },
};

/**
 * [SIMULATOR] In-memory revocation registry.
 * In production, this would query the credential_revocations table.
 */
const revocationRegistry = {
  revokedCredentials: new Map<string, string>(),
  async isRevoked(credentialId: string) {
    return this.revokedCredentials.has(credentialId);
  },
  async getRevocationReason(credentialId: string) {
    return this.revokedCredentials.get(credentialId) ?? null;
  },
};

// Trust engine services
const credentialVerifier = new CredentialVerifier(
  issuerRegistry,
  revocationRegistry
);
const accessController = new AccessController();
const challengeResponseService = new ChallengeResponseService(
  nonceStore,
  credentialVerifier,
  accessController,
  auditLogger
);

/**
 * [SIMULATOR] Case service.
 * In production, this would be Sandhya's case module.
 */
const caseService = {
  async getCaseContext(caseId: string) {
    // Simulated active cases for prototype
    return {
      caseId,
      isActive: true,
      accountRefs: ["acc_001", "acc_002", "vpa@upi"],
    };
  },
};

/**
 * [SIMULATOR] Bank KYC lookup service.
 * In production, this would make secure off-chain API calls to regulated institutions.
 */
const bankKycLookup = {
  async resolveIdentity(accountRef: string, _authorizationProof: string) {
    // Deterministic simulated response
    return {
      maskedName: "V***l B***j",
      maskedAccountId: `****${accountRef.slice(-4)}`,
      institution: "State Bank of India [SIMULATOR]",
      accountHolderConfirmed: true,
    };
  },
};

const identityResolutionService = new IdentityResolutionService(
  credentialVerifier,
  nonceStore,
  accessController,
  caseService,
  auditLogger,
  bankKycLookup
);

const credentialRegistryService = new CredentialRegistryService(
  blockchainSimulator,
  auditLogger
);

// ─── Create Hono App ─────────────────────────────────────────────────────────

const app = new Hono();

// Global middleware
app.use("*", logger());
app.use("*", cors());

// Health check
app.get("/health", (c) =>
  c.json({ status: "ok", service: "trishul-api", timestamp: new Date().toISOString() })
);

// Mount route modules
app.route(
  "/api/trust",
  createTrustRoutes({
    challengeResponseService,
    credentialVerifier,
    credentialRegistry: credentialRegistryService,
  })
);

app.route(
  "/api/identity-resolution",
  createIdentityResolutionRoutes({
    identityResolutionService,
  })
);

app.route(
  "/api/audit",
  createAuditRoutes({
    auditLogger,
  })
);

// ─── Start Server ────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT ?? "3000", 10);

console.log(`
┌──────────────────────────────────────────────┐
│         TRISHUL API Server                   │
│         Trust / Access / PrivacyPass         │
│                                              │
│  Routes:                                     │
│    POST /api/trust/challenge                 │
│    POST /api/trust/verify                    │
│    GET  /api/trust/credential/:id/status     │
│    POST /api/trust/credential/register       │
│    POST /api/trust/credential/:id/revoke     │
│    POST /api/identity-resolution/request     │
│    GET  /api/identity-resolution/:id/status  │
│    GET  /api/audit/events                    │
│    GET  /api/audit/event/:id                 │
│                                              │
│  [SIMULATOR] Using in-memory stores          │
│  [SIMULATOR] Blockchain simulator active     │
└──────────────────────────────────────────────┘
`);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`🔱 TRISHUL API listening on http://localhost:${info.port}`);
});

// ─── Simulated Data ──────────────────────────────────────────────────────────

/**
 * [SIMULATOR] Simulated trusted issuers.
 * In production, these would be seeded in the database
 * by the system administration process.
 */
function simulatedIssuers() {
  const issuers = new Map<string, import("@trishul/contracts").Issuer>();

  issuers.set("00000000-0000-0000-0000-000000000001", {
    id: "00000000-0000-0000-0000-000000000001",
    name: "National Cyber Crime Coordination Centre (I4C)",
    publicKey: "sim_pub_key_i4c_001",
    active: true,
    registeredAt: "2026-01-01T00:00:00.000Z",
  });

  issuers.set("00000000-0000-0000-0000-000000000002", {
    id: "00000000-0000-0000-0000-000000000002",
    name: "Reserve Bank of India — Cyber Security Division",
    publicKey: "sim_pub_key_rbi_001",
    active: true,
    registeredAt: "2026-01-01T00:00:00.000Z",
  });

  issuers.set("00000000-0000-0000-0000-000000000003", {
    id: "00000000-0000-0000-0000-000000000003",
    name: "Deactivated Test Issuer",
    publicKey: "sim_pub_key_deactivated",
    active: false,
    registeredAt: "2025-01-01T00:00:00.000Z",
  });

  return issuers;
}

export default app;
