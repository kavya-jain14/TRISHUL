import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { DATABASE_ASSETS } from './index.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to run TRISHUL migrations');
}

const pool = new Pool({ connectionString });

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const migrationUrl of DATABASE_ASSETS.migrations) {
    const name = migrationUrl.pathname.split('/').at(-1) ?? '';
    const version = Number.parseInt(name.split('_')[0] ?? '', 10);
    if (!Number.isSafeInteger(version)) {
      throw new Error(`Migration filename must start with an integer version: ${name}`);
    }

    const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE version = $1', [
      version,
    ]);
    if (applied.rowCount && applied.rowCount > 0) continue;

    const sql = await readFile(migrationUrl, 'utf8');
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [
      version,
      name,
    ]);
    process.stdout.write(`Applied migration ${name}\n`);
  }
} finally {
  await pool.end();
}
