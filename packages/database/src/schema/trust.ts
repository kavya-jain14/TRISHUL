/**
 * Trust / Access schema
 *
 * Tables for credential management, issuer registry,
 * verification sessions, nonce tracking, and scoped permissions.
 *
 * Owner: Vatsal Bhardwaj
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

// ─── Enums ───────────────────────────────────────────────────────────────────

export const credentialStatusEnum = pgEnum("credential_status", [
  "VERIFIED",
  "EXPIRED",
  "REVOKED",
  "INVALID",
]);

export const investigatorRoleEnum = pgEnum("investigator_role", [
  "CYBER_CELL_OFFICER",
  "FINANCIAL_INTELLIGENCE_ANALYST",
  "NODAL_OFFICER",
  "SUPERVISING_OFFICER",
  "BANK_COMPLIANCE_OFFICER",
  "SYSTEM_ADMIN",
]);

export const accessPurposeEnum = pgEnum("access_purpose", [
  "CASE_INVESTIGATION",
  "IDENTITY_RESOLUTION",
  "EVIDENCE_REVIEW",
  "INTERVENTION_ACTION",
  "INTELLIGENCE_EXPORT",
  "AUDIT_REVIEW",
  "SYSTEM_ADMINISTRATION",
]);

export const capabilityEnum = pgEnum("capability", [
  "IDENTITY_RESOLUTION",
  "BANK_ACCOUNT_DETAIL",
  "EVIDENCE_ACCESS",
  "INTERVENTION_CONTROL",
  "INTELLIGENCE_EXPORT",
]);

// ─── Issuers ─────────────────────────────────────────────────────────────────

/** Trusted credential issuers (e.g., authorized government agencies) */
export const issuers = pgTable("issuers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  /** Public key for verifying credentials from this issuer */
  publicKey: text("public_key").notNull(),
  active: boolean("active").notNull().default(true),
  registeredAt: timestamp("registered_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Credentials ─────────────────────────────────────────────────────────────

/** PrivacyPass-style credentials issued to investigators */
export const credentials = pgTable("credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  issuerRef: uuid("issuer_ref")
    .notNull()
    .references(() => issuers.id),
  /** Subject (investigator user ID) */
  subjectId: uuid("subject_id").notNull(),
  role: investigatorRoleEnum("role").notNull(),
  purpose: accessPurposeEnum("purpose").notNull(),
  validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  status: credentialStatusEnum("status").notNull().default("VERIFIED"),
  /** SHA-256 hash of the associated public key */
  publicKeyHash: varchar("public_key_hash", { length: 128 }).notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Credential Revocations ──────────────────────────────────────────────────

/** Records of credential revocations with reason */
export const credentialRevocations = pgTable("credential_revocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  credentialId: uuid("credential_id")
    .notNull()
    .references(() => credentials.id),
  reason: text("reason").notNull(),
  revokedBy: varchar("revoked_by", { length: 255 }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** On-chain reference for the revocation anchor */
  blockchainRef: varchar("blockchain_ref", { length: 255 }),
});

// ─── Verification Sessions ──────────────────────────────────────────────────

/** Active challenge-response verification sessions */
export const verificationSessions = pgTable("verification_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  investigatorId: uuid("investigator_id").notNull(),
  /** The nonce issued for this session */
  nonce: varchar("nonce", { length: 128 }).notNull().unique(),
  issuedAt: timestamp("issued_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  /** Whether this nonce has been consumed */
  consumed: boolean("consumed").notNull().default(false),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

// ─── Nonces ──────────────────────────────────────────────────────────────────

/** Nonce tracking for replay protection */
export const nonces = pgTable("nonces", {
  id: uuid("id").primaryKey().defaultRandom(),
  value: varchar("value", { length: 128 }).notNull().unique(),
  investigatorId: uuid("investigator_id").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumed: boolean("consumed").notNull().default(false),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

// ─── Scoped Permissions ──────────────────────────────────────────────────────

/** Maps role + purpose to permitted capabilities */
export const scopedPermissions = pgTable("scoped_permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  role: investigatorRoleEnum("role").notNull(),
  purpose: accessPurposeEnum("purpose").notNull(),
  capability: capabilityEnum("capability").notNull(),
  /** Whether this permission mapping is currently active */
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
