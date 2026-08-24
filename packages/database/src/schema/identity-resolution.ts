/**
 * Identity Resolution schema
 *
 * Tables for tracking lawful identity resolution requests.
 * Each request is case-bound and requires valid investigator authorization.
 *
 * Owner: Vatsal Bhardwaj
 * Integration: Sandhya (case IDs), Fuzail (account references)
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  pgEnum,
} from "drizzle-orm/pg-core";

export const identityResolutionStatusEnum = pgEnum(
  "identity_resolution_status",
  ["REQUESTED", "AUTHORIZING", "RESOLVED", "DENIED", "FAILED"]
);

/** Identity resolution requests — each bound to an active case */
export const identityResolutionRequests = pgTable(
  "identity_resolution_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The active case this resolution is bound to */
    caseId: uuid("case_id").notNull(),
    /** Account reference to resolve (e.g., UPI VPA hash, bank account ref) */
    accountRef: varchar("account_ref", { length: 255 }).notNull(),
    /** Investigator's credential ID */
    investigatorCredentialId: uuid("investigator_credential_id").notNull(),
    /** Investigator user ID */
    investigatorId: uuid("investigator_id").notNull(),
    /** Resolution status */
    status: identityResolutionStatusEnum("status")
      .notNull()
      .default("REQUESTED"),
    /** Institution that performed the lookup */
    resolvingInstitution: varchar("resolving_institution", { length: 255 }),
    /** Whether the account holder was confirmed by the institution */
    accountHolderConfirmed: boolean("account_holder_confirmed"),
    /** Reason for denial/failure */
    reason: text("reason"),
    /** Reference to the audit event */
    auditRef: uuid("audit_ref"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  }
);
