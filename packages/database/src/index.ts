export const CORE_SCHEMA_VERSION = 1 as const;

export const DATABASE_ASSETS = {
  migrations: [new URL('../migrations/001_core.sql', import.meta.url)],
  developmentSeeds: [new URL('../seeds/001_golden_lab.sql', import.meta.url)],
} as const;
