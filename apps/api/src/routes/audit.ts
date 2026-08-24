/**
 * Audit Routes
 *
 * API endpoints for querying the audit trail.
 * Access to audit events requires valid investigator authorization.
 *
 * Endpoints:
 * - GET /api/audit/events        — Query audit trail (with filters)
 * - GET /api/audit/event/:id     — Get a single audit event
 *
 * Owner: Vatsal Bhardwaj
 * Consumers: Sandhya (case audit), Ujjwal (frontend audit view)
 */

import { Hono } from "hono";
import { AuditQuerySchema } from "@trishul/contracts";
import type { AuditLogger } from "@trishul/audit";

export function createAuditRoutes(deps: { auditLogger: AuditLogger }) {
  const app = new Hono();

  /**
   * GET /api/audit/events
   *
   * Query audit events with optional filters.
   * Query params: caseId, actor, action, fromTimestamp, toTimestamp, limit, offset
   */
  app.get("/events", async (c) => {
    const query = {
      caseId: c.req.query("caseId"),
      actor: c.req.query("actor"),
      action: c.req.query("action"),
      fromTimestamp: c.req.query("fromTimestamp"),
      toTimestamp: c.req.query("toTimestamp"),
      limit: c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : undefined,
      offset: c.req.query("offset") ? parseInt(c.req.query("offset")!, 10) : undefined,
    };

    // Remove undefined values for Zod parsing
    const cleanQuery = Object.fromEntries(
      Object.entries(query).filter(([_, v]) => v !== undefined)
    );

    const parsed = AuditQuerySchema.safeParse(cleanQuery);
    if (!parsed.success) {
      return c.json(
        { error: "BAD_REQUEST", details: parsed.error.issues },
        400
      );
    }

    const events = deps.auditLogger.query(parsed.data);
    const total = deps.auditLogger.count(parsed.data.caseId);

    return c.json(
      {
        events,
        total,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      },
      200
    );
  });

  /**
   * GET /api/audit/event/:id
   *
   * Get a single audit event by ID.
   */
  app.get("/event/:id", async (c) => {
    const eventId = c.req.param("id");
    const event = deps.auditLogger.getById(eventId);

    if (!event) {
      return c.json(
        { error: "NOT_FOUND", message: "Audit event not found" },
        404
      );
    }

    return c.json(event, 200);
  });

  return app;
}
