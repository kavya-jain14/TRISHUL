export const CORE_SCHEMA_VERSION = 4 as const;

export const DATABASE_ASSETS = {
  migrations: [
    new URL('../migrations/001_core.sql', import.meta.url),
    new URL('../migrations/002_evidence_anchor_receipts.sql', import.meta.url),
    new URL('../migrations/003_phase4_forecast_snapshots.sql', import.meta.url),
    new URL('../migrations/004_durable_outbox.sql', import.meta.url),
    new URL('../migrations/005_trust_persistence.sql', import.meta.url),
  ],
  developmentSeeds: [
    new URL('../seeds/001_golden_lab.sql', import.meta.url),
    new URL('../seeds/002_trust_demo.sql', import.meta.url)
  ],
} as const;

export * from './alerts.js';
export * from './outbox.js';
export * from './trust-repository.js';
export * from './identity-resolution-repository.js';
