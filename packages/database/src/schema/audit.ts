/**
 * Audit schema
 *
 * Immutable audit trail for all sensitive operations.
 * Secrets and raw credentials are NEVER stored here.
 *
 * Owner: Vatsal Bhardwaj (trust/access events)
 * Integration: Sandhya (case audit events)
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";

export const auditActionEnum = pgEnum("audit_action", [
  "CHALLENGE_ISSUED",
  "CREDENTIAL_VERIFIED",
  "CREDENTIAL_REJECTED",
  "ACCESS_GRANTED",
  "ACCESS_DENIED",
  "NONCE_REPLAY_DETECTED",
  "CREDENTIAL_REGISTERED",
  "CREDENTIAL_REVOKED",
  "IDENTITY_RESOLUTION_REQUESTED",
  "IDENTITY_RESOLUTION_AUTHORIZED",
  "IDENTITY_RESOLUTION_DENIED",
  "IDENTITY_RESOLUTION_COMPLETED",
  "IDENTITY_RESOLUTION_FAILED",
  "EVIDENCE_HASH_ANCHORED",
  "EVIDENCE_INTEGRITY_VERIFIED",
  "EVIDENCE_INTEGRITY_FAILED",
  "BLOCKCHAIN_ANCHOR_CREATED",
  "BLOCKCHAIN_ANCHOR_VERIFIED",
]);

export const authorizationResultEnum = pgEnum("authorization_result", [
  "GRANTED",
  "DENIED",
  "NOT_APPLICABLE",
]);

/** Immutable audit events */
export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Who performed the action */
  actor: varchar("actor", { length: 255 }).notNull(),
  /** What action was performed */
  action: auditActionEnum("action").notNull(),
  /** Associated case ID */
  caseId: uuid("case_id"),
  /** When the event occurred */
  timestamp: timestamp("timestamp", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** Result of authorization check */
  authorizationResult: authorizationResultEnum("authorization_result")
    .notNull()
    .default("NOT_APPLICABLE"),
  /** Reference to credential used (ID only) */
  credentialRef: uuid("credential_ref"),
  /** Reference to verification session */
  sessionRef: uuid("session_ref"),
  /** Declared purpose */
  purpose: varchar("purpose", { length: 255 }),
  /** Outcome description */
  outcome: text("outcome").notNull(),
  /** Evidence hash reference */
  evidenceHashRef: varchar("evidence_hash_ref", { length: 128 }),
  /** On-chain anchor reference */
  blockchainAnchorRef: varchar("blockchain_anchor_ref", { length: 255 }),
});
