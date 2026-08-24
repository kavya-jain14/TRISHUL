/**
 * Blockchain schema
 *
 * Tables for on-chain references. These store ONLY hashes and references,
 * never raw KYC data or sensitive identity information.
 *
 * Owner: Vatsal Bhardwaj
 * Integration: Fuzail (blockchain anchor service)
 */

import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";

export const registryStatusEnum = pgEnum("registry_status", [
  "ACTIVE",
  "REVOKED",
]);

/** On-chain credential registry entries */
export const credentialRegistryEntries = pgTable(
  "credential_registry_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** SHA-256 hash of the credential */
    credentialHash: varchar("credential_hash", { length: 128 }).notNull(),
    /** Issuer reference on-chain */
    issuerRef: varchar("issuer_ref", { length: 255 }).notNull(),
    /** On-chain status */
    status: registryStatusEnum("status").notNull().default("ACTIVE"),
    /** When anchored on-chain */
    anchorTimestamp: timestamp("anchor_timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** On-chain transaction reference */
    txRef: varchar("tx_ref", { length: 255 }).notNull(),
  }
);

/** On-chain evidence hash anchors */
export const evidenceAnchors = pgTable("evidence_anchors", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** SHA-256 hash of the evidence data */
  evidenceHash: varchar("evidence_hash", { length: 128 }).notNull(),
  /** Case this evidence belongs to */
  caseId: uuid("case_id").notNull(),
  /** When anchored */
  anchorTimestamp: timestamp("anchor_timestamp", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** On-chain transaction reference */
  txRef: varchar("tx_ref", { length: 255 }).notNull(),
});

/** On-chain audit anchors */
export const auditAnchors = pgTable("audit_anchors", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** SHA-256 hash of the audit event */
  auditEventHash: varchar("audit_event_hash", { length: 128 }).notNull(),
  /** Reference to the audit event */
  auditEventId: uuid("audit_event_id").notNull(),
  /** When anchored */
  anchorTimestamp: timestamp("anchor_timestamp", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** On-chain transaction reference */
  txRef: varchar("tx_ref", { length: 255 }).notNull(),
});
