export const CORE_SCHEMA_VERSION = 10 as const;

export const DATABASE_ASSETS = {
  migrations: [
    new URL('../migrations/001_core.sql', import.meta.url),
    new URL('../migrations/002_evidence_anchor_receipts.sql', import.meta.url),
    new URL('../migrations/003_phase4_forecast_snapshots.sql', import.meta.url),
    new URL('../migrations/004_durable_outbox.sql', import.meta.url),
    new URL('../migrations/005_case_actions.sql', import.meta.url),
    new URL('../migrations/006_trust_persistence.sql', import.meta.url),
    new URL('../migrations/007_payment_risk_assessments.sql', import.meta.url),
    new URL('../migrations/008_cross_case_network_memory.sql', import.meta.url),
    new URL('../migrations/009_trust_command_center_scope.sql', import.meta.url),
    new URL('../migrations/010_command_center.sql', import.meta.url),
  ],
  developmentSeeds: [new URL('../seeds/001_golden_lab.sql', import.meta.url)],
} as const;

export * from './alerts.js';
export * from './case-actions.js';
export * from './outbox.js';
export * from './trust-repository.js';
export * from './identity-resolution-repository.js';
export * from './payment-risk.js';
export * from './network-memory.js';
export * from './command-center.js';
