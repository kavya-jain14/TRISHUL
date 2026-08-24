import { hashEvidence } from '@trishul/audit';
import {
  CaseSummarySchema,
  ComplaintSubmissionSchema,
  ExposureSnapshotSchema,
  GraphSnapshotSchema,
  MuleAssessmentSnapshotSchema,
  ProviderEventSchema,
  type ExposureSnapshot,
  type MuleAssessmentSnapshot,
  type ProviderEvent,
} from '@trishul/contracts';
import type { Pool, PoolClient } from 'pg';
import { ConflictError } from '../../domain/errors.js';
import type { CaseRecord, CaseRepository, IdempotencyRecord } from './case-repository.js';

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function jsonValue<T>(value: T | string): T {
  return typeof value === 'string' ? (JSON.parse(value) as T) : value;
}

async function accountId(client: PoolClient, providerName: string, accountRef: string) {
  const result = await client.query<{ id: string }>(
    `INSERT INTO accounts (provider_account_ref, provider_name)
     VALUES ($1, $2)
     ON CONFLICT (provider_name, provider_account_ref)
     DO UPDATE SET provider_account_ref = EXCLUDED.provider_account_ref
     RETURNING id`,
    [accountRef, providerName],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`Could not resolve database account ${accountRef}`);
  return id;
}

export class PostgresCaseRepository implements CaseRepository {
  constructor(private readonly pool: Pool) {}

  async getCase(caseId: string): Promise<CaseRecord | null> {
    const caseResult = await this.pool.query<{
      internal_case_id: string;
      external_case_id: string;
      state: string;
      original_transaction_ref: string;
      graph_version: number;
      case_created_at: Date | string;
      case_updated_at: Date | string;
      external_complaint_id: string;
      source: string;
      category: string;
      reported_amount_minor: string | number;
      currency: 'INR';
      payer_reference: string | null;
      beneficiary_reference: string | null;
      transaction_occurred_at: Date | string;
      reported_at: Date | string;
      evidence_references: unknown;
    }>(
      `SELECT
         c.id AS internal_case_id,
         c.external_case_id,
         c.state,
         c.original_transaction_ref,
         c.graph_version,
         c.created_at AS case_created_at,
         c.updated_at AS case_updated_at,
         cp.external_complaint_id,
         cp.source,
         cp.category,
         cp.reported_amount_minor,
         cp.currency,
         cp.payer_reference,
         cp.beneficiary_reference,
         cp.transaction_occurred_at,
         cp.reported_at,
         cp.evidence_references
       FROM cases c
       JOIN complaints cp ON cp.case_id = c.id
       WHERE c.external_case_id = $1`,
      [caseId],
    );
    const row = caseResult.rows[0];
    if (!row) return null;

    const eventResult = await this.pool.query<{
      provider_event_id: string;
      payload: unknown;
      processed_at: Date | string | null;
    }>(
      `SELECT provider_event_id, payload, processed_at
       FROM transaction_events
       WHERE case_id = $1
       ORDER BY occurred_at, provider_event_id`,
      [row.internal_case_id],
    );
    const providerEvents = eventResult.rows.map((eventRow) =>
      ProviderEventSchema.parse(jsonValue(eventRow.payload)),
    );
    const processedEventIds = eventResult.rows
      .filter((eventRow) => eventRow.processed_at !== null)
      .map((eventRow) => eventRow.provider_event_id);

    const graphResult = await this.pool.query<{ snapshot: unknown }>(
      `SELECT snapshot
       FROM graph_versions
       WHERE case_id = $1
       ORDER BY version`,
      [row.internal_case_id],
    );
    const graphVersions = graphResult.rows.map((graphRow) =>
      GraphSnapshotSchema.parse(jsonValue(graphRow.snapshot)),
    );
    const exposureResult = await this.pool.query<{
      exposure_state_ref: string;
      snapshot_ref: string;
      graph_version: number;
      account_ref: string;
      observed_outgoing_minor: string | number;
      minimum_fraud_linked_balance_minor: string | number;
      fraud_linked_balance_minor: string | number;
      known_clean_balance_minor: string | number;
      non_fraud_compatible_inflow_minor: string | number;
      minimum_attributable_minor: string | number;
      maximum_attributable_minor: string | number;
      currency: 'INR';
      method_version: string;
      calculation_input_hash: string;
      balance_provenance: unknown;
      calculated_at: Date | string;
    }>(
      `SELECT
         es.exposure_state_ref,
         es.snapshot_ref,
         es.graph_version,
         a.provider_account_ref AS account_ref,
         es.observed_outgoing_minor,
         es.minimum_fraud_linked_balance_minor,
         es.fraud_linked_balance_minor,
         es.known_clean_balance_minor,
         es.non_fraud_compatible_inflow_minor,
         es.minimum_attributable_minor,
         es.maximum_attributable_minor,
         es.currency,
         es.method_version,
         es.calculation_input_hash,
         es.balance_provenance,
         es.calculated_at
       FROM exposure_states es
       JOIN accounts a ON a.id = es.account_id
       WHERE es.case_id = $1
       ORDER BY es.graph_version, a.provider_account_ref`,
      [row.internal_case_id],
    );
    const exposureGroups = new Map<string, ExposureSnapshot>();
    for (const exposureRow of exposureResult.rows) {
      const key = `${exposureRow.snapshot_ref}:${exposureRow.graph_version}`;
      const state = {
        exposureStateId: exposureRow.exposure_state_ref,
        caseId: row.external_case_id,
        graphVersion: exposureRow.graph_version,
        accountId: exposureRow.account_ref,
        observedOutgoingMinor: Number(exposureRow.observed_outgoing_minor),
        minimumFraudLinkedBalanceMinor: Number(exposureRow.minimum_fraud_linked_balance_minor),
        fraudLinkedBalanceMinor: Number(exposureRow.fraud_linked_balance_minor),
        knownCleanBalanceMinor: Number(exposureRow.known_clean_balance_minor),
        nonFraudCompatibleInflowMinor: Number(exposureRow.non_fraud_compatible_inflow_minor),
        minimumAttributableMinor: Number(exposureRow.minimum_attributable_minor),
        maximumAttributableMinor: Number(exposureRow.maximum_attributable_minor),
        currency: exposureRow.currency,
        methodVersion: exposureRow.method_version,
        calculationInputHash: exposureRow.calculation_input_hash,
        balanceProvenance: jsonValue(exposureRow.balance_provenance),
        calculatedAt: iso(exposureRow.calculated_at),
      };
      const existing = exposureGroups.get(key);
      exposureGroups.set(
        key,
        ExposureSnapshotSchema.parse({
          snapshotId: exposureRow.snapshot_ref,
          caseId: row.external_case_id,
          graphVersion: exposureRow.graph_version,
          calculationInputHash: exposureRow.calculation_input_hash,
          calculatedAt: iso(exposureRow.calculated_at),
          states: [...(existing?.states ?? []), state],
        }),
      );
    }
    const exposureSnapshots = [...exposureGroups.values()].sort(
      (left, right) => left.graphVersion - right.graphVersion,
    );

    const assessmentResult = await this.pool.query<{
      assessment_ref: string;
      graph_version: number;
      account_ref: string;
      state: string;
      score: string | number;
      reason_codes: unknown;
      features: unknown;
      feature_version: string;
      rule_version: string;
      calculation_input_hash: string;
      signal_provenance: unknown;
      trusted_outcome: unknown;
      assessed_at: Date | string;
    }>(
      `SELECT
         ma.assessment_ref,
         ma.graph_version,
         a.provider_account_ref AS account_ref,
         ma.state,
         ma.score,
         ma.reason_codes,
         ma.features,
         ma.feature_version,
         ma.rule_version,
         ma.calculation_input_hash,
         ma.signal_provenance,
         ma.trusted_outcome,
         ma.assessed_at
       FROM mule_assessments ma
       JOIN accounts a ON a.id = ma.account_id
       WHERE ma.case_id = $1
       ORDER BY ma.graph_version, a.provider_account_ref`,
      [row.internal_case_id],
    );
    const muleAssessments = assessmentResult.rows.map((assessmentRow) =>
      MuleAssessmentSnapshotSchema.parse({
        assessmentId: assessmentRow.assessment_ref,
        caseId: row.external_case_id,
        accountId: assessmentRow.account_ref,
        graphVersion: assessmentRow.graph_version,
        state: assessmentRow.state,
        score: Number(assessmentRow.score),
        reasonCodes: jsonValue(assessmentRow.reason_codes),
        features: jsonValue(assessmentRow.features),
        featureVersion: assessmentRow.feature_version,
        ruleVersion: assessmentRow.rule_version,
        calculationInputHash: assessmentRow.calculation_input_hash,
        signalProvenance: jsonValue(assessmentRow.signal_provenance),
        trustedOutcome: jsonValue(assessmentRow.trusted_outcome),
        assessedAt: iso(assessmentRow.assessed_at),
      }),
    );
    const resolution = providerEvents.find((event) => event.type === 'RESOLVE_TRANSACTION');

    return {
      summary: CaseSummarySchema.parse({
        caseId: row.external_case_id,
        complaintId: row.external_complaint_id,
        state: row.state,
        originalTransactionRef: row.original_transaction_ref,
        graphVersion: row.graph_version,
        createdAt: iso(row.case_created_at),
        updatedAt: iso(row.case_updated_at),
      }),
      complaint: ComplaintSubmissionSchema.parse({
        complaintId: row.external_complaint_id,
        originalTransactionRef: row.original_transaction_ref,
        reportedAmount: {
          amountMinor: Number(row.reported_amount_minor),
          currency: row.currency,
        },
        transactionOccurredAt: iso(row.transaction_occurred_at),
        reportedAt: iso(row.reported_at),
        category: row.category,
        source: row.source,
        evidenceReferences: jsonValue(row.evidence_references),
        ...(row.payer_reference ? { payerReference: row.payer_reference } : {}),
        ...(row.beneficiary_reference ? { beneficiaryReference: row.beneficiary_reference } : {}),
      }),
      resolvedBeneficiaryAccount:
        resolution?.type === 'RESOLVE_TRANSACTION' ? resolution.beneficiaryAccount : null,
      providerEvents,
      providerEventHashes: Object.fromEntries(
        providerEvents.map((event) => [event.eventId, hashEvidence(event)]),
      ),
      processedEventIds,
      graphVersions,
      exposureSnapshots,
      muleAssessments,
    };
  }

  async findCaseByComplaintId(complaintId: string): Promise<CaseRecord | null> {
    const result = await this.pool.query<{ external_case_id: string }>(
      `SELECT c.external_case_id
       FROM complaints cp
       JOIN cases c ON c.id = cp.case_id
       WHERE cp.external_complaint_id = $1`,
      [complaintId],
    );
    const caseId = result.rows[0]?.external_case_id;
    return caseId ? this.getCase(caseId) : null;
  }

  async saveCase(record: CaseRecord): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const caseResult = await client.query<{ id: string }>(
        `INSERT INTO cases (
           external_case_id, state, original_transaction_ref, graph_version, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (external_case_id) DO UPDATE SET
           state = EXCLUDED.state,
           graph_version = EXCLUDED.graph_version,
           updated_at = EXCLUDED.updated_at
         RETURNING id`,
        [
          record.summary.caseId,
          record.summary.state,
          record.summary.originalTransactionRef,
          record.summary.graphVersion,
          record.summary.createdAt,
          record.summary.updatedAt,
        ],
      );
      const internalCaseId = caseResult.rows[0]?.id;
      if (!internalCaseId) throw new Error('Could not persist case');

      await client.query(
        `INSERT INTO complaints (
           external_complaint_id, case_id, source, category, reported_amount_minor, currency,
           payer_reference, beneficiary_reference, transaction_occurred_at, reported_at,
           evidence_references
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
         ON CONFLICT (external_complaint_id) DO NOTHING`,
        [
          record.complaint.complaintId,
          internalCaseId,
          record.complaint.source,
          record.complaint.category,
          record.complaint.reportedAmount.amountMinor,
          record.complaint.reportedAmount.currency,
          record.complaint.payerReference ?? null,
          record.complaint.beneficiaryReference ?? null,
          record.complaint.transactionOccurredAt,
          record.complaint.reportedAt,
          JSON.stringify(record.complaint.evidenceReferences),
        ],
      );

      const processed = new Set(record.processedEventIds);
      for (const event of record.providerEvents) {
        const eventResult = await client.query<{ provider_event_id: string }>(
          `INSERT INTO transaction_events (
             provider_event_id, case_id, event_type, occurred_at, event_hash, payload, provenance,
             processed_at
           ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
           ON CONFLICT (provider_event_id) DO UPDATE SET
             processed_at = COALESCE(transaction_events.processed_at, EXCLUDED.processed_at)
           WHERE transaction_events.event_hash = EXCLUDED.event_hash
           RETURNING provider_event_id`,
          [
            event.eventId,
            internalCaseId,
            event.type,
            event.occurredAt,
            hashEvidence(event),
            JSON.stringify(event),
            JSON.stringify(event.provenance),
            processed.has(event.eventId) ? record.summary.updatedAt : null,
          ],
        );
        if (eventResult.rows.length === 0) {
          throw new ConflictError(
            'PROVIDER_EVENT_CONFLICT',
            `Provider event ${event.eventId} already exists with different content`,
          );
        }

        if (event.type === 'TRANSFER') {
          const fromAccount = await accountId(
            client,
            event.provenance.sourceName,
            event.fromAccount,
          );
          const toAccount = await accountId(client, event.provenance.sourceName, event.toAccount);
          await client.query(
            `INSERT INTO payment_transactions (
               case_id, transaction_ref, provider_ref, from_account_id, to_account_id,
               amount_minor, currency, occurred_at, provenance
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
             ON CONFLICT (provider_ref, transaction_ref) DO NOTHING`,
            [
              internalCaseId,
              event.transactionId,
              event.providerRef,
              fromAccount,
              toAccount,
              event.amount.amountMinor,
              event.amount.currency,
              event.occurredAt,
              JSON.stringify(event.provenance),
            ],
          );
        }
      }

      for (const graph of record.graphVersions) {
        await client.query(
          `INSERT INTO graph_versions (
             case_id, version, source_event_id, coverage_boundary, snapshot, created_at
           ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
           ON CONFLICT (case_id, version) DO NOTHING`,
          [
            internalCaseId,
            graph.graphVersion,
            record.processedEventIds.at(-1) ?? 'resolution-only',
            graph.coverageBoundary ?? 'Coverage boundary unavailable',
            JSON.stringify(graph),
            graph.generatedAt,
          ],
        );

        const nodeIds = new Map<string, string>();
        for (const node of graph.nodes) {
          const nodeResult = await client.query<{ id: string }>(
            `INSERT INTO graph_nodes (
               case_id, node_ref, node_type, label, first_graph_version, first_observed_at
             ) VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (case_id, node_ref) DO UPDATE SET
               first_graph_version = CASE
                 WHEN graph_nodes.first_graph_version <= EXCLUDED.first_graph_version
                 THEN graph_nodes.first_graph_version ELSE EXCLUDED.first_graph_version END,
               first_observed_at = CASE
                 WHEN graph_nodes.first_observed_at <= EXCLUDED.first_observed_at
                 THEN graph_nodes.first_observed_at ELSE EXCLUDED.first_observed_at END
             RETURNING id`,
            [
              internalCaseId,
              node.nodeId,
              node.type,
              node.label,
              graph.graphVersion,
              node.firstObservedAt,
            ],
          );
          const id = nodeResult.rows[0]?.id;
          if (!id) throw new Error(`Could not persist graph node ${node.nodeId}`);
          nodeIds.set(node.nodeId, id);
        }

        for (const edge of graph.edges) {
          await client.query(
            `INSERT INTO graph_edges (
               case_id, graph_version, edge_ref, from_node_id, to_node_id, edge_type,
               amount_minor, currency, occurred_at, provenance
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
             ON CONFLICT (case_id, edge_ref) DO NOTHING`,
            [
              internalCaseId,
              graph.graphVersion,
              edge.edgeId,
              nodeIds.get(edge.fromNodeId),
              nodeIds.get(edge.toNodeId),
              edge.type,
              edge.amount?.amountMinor ?? null,
              edge.amount?.currency ?? null,
              edge.occurredAt,
              JSON.stringify(edge.provenance),
            ],
          );
        }
      }

      for (const snapshot of record.exposureSnapshots) {
        for (const state of snapshot.states) {
          const stateAccountId = await accountId(
            client,
            state.balanceProvenance.sourceName,
            state.accountId,
          );
          const result = await client.query<{ exposure_state_ref: string }>(
            `INSERT INTO exposure_states (
               exposure_state_ref, snapshot_ref, case_id, graph_version, account_id,
               observed_outgoing_minor, minimum_fraud_linked_balance_minor,
               fraud_linked_balance_minor, known_clean_balance_minor,
               non_fraud_compatible_inflow_minor, minimum_attributable_minor,
               maximum_attributable_minor, currency, method_version, calculation_input_hash,
               balance_provenance, calculated_at
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               $15, $16::jsonb, $17
             )
             ON CONFLICT (case_id, graph_version, account_id) DO UPDATE SET
               calculated_at = exposure_states.calculated_at
             WHERE exposure_states.calculation_input_hash = EXCLUDED.calculation_input_hash
             RETURNING exposure_state_ref`,
            [
              state.exposureStateId,
              snapshot.snapshotId,
              internalCaseId,
              state.graphVersion,
              stateAccountId,
              state.observedOutgoingMinor,
              state.minimumFraudLinkedBalanceMinor,
              state.fraudLinkedBalanceMinor,
              state.knownCleanBalanceMinor,
              state.nonFraudCompatibleInflowMinor,
              state.minimumAttributableMinor,
              state.maximumAttributableMinor,
              state.currency,
              state.methodVersion,
              state.calculationInputHash,
              JSON.stringify(state.balanceProvenance),
              state.calculatedAt,
            ],
          );
          if (result.rows.length === 0) {
            throw new ConflictError(
              'EXPOSURE_VERSION_IMMUTABLE',
              `Exposure for ${state.accountId} and graph version ${state.graphVersion} already exists with different evidence`,
            );
          }
        }
      }

      for (const assessment of record.muleAssessments) {
        const assessmentAccountId = await accountId(
          client,
          assessment.signalProvenance.sourceName,
          assessment.accountId,
        );
        const result = await client.query<{ assessment_ref: string }>(
          `INSERT INTO mule_assessments (
             assessment_ref, case_id, account_id, graph_version, state, score, reason_codes,
             features, feature_version, rule_version, calculation_input_hash, signal_provenance,
             trusted_outcome, assessed_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11,
             $12::jsonb, $13::jsonb, $14
           )
           ON CONFLICT (case_id, graph_version, account_id) DO UPDATE SET
             assessed_at = mule_assessments.assessed_at
           WHERE mule_assessments.calculation_input_hash = EXCLUDED.calculation_input_hash
           RETURNING assessment_ref`,
          [
            assessment.assessmentId,
            internalCaseId,
            assessmentAccountId,
            assessment.graphVersion,
            assessment.state,
            assessment.score,
            JSON.stringify(assessment.reasonCodes),
            JSON.stringify(assessment.features),
            assessment.featureVersion,
            assessment.ruleVersion,
            assessment.calculationInputHash,
            JSON.stringify(assessment.signalProvenance),
            JSON.stringify(assessment.trustedOutcome),
            assessment.assessedAt,
          ],
        );
        if (result.rows.length === 0) {
          throw new ConflictError(
            'RISK_VERSION_IMMUTABLE',
            `Risk for ${assessment.accountId} and graph version ${assessment.graphVersion} already exists with different evidence`,
          );
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getIdempotency(operation: string, key: string): Promise<IdempotencyRecord | null> {
    const result = await this.pool.query<{
      request_hash: string;
      response_body: unknown;
    }>(
      `SELECT request_hash, response_body
       FROM idempotency_keys
       WHERE operation = $1 AND key = $2 AND expires_at > now()`,
      [operation, key],
    );
    const row = result.rows[0];
    return row
      ? {
          operation,
          key,
          requestHash: row.request_hash,
          response: jsonValue(row.response_body),
        }
      : null;
  }

  async saveIdempotency(record: IdempotencyRecord): Promise<void> {
    await this.pool.query(
      `DELETE FROM idempotency_keys
       WHERE operation = $1 AND key = $2 AND expires_at <= now()`,
      [record.operation, record.key],
    );
    await this.pool.query(
      `INSERT INTO idempotency_keys (
         operation, key, request_hash, response_status, response_body, expires_at
       ) VALUES ($1, $2, $3, 200, $4::jsonb, now() + interval '24 hours')
       ON CONFLICT (operation, key) DO NOTHING`,
      [record.operation, record.key, record.requestHash, JSON.stringify(record.response)],
    );
  }
}
