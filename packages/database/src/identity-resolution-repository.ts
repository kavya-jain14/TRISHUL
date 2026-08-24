import type { Pool } from 'pg';
import type { IdentityResolutionRequest, IdentityResolutionStatus } from '@trishul/contracts';

export interface IdentityResolutionRepository {
  createRequest(request: IdentityResolutionRequest): Promise<void>;
  getRequest(requestId: string): Promise<IdentityResolutionRequest | null>;
  updateRequestStatus(
    requestId: string,
    status: IdentityResolutionStatus,
    supervisorId?: string,
    providerReference?: string,
    resolvedAt?: string
  ): Promise<boolean>;
}

export class PostgresIdentityResolutionRepository implements IdentityResolutionRepository {
  constructor(private readonly pool: Pool) {}

  async createRequest(request: IdentityResolutionRequest): Promise<void> {
    await this.pool.query(
      `INSERT INTO trust_identity_resolution_requests 
        (request_id, case_id, investigator_id, status, supervisor_id, provider_reference, requested_at, resolved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        request.requestId,
        request.caseId,
        request.investigatorId,
        request.status,
        request.supervisorId ?? null,
        request.providerReference ?? null,
        request.requestedAt,
        request.resolvedAt ?? null,
      ]
    );
  }

  async getRequest(requestId: string): Promise<IdentityResolutionRequest | null> {
    const result = await this.pool.query(
      `SELECT request_id, case_id, investigator_id, status, supervisor_id, provider_reference, requested_at, resolved_at
       FROM trust_identity_resolution_requests
       WHERE request_id = $1`,
      [requestId]
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      requestId: row.request_id,
      caseId: row.case_id,
      investigatorId: row.investigator_id,
      status: row.status as IdentityResolutionStatus,
      supervisorId: row.supervisor_id ?? undefined,
      providerReference: row.provider_reference ?? undefined,
      requestedAt: row.requested_at.toISOString(),
      resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : undefined,
    };
  }

  async updateRequestStatus(
    requestId: string,
    status: IdentityResolutionStatus,
    supervisorId?: string,
    providerReference?: string,
    resolvedAt?: string
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE trust_identity_resolution_requests
       SET status = $2, supervisor_id = COALESCE($3, supervisor_id), provider_reference = COALESCE($4, provider_reference), resolved_at = COALESCE($5, resolved_at)
       WHERE request_id = $1`,
      [requestId, status, supervisorId ?? null, providerReference ?? null, resolvedAt ?? null]
    );
    return result.rowCount !== null && result.rowCount > 0;
  }
}
