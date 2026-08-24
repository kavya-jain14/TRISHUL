/**
 * Trust Guard Middleware
 *
 * Hono middleware for authenticating and authorizing requests
 * via the PrivacyPass credential verification flow.
 *
 * Extracts credential from request, verifies via trust engine,
 * and attaches verified context to the request.
 *
 * Owner: Vatsal Bhardwaj
 * Consumers: All protected API routes
 */

import { createMiddleware } from "hono/factory";
import type { Context, Next } from "hono";
import { CredentialSchema } from "@trishul/contracts";
import type { CredentialVerifier, VerificationResult } from "@trishul/trust";

/** Extended Hono variables for trust context */
export interface TrustContext {
  /** Verified credential (only set if verification passed) */
  verifiedCredential?: import("@trishul/contracts").Credential;
  /** Verification result */
  verificationResult?: VerificationResult;
}

/**
 * Create trust guard middleware.
 *
 * Usage:
 * ```ts
 * app.use('/api/trust/*', trustGuard(credentialVerifier));
 * ```
 *
 * The middleware:
 * 1. Extracts the credential from X-Credential header (JSON)
 * 2. Validates the credential schema
 * 3. Verifies the credential via the trust engine
 * 4. Attaches the verified credential to c.set('trustContext', ...)
 * 5. Rejects unauthenticated/unauthorized requests with appropriate status
 */
export function createTrustGuard(credentialVerifier: CredentialVerifier) {
  return createMiddleware(async (c: Context, next: Next) => {
    const credentialHeader = c.req.header("X-Credential");

    if (!credentialHeader) {
      return c.json(
        {
          error: "UNAUTHORIZED",
          message: "Missing X-Credential header",
          verdict: "DENIED",
        },
        401
      );
    }

    // Parse credential from header
    let rawCredential: unknown;
    try {
      rawCredential = JSON.parse(credentialHeader);
    } catch {
      return c.json(
        {
          error: "BAD_REQUEST",
          message: "X-Credential header is not valid JSON",
          verdict: "INVALID",
        },
        400
      );
    }

    // Validate credential schema
    const parseResult = CredentialSchema.safeParse(rawCredential);
    if (!parseResult.success) {
      return c.json(
        {
          error: "BAD_REQUEST",
          message: "Invalid credential format",
          verdict: "INVALID",
          details: parseResult.error.issues,
        },
        400
      );
    }

    const credential = parseResult.data;

    // Verify credential via trust engine
    const result = await credentialVerifier.verify(credential);

    if (result.status !== "VERIFIED") {
      const statusCode = result.status === "EXPIRED" ? 401 : 403;
      return c.json(
        {
          error: result.status === "EXPIRED" ? "UNAUTHORIZED" : "FORBIDDEN",
          message: result.reason,
          verdict: result.status,
        },
        statusCode
      );
    }

    // Attach verified credential to request context
    c.set("verifiedCredential", credential);
    c.set("verificationResult", result);

    await next();
  });
}
