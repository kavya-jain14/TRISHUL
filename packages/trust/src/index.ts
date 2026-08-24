/**
 * @trishul/trust
 *
 * Core trust engine for TRISHUL.
 * Implements PrivacyPass-style credential verification, challenge-response
 * authentication, capability-scoped access control, identity resolution,
 * and credential registry management.
 *
 * Owner: Vatsal Bhardwaj
 *
 * IMPORTANT: Trust verification establishes TRUST PROPERTIES, not innocence.
 * A verified receiver must NOT be treated as safe automatically.
 * TRUST: VERIFIED and RECEIVER BEHAVIOURAL RISK: HIGH are separate dimensions.
 */

export { CredentialVerifier, type VerificationResult } from "./credential-verifier.js";
export { ChallengeResponseService } from "./challenge-response.js";
export { NonceStore } from "./nonce-store.js";
export { AccessController } from "./access-control.js";
export { IdentityResolutionService } from "./identity-resolution.js";
export { CredentialRegistryService } from "./credential-registry.js";
export type {
  VerificationContext,
  AccessEvaluationContext,
  IdentityResolutionContext,
  CaseContext,
  BlockchainAnchorService,
} from "./types.js";
