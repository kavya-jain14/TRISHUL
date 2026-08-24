/**
 * Identity Resolution Routes
 *
 * API endpoints for the lawful identity-resolution workflow.
 *
 * Endpoints:
 * - POST /api/identity-resolution/request — Initiate case-bound identity resolution
 * - GET  /api/identity-resolution/:requestId/status — Check resolution status
 *
 * Owner: Vatsal Bhardwaj
 * Consumers: Ujjwal (frontend), Sandhya (case integration)
 */

import { Hono } from "hono";
import {
  IdentityResolutionRequestSchema,
  CredentialSchema,
} from "@trishul/contracts";
import type { IdentityResolutionService } from "@trishul/trust";

/** In-memory store for completed resolutions (prototype) */
const resolutionResults = new Map<
  string,
  import("@trishul/contracts").IdentityResolutionResult
>();

export function createIdentityResolutionRoutes(deps: {
  identityResolutionService: IdentityResolutionService;
}) {
  const app = new Hono();

  /**
   * POST /api/identity-resolution/request
   *
   * Initiate an identity resolution request.
   * Requires: active case, valid credential, fresh nonce, correct purpose.
   */
  app.post("/request", async (c) => {
    // Validate request body
    const body = await c.req.json();
    const parsed = IdentityResolutionRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        { error: "BAD_REQUEST", details: parsed.error.issues },
        400
      );
    }

    // Extract credential from header
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
        { error: "BAD_REQUEST", message: "Invalid credential JSON" },
        400
      );
    }

    // Process resolution
    const result = await deps.identityResolutionService.resolve({
      caseId: parsed.data.caseId,
      accountRef: parsed.data.accountRef,
      investigatorCredential: credential,
      challengeNonce: parsed.data.challengeNonce,
    });

    // Store result for status queries
    resolutionResults.set(result.requestId, result);

    const statusCode =
      result.status === "RESOLVED"
        ? 200
        : result.status === "DENIED"
          ? 403
          : result.status === "FAILED"
            ? 502
            : 200;

    return c.json(result, statusCode);
  });

  /**
   * GET /api/identity-resolution/:requestId/status
   *
   * Check the status of an identity resolution request.
   */
  app.get("/:requestId/status", async (c) => {
    const requestId = c.req.param("requestId");
    const result = resolutionResults.get(requestId);

    if (!result) {
      return c.json(
        { error: "NOT_FOUND", message: "Resolution request not found" },
        404
      );
    }

    return c.json(result, 200);
  });

  return app;
}
