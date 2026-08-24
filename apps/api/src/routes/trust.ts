/**
 * Trust Routes
 *
 * API endpoints for challenge-response authentication and credential management.
 *
 * Endpoints:
 * - POST /api/trust/challenge       — Issue fresh nonce/challenge
 * - POST /api/trust/verify          — Verify credential + challenge response
 * - GET  /api/trust/credential/:id/status — Check credential status
 * - POST /api/trust/credential/register   — Register a new credential
 * - POST /api/trust/credential/:id/revoke — Revoke a credential
 *
 * Owner: Vatsal Bhardwaj
 * Consumers: Ujjwal (frontend), Kavya (orchestration)
 */

import { Hono } from "hono";
import {
  ChallengeRequestSchema,
  ChallengeProofSchema,
  CredentialSchema,
} from "@trishul/contracts";
import type { ChallengeResponseService, CredentialRegistryService, CredentialVerifier } from "@trishul/trust";

export function createTrustRoutes(deps: {
  challengeResponseService: ChallengeResponseService;
  credentialVerifier: CredentialVerifier;
  credentialRegistry: CredentialRegistryService;
}) {
  const app = new Hono();

  /**
   * POST /api/trust/challenge
   *
   * Issue a fresh challenge with nonce for an investigator.
   * The investigator must return this nonce in their verification proof.
   */
  app.post("/challenge", async (c) => {
    const body = await c.req.json();
    const parsed = ChallengeRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        { error: "BAD_REQUEST", details: parsed.error.issues },
        400
      );
    }

    const challenge = deps.challengeResponseService.issueChallenge(
      parsed.data.investigatorId
    );

    return c.json(challenge, 200);
  });

  /**
   * POST /api/trust/verify
   *
   * Verify a challenge-response proof.
   * Validates nonce freshness, credential, and access in one flow.
   */
  app.post("/verify", async (c) => {
    const body = await c.req.json();
    const parsed = ChallengeProofSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        { error: "BAD_REQUEST", details: parsed.error.issues },
        400
      );
    }

    const { nonce, credentialId, requestedCapability, caseId, signature } =
      parsed.data;

    // In the prototype, the credential is sent in the X-Credential header
    // and the proof body contains the challenge response
    const credentialHeader = c.req.header("X-Credential");
    if (!credentialHeader) {
      return c.json(
        { error: "UNAUTHORIZED", message: "Missing X-Credential header" },
        401
      );
    }

    let credential;
    try {
      const raw = JSON.parse(credentialHeader);
      const credParsed = CredentialSchema.safeParse(raw);
      if (!credParsed.success) {
        return c.json(
          { error: "BAD_REQUEST", message: "Invalid credential format" },
          400
        );
      }
      credential = credParsed.data;
    } catch {
      return c.json(
        { error: "BAD_REQUEST", message: "X-Credential is not valid JSON" },
        400
      );
    }

    // Build case context if caseId is provided
    const caseContext = caseId
      ? { caseId, isActive: true, accountRefs: [] }
      : undefined;

    const result = await deps.challengeResponseService.verifyProof(
      nonce,
      credential,
      requestedCapability,
      caseContext
    );

    const statusCode = result.verdict === "AUTHORIZED" ? 200 : 403;
    return c.json(result, statusCode);
  });

  /**
   * GET /api/trust/credential/:id/status
   *
   * Check the verification status of a credential.
   */
  app.get("/credential/:id/status", async (c) => {
    const credentialHeader = c.req.header("X-Credential");
    if (!credentialHeader) {
      return c.json(
        { error: "UNAUTHORIZED", message: "Missing X-Credential header" },
        401
      );
    }

    let credential;
    try {
      credential = JSON.parse(credentialHeader);
      const parsed = CredentialSchema.safeParse(credential);
      if (!parsed.success) {
        return c.json(
          { error: "BAD_REQUEST", message: "Invalid credential" },
          400
        );
      }
      credential = parsed.data;
    } catch {
      return c.json(
        { error: "BAD_REQUEST", message: "Invalid credential JSON" },
        400
      );
    }

    const result = await deps.credentialVerifier.verify(credential);

    return c.json(
      {
        credentialId: c.req.param("id"),
        status: result.status,
        reason: result.reason,
        checkedAt: new Date().toISOString(),
      },
      200
    );
  });

  /**
   * POST /api/trust/credential/register
   *
   * Register a new credential on the blockchain registry.
   */
  app.post("/credential/register", async (c) => {
    const body = await c.req.json();
    const parsed = CredentialSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        { error: "BAD_REQUEST", details: parsed.error.issues },
        400
      );
    }

    const entry = await deps.credentialRegistry.register(parsed.data);
    return c.json(entry, 201);
  });

  /**
   * POST /api/trust/credential/:id/revoke
   *
   * Revoke a credential. Requires the credential in the body and a reason.
   */
  app.post("/credential/:id/revoke", async (c) => {
    const body = await c.req.json();
    const { credential: rawCredential, reason } = body;

    if (!reason || typeof reason !== "string") {
      return c.json(
        { error: "BAD_REQUEST", message: "Revocation reason is required" },
        400
      );
    }

    const parsed = CredentialSchema.safeParse(rawCredential);
    if (!parsed.success) {
      return c.json(
        { error: "BAD_REQUEST", details: parsed.error.issues },
        400
      );
    }

    const entry = await deps.credentialRegistry.revoke(parsed.data, reason);
    return c.json(entry, 200);
  });

  return app;
}
