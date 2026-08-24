/**
 * @trishul/database
 *
 * PostgreSQL schema definitions using Drizzle ORM.
 * Code-first schema — migrations are generated via `pnpm db:generate`.
 *
 * Trust / Access / Audit schema — Vatsal Bhardwaj
 * Other team members add their own schema files in src/schema/
 */

export * from "./schema/trust.js";
export * from "./schema/identity-resolution.js";
export * from "./schema/audit.js";
export * from "./schema/blockchain.js";
