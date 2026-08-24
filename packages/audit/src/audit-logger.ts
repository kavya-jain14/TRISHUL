/**
 * Audit Logger
 *
 * Records immutable audit events for all sensitive operations.
 * Optionally anchors critical events on-chain via the blockchain service.
 *
 * Secrets, raw credentials, and sensitive identity data are NEVER stored in audit logs.
 *
 * Owner: Vatsal Bhardwaj
 * Integration: Sandhya (case audit events)
 *
 * This implements the AuditService interface expected by @trishul/trust.
 */

import { randomUUID, createHash } from "crypto";
import type { AuditEvent, AuditAction, AuthorizationResult } from "@trishul/contracts";
import type { BlockchainSimulator } from "./blockchain-simulator.js";

/** Audit event input (without auto-generated fields) */
export interface AuditEventInput {
  actor: string;
  action: AuditAction;
  caseId?: string;
  authorizationResult: AuthorizationResult;
  credentialRef?: string;
  sessionRef?: string;
  purpose?: string;
  outcome: string;
  evidenceHashRef?: string;
  blockchainAnchorRef?: string;
}

/** Actions that are considered critical and should be anchored on-chain */
const CRITICAL_ACTIONS: AuditAction[] = [
  "ACCESS_GRANTED",
  "ACCESS_DENIED",
  "CREDENTIAL_REVOKED",
  "IDENTITY_RESOLUTION_COMPLETED",
  "IDENTITY_RESOLUTION_DENIED",
  "NONCE_REPLAY_DETECTED",
];

export class AuditLogger {
  /** In-memory audit log for prototype — in production, writes to PostgreSQL */
  private events: AuditEvent[] = [];

  constructor(
    private readonly blockchainAnchor?: BlockchainSimulator,
    private readonly anchorCriticalEvents = true
  ) {}

  /**
   * Record an audit event.
   *
   * - Generates a UUID and timestamp
   * - Stores the event
   * - Optionally anchors critical events on-chain
   * - Returns the event ID (used as auditRef)
   */
  async record(input: AuditEventInput): Promise<string> {
    const event: AuditEvent = {
      id: randomUUID(),
      actor: input.actor,
      action: input.action,
      caseId: input.caseId,
      timestamp: new Date().toISOString(),
      authorizationResult: input.authorizationResult,
      credentialRef: input.credentialRef,
      sessionRef: input.sessionRef,
      purpose: input.purpose,
      outcome: input.outcome,
      evidenceHashRef: input.evidenceHashRef,
      blockchainAnchorRef: input.blockchainAnchorRef,
    };

    this.events.push(event);

    // Anchor critical events on-chain
    if (
      this.anchorCriticalEvents &&
      this.blockchainAnchor &&
      CRITICAL_ACTIONS.includes(input.action)
    ) {
      try {
        const eventHash = createHash("sha256")
          .update(JSON.stringify(event))
          .digest("hex");

        const anchorResult = await this.blockchainAnchor.anchor(eventHash, {
          type: "audit_anchor",
          auditEventId: event.id,
          action: event.action,
        });

        event.blockchainAnchorRef = anchorResult.txRef;
      } catch (error) {
        // Anchor failure should not prevent audit event recording
        console.error(
          `[AUDIT] Failed to anchor event ${event.id} on-chain:`,
          error
        );
      }
    }

    return event.id;
  }

  /**
   * Query audit events.
   */
  query(filters: {
    caseId?: string;
    actor?: string;
    action?: AuditAction;
    fromTimestamp?: string;
    toTimestamp?: string;
    limit?: number;
    offset?: number;
  }): AuditEvent[] {
    let results = [...this.events];

    if (filters.caseId) {
      results = results.filter((e) => e.caseId === filters.caseId);
    }
    if (filters.actor) {
      results = results.filter((e) => e.actor === filters.actor);
    }
    if (filters.action) {
      results = results.filter((e) => e.action === filters.action);
    }
    if (filters.fromTimestamp) {
      const from = new Date(filters.fromTimestamp);
      results = results.filter((e) => new Date(e.timestamp) >= from);
    }
    if (filters.toTimestamp) {
      const to = new Date(filters.toTimestamp);
      results = results.filter((e) => new Date(e.timestamp) <= to);
    }

    // Sort by timestamp descending (newest first)
    results.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 50;
    return results.slice(offset, offset + limit);
  }

  /**
   * Get a single audit event by ID.
   */
  getById(eventId: string): AuditEvent | undefined {
    return this.events.find((e) => e.id === eventId);
  }

  /**
   * Get total count of audit events (optionally filtered by case).
   */
  count(caseId?: string): number {
    if (caseId) {
      return this.events.filter((e) => e.caseId === caseId).length;
    }
    return this.events.length;
  }
}
