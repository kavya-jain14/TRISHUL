export const CORE_SCHEMA_VERSION = 2 as const;

export const DATABASE_ASSETS = {
  migrations: [
    new URL('../migrations/001_core.sql', import.meta.url),
    new URL('../migrations/002_evidence_anchor_receipts.sql', import.meta.url),
  ],
  developmentSeeds: [new URL('../seeds/001_golden_lab.sql', import.meta.url)],
} as const;
