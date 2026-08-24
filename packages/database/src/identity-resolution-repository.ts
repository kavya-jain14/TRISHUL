import type { Pool } from 'pg';
import {
  IdentityResolutionRequestSchema,
  type IdentityResolutionRequest,
} from '@trishul/contracts';

export interface IdentityResolutionRepository {
  createRequest(request: IdentityResolutionRequest): Promise<void>;
  getRequest(requestId: string): Promise<IdentityResolutionRequest | null>;
  decideRequest(
    requestId: string,
    caseId: string,
    status: 'APPROVED' | 'REJECTED',
    decidedBy: string,
    decisionJustification: string,
    providerReference: string | undefined,
    resolvedAt: string,
  ): Promise<boolean>;
}

export class PostgresIdentityResolutionRepository implements IdentityResolutionRepository {
  constructor(private readonly pool: Pool) {}

  async createRequest(request: IdentityResolutionRequest): Promise<void> {
    await this.pool.query(
      `INSERT INTO trust_identity_resolution_requests 
        (request_id, case_id, investigator_id, request_justification, status, decided_by,
         decision_justification, provider_reference, requested_at, resolved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        request.requestId,
        request.caseId,
        request.investigatorId,
        request.requestJustification,
        request.status,
        request.decidedBy ?? null,
        request.decisionJustification ?? null,
        request.providerReference ?? null,
        request.requestedAt,
        request.resolvedAt ?? null,
      ],
    );
  }

  async getRequest(requestId: string): Promise<IdentityResolutionRequest | null> {
    const result = await this.pool.query(
      `SELECT request_id, case_id, investigator_id, request_justification, status, decided_by,
              decision_justification, provider_reference, requested_at, resolved_at
       FROM trust_identity_resolution_requests
       WHERE request_id = $1`,
      [requestId],
    );

    const row = result.rows[0];
    if (!row) return null;

    return IdentityResolutionRequestSchema.parse({
      requestId: row.request_id,
      caseId: row.case_id,
      investigatorId: row.investigator_id,
      requestJustification: row.request_justification,
      status: row.status,
      decidedBy: row.decided_by ?? undefined,
      decisionJustification: row.decision_justification ?? undefined,
      providerReference: row.provider_reference ?? undefined,
      requestedAt: row.requested_at.toISOString(),
      resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : undefined,
    });
  }

  async decideRequest(
    requestId: string,
    caseId: string,
    status: 'APPROVED' | 'REJECTED',
    decidedBy: string,
    decisionJustification: string,
    providerReference: string | undefined,
    resolvedAt: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE trust_identity_resolution_requests
       SET status = $3, decided_by = $4, decision_justification = $5,
           provider_reference = $6, resolved_at = $7
       WHERE request_id = $1 AND case_id = $2 AND status = 'PENDING'`,
      [
        requestId,
        caseId,
        status,
        decidedBy,
        decisionJustification,
        providerReference ?? null,
        resolvedAt,
      ],
    );
    return result.rowCount !== null && result.rowCount > 0;
  }
}
