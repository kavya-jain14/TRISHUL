import { isDeepStrictEqual } from "node:util";
import type { Pool } from "pg";
import { alertJobPayloadSchema, type AlertJobPayload } from "../../contracts/src/case.ts";

export type PersistedAlert = AlertJobPayload & { acknowledgedAt: string | null };

type AlertRow = {
  alertId: string;
  caseId: string;
  severity: AlertJobPayload["severity"];
  kind: AlertJobPayload["kind"];
  title: string;
  message: string;
  sourceEventId: string | null;
  sourceUrls: unknown;
  createdAt: string | Date;
  acknowledgedAt: string | Date | null;
};

function mapAlert(row: AlertRow): PersistedAlert {
  const parsed = alertJobPayloadSchema.parse({
    alertId: row.alertId,
    caseId: row.caseId,
    severity: row.severity,
    kind: row.kind,
    title: row.title,
    message: row.message,
    ...(row.sourceEventId === null ? {} : { sourceEventId: row.sourceEventId }),
    sourceUrls: row.sourceUrls,
    createdAt: new Date(row.createdAt).toISOString()
  });
  return { ...parsed, acknowledgedAt: row.acknowledgedAt === null ? null : new Date(row.acknowledgedAt).toISOString() };
}

const SELECT_ALERT = `SELECT alert_id AS "alertId", case_id AS "caseId", severity, kind, title, message,
  source_event_id AS "sourceEventId", source_urls AS "sourceUrls", created_at AS "createdAt",
  acknowledged_at AS "acknowledgedAt" FROM alerts`;

export class PostgresAlertRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async persist(rawAlert: unknown): Promise<{ status: "CREATED" | "IDEMPOTENT_REPLAY"; alert: PersistedAlert }> {
    const alert = alertJobPayloadSchema.parse(rawAlert);
    const result = await this.#pool.query<AlertRow>(
      `INSERT INTO alerts
        (alert_id, case_id, severity, kind, title, message, source_event_id, source_urls, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
       ON CONFLICT (alert_id) DO NOTHING
       RETURNING alert_id AS "alertId", case_id AS "caseId", severity, kind, title, message,
         source_event_id AS "sourceEventId", source_urls AS "sourceUrls", created_at AS "createdAt",
         acknowledged_at AS "acknowledgedAt"`,
      [alert.alertId, alert.caseId, alert.severity, alert.kind, alert.title, alert.message,
        alert.sourceEventId ?? null, JSON.stringify(alert.sourceUrls), alert.createdAt]
    );
    const inserted = result.rows[0];
    if (inserted !== undefined) return { status: "CREATED", alert: mapAlert(inserted) };

    const existingResult = await this.#pool.query<AlertRow>(`${SELECT_ALERT} WHERE alert_id = $1`, [alert.alertId]);
    const existing = existingResult.rows[0];
    if (existing === undefined) throw new Error(`Alert ${alert.alertId} could not be read after conflict.`);
    const persisted = mapAlert(existing);
    const { acknowledgedAt: _acknowledgedAt, ...persistedPayload } = persisted;
    if (!isDeepStrictEqual(persistedPayload, alert)) throw new Error(`Alert ID ${alert.alertId} was reused with different content.`);
    return { status: "IDEMPOTENT_REPLAY", alert: persisted };
  }

  async acknowledge(alertId: string, acknowledgedAt: string): Promise<PersistedAlert> {
    const result = await this.#pool.query<AlertRow>(
      `UPDATE alerts SET acknowledged_at = COALESCE(acknowledged_at, $2)
       WHERE alert_id = $1
       RETURNING alert_id AS "alertId", case_id AS "caseId", severity, kind, title, message,
         source_event_id AS "sourceEventId", source_urls AS "sourceUrls", created_at AS "createdAt",
         acknowledged_at AS "acknowledgedAt"`,
      [alertId, acknowledgedAt]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`Alert ${alertId} was not found.`);
    return mapAlert(row);
  }

  async listForCase(caseId: string, limit = 100): Promise<readonly PersistedAlert[]> {
    const result = await this.#pool.query<AlertRow>(
      `${SELECT_ALERT} WHERE case_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [caseId, limit]
    );
    return result.rows.map(mapAlert);
  }
}
