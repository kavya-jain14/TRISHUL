import { isDeepStrictEqual } from 'node:util';
import { AlertJobPayloadSchema, type AlertJobPayload } from '@trishul/contracts';
import type { Pool } from 'pg';

export interface PersistedAlert extends AlertJobPayload {
  acknowledgedAt: string | null;
}

interface AlertRow {
  alertId: string;
  caseId: string;
  severity: AlertJobPayload['severity'];
  kind: AlertJobPayload['kind'];
  title: string;
  message: string;
  sourceEventId: string | null;
  sourceUrls: unknown;
  createdAt: Date | string;
  acknowledgedAt: Date | string | null;
}

const ALERT_COLUMNS = `alerts.alert_id AS "alertId", cases.external_case_id AS "caseId",
  alerts.severity, alerts.kind, alerts.title, alerts.message,
  alerts.source_event_id AS "sourceEventId", alerts.source_urls AS "sourceUrls",
  alerts.created_at AS "createdAt", alerts.acknowledged_at AS "acknowledgedAt"`;

export class PostgresAlertRepository {
  constructor(private readonly pool: Pool) {}

  async persist(rawAlert: unknown): Promise<{
    status: 'CREATED' | 'IDEMPOTENT_REPLAY';
    alert: PersistedAlert;
  }> {
    const alert = AlertJobPayloadSchema.parse(rawAlert);
    const inserted = await this.pool.query<AlertRow>(
      `INSERT INTO alerts
        (alert_id, case_id, severity, kind, title, message, source_event_id, source_urls, created_at)
       SELECT $1, cases.id, $3, $4, $5, $6, $7, $8::jsonb, $9
       FROM cases WHERE cases.external_case_id = $2
       ON CONFLICT (alert_id) DO NOTHING
       RETURNING alert_id AS "alertId", $2::text AS "caseId", severity, kind, title, message,
         source_event_id AS "sourceEventId", source_urls AS "sourceUrls",
         created_at AS "createdAt", acknowledged_at AS "acknowledgedAt"`,
      [
        alert.alertId,
        alert.caseId,
        alert.severity,
        alert.kind,
        alert.title,
        alert.message,
        alert.sourceEventId ?? null,
        JSON.stringify(alert.sourceUrls),
        alert.createdAt,
      ],
    );
    const created = inserted.rows[0];
    if (created) return { status: 'CREATED', alert: mapAlert(created) };

    const existing = await this.find(alert.alertId);
    if (!existing) {
      throw new Error(
        `Case ${alert.caseId} was not found while persisting alert ${alert.alertId}.`,
      );
    }
    const { acknowledgedAt: _acknowledgedAt, ...existingPayload } = existing;
    if (!isDeepStrictEqual(existingPayload, alert)) {
      throw new Error(`Alert ID ${alert.alertId} was reused with different content.`);
    }
    return { status: 'IDEMPOTENT_REPLAY', alert: existing };
  }

  async acknowledge(alertId: string, acknowledgedAt: string): Promise<PersistedAlert> {
    const result = await this.pool.query<AlertRow>(
      `UPDATE alerts SET acknowledged_at = COALESCE(acknowledged_at, $2)
       FROM cases
       WHERE alerts.alert_id = $1 AND cases.id = alerts.case_id
       RETURNING ${ALERT_COLUMNS}`,
      [alertId, acknowledgedAt],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Alert ${alertId} was not found.`);
    return mapAlert(row);
  }

  async listForCase(caseId: string, limit = 100): Promise<readonly PersistedAlert[]> {
    const result = await this.pool.query<AlertRow>(
      `SELECT ${ALERT_COLUMNS} FROM alerts
       JOIN cases ON cases.id = alerts.case_id
       WHERE cases.external_case_id = $1 ORDER BY alerts.created_at DESC LIMIT $2`,
      [caseId, limit],
    );
    return result.rows.map(mapAlert);
  }

  private async find(alertId: string): Promise<PersistedAlert | null> {
    const result = await this.pool.query<AlertRow>(
      `SELECT ${ALERT_COLUMNS} FROM alerts
       JOIN cases ON cases.id = alerts.case_id WHERE alerts.alert_id = $1`,
      [alertId],
    );
    const row = result.rows[0];
    return row ? mapAlert(row) : null;
  }
}

function mapAlert(row: AlertRow): PersistedAlert {
  const alert = AlertJobPayloadSchema.parse({
    alertId: row.alertId,
    caseId: row.caseId,
    severity: row.severity,
    kind: row.kind,
    title: row.title,
    message: row.message,
    ...(row.sourceEventId ? { sourceEventId: row.sourceEventId } : {}),
    sourceUrls: row.sourceUrls,
    createdAt: iso(row.createdAt),
  });
  return {
    ...alert,
    acknowledgedAt: row.acknowledgedAt ? iso(row.acknowledgedAt) : null,
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
