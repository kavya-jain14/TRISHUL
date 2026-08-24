import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import type { PersistedAlert } from "../../../packages/database/src/alerts.ts";
import type { PersistedCase } from "../../../packages/database/src/cases.ts";
import type { DeadLetterJob, PersistentOutboxJob, QueueHealth, QueueMetrics } from "../../../packages/database/src/outbox.ts";
import type { TraceResult } from "../../../packages/ledger/src/ledger.ts";
import type { TransactionEvent } from "../../../packages/ledger/src/schema.ts";
import type { StructuredLogger } from "../../../packages/worker/src/observability.ts";
import { ApiError, type ApiAuthorizer, type ApiPermission, type ApiPrincipal } from "./auth.ts";

type CaseStore = {
  createFromComplaint(request: unknown): Promise<{ status: "CREATED" | "IDEMPOTENT_REPLAY"; case: PersistedCase }>;
  appendState(input: unknown): Promise<{ status: "APPENDED" | "IDEMPOTENT_REPLAY"; case: PersistedCase }>;
  get(caseId: string): Promise<PersistedCase | undefined>;
};

type AlertStore = {
  listForCase(caseId: string, limit?: number): Promise<readonly PersistedAlert[]>;
  acknowledge(alertId: string, acknowledgedAt: string): Promise<PersistedAlert>;
};

type OperationsStore = {
  metrics(now: string): Promise<QueueMetrics>;
  health(now: string): Promise<QueueHealth>;
  listOpenDeadLetters(limit?: number): Promise<readonly DeadLetterJob[]>;
  replayDeadLetter(deadLetterId: string, replayedBy: string, now: string): Promise<PersistentOutboxJob>;
};

type TraceStore = {
  trace(seed: unknown): Promise<TraceResult>;
};

type LedgerStore = {
  ingest(event: unknown): Promise<{ status: "APPENDED" | "IDEMPOTENT_REPLAY"; event: TransactionEvent }>;
  listForTransaction(transactionId: string): Promise<readonly TransactionEvent[]>;
};

export type ApiDependencies = {
  authorizer: ApiAuthorizer;
  cases: CaseStore;
  alerts: AlertStore;
  operations: OperationsStore;
  traces: TraceStore;
  ledger: LedgerStore;
  logger: StructuredLogger;
  clock?: () => Date;
};

export type ApiServerOptions = {
  maxBodyBytes?: number;
};

export function createApiServer(dependencies: ApiDependencies, options: ApiServerOptions = {}): Server {
  const maxBodyBytes = options.maxBodyBytes ?? 1_048_576;
  return createServer(async (request, response) => {
    const requestId = request.headers["x-request-id"]?.toString() || randomUUID();
    setSecurityHeaders(response, requestId);
    try {
      const result = await routeRequest(request, dependencies, maxBodyBytes);
      sendJson(response, result.statusCode, result.body);
      dependencies.logger.log("INFO", "api_request_completed", {
        requestId,
        method: request.method,
        path: safePath(request),
        statusCode: result.statusCode
      });
    } catch (error) {
      const mapped = mapError(error);
      sendJson(response, mapped.statusCode, { error: { code: mapped.code, message: mapped.message }, requestId });
      dependencies.logger.log(mapped.statusCode >= 500 ? "ERROR" : "WARN", "api_request_failed", {
        requestId,
        method: request.method,
        path: safePath(request),
        statusCode: mapped.statusCode,
        errorCode: mapped.code
      });
    }
  });
}

async function routeRequest(request: IncomingMessage, dependencies: ApiDependencies, maxBodyBytes: number): Promise<{ statusCode: number; body: unknown }> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://trishul.local");
  const path = url.pathname;
  const now = (dependencies.clock ?? (() => new Date()))().toISOString();

  if (method === "GET" && path === "/health/live") return { statusCode: 200, body: { status: "LIVE", checkedAt: now } };
  if (method === "GET" && path === "/health/ready") {
    const health = await dependencies.operations.health(now);
    return { statusCode: health.status === "HEALTHY" ? 200 : 503, body: health };
  }

  if (method === "POST" && path === "/v1/traces/resolve") {
    await authorize(request, dependencies.authorizer, "trace:read");
    const trace = await dependencies.traces.trace(await readJson(request, maxBodyBytes));
    return { statusCode: 200, body: trace };
  }

  const ledgerMatch = path.match(/^\/v1\/ledger\/transactions\/([^/]+)\/events$/);
  if (method === "GET" && ledgerMatch !== null) {
    await authorize(request, dependencies.authorizer, "ledger:read");
    return { statusCode: 200, body: { events: await dependencies.ledger.listForTransaction(decodeSegment(ledgerMatch[1])) } };
  }

  if (method === "POST" && path === "/v1/ledger/events") {
    await authorize(request, dependencies.authorizer, "ledger:write");
    const ingested = await dependencies.ledger.ingest(await readJson(request, maxBodyBytes));
    return { statusCode: ingested.status === "APPENDED" ? 201 : 200, body: ingested };
  }

  if (method === "POST" && path === "/v1/cases") {
    await authorize(request, dependencies.authorizer, "case:write");
    const created = await dependencies.cases.createFromComplaint(await readJson(request, maxBodyBytes));
    return { statusCode: created.status === "CREATED" ? 201 : 200, body: created };
  }

  const caseStateMatch = path.match(/^\/v1\/cases\/([^/]+)\/states$/);
  if (method === "POST" && caseStateMatch !== null) {
    const caseId = decodeSegment(caseStateMatch[1]);
    await authorize(request, dependencies.authorizer, "case:write", caseId);
    const body = asObject(await readJson(request, maxBodyBytes));
    return { statusCode: 200, body: await dependencies.cases.appendState({ ...body, caseId }) };
  }

  const caseAlertsMatch = path.match(/^\/v1\/cases\/([^/]+)\/alerts$/);
  if (method === "GET" && caseAlertsMatch !== null) {
    const caseId = decodeSegment(caseAlertsMatch[1]);
    await authorize(request, dependencies.authorizer, "alert:read", caseId);
    const limit = parseLimit(url.searchParams.get("limit"));
    return { statusCode: 200, body: { alerts: await dependencies.alerts.listForCase(caseId, limit) } };
  }

  const caseMatch = path.match(/^\/v1\/cases\/([^/]+)$/);
  if (method === "GET" && caseMatch !== null) {
    const caseId = decodeSegment(caseMatch[1]);
    await authorize(request, dependencies.authorizer, "case:read", caseId);
    const found = await dependencies.cases.get(caseId);
    if (found === undefined) throw new ApiError(404, "CASE_NOT_FOUND", `Case ${caseId} was not found.`);
    return { statusCode: 200, body: found };
  }

  const acknowledgeMatch = path.match(/^\/v1\/alerts\/([^/]+)\/acknowledge$/);
  if (method === "POST" && acknowledgeMatch !== null) {
    await authorize(request, dependencies.authorizer, "alert:write");
    return { statusCode: 200, body: await dependencies.alerts.acknowledge(decodeSegment(acknowledgeMatch[1]), now) };
  }

  if (method === "GET" && path === "/v1/operations/queue/metrics") {
    await authorize(request, dependencies.authorizer, "operations:read");
    return { statusCode: 200, body: await dependencies.operations.metrics(now) };
  }

  if (method === "GET" && path === "/v1/operations/dead-letters") {
    await authorize(request, dependencies.authorizer, "operations:read");
    return { statusCode: 200, body: { deadLetters: await dependencies.operations.listOpenDeadLetters(parseLimit(url.searchParams.get("limit"))) } };
  }

  const replayMatch = path.match(/^\/v1\/operations\/dead-letters\/([^/]+)\/replay$/);
  if (method === "POST" && replayMatch !== null) {
    const principal = await authorize(request, dependencies.authorizer, "operations:write");
    const replayed = await dependencies.operations.replayDeadLetter(decodeSegment(replayMatch[1]), principal.subject, now);
    return { statusCode: 200, body: { status: "REPLAY_SCHEDULED", job: replayed } };
  }

  throw new ApiError(404, "ROUTE_NOT_FOUND", "The requested API route was not found.");
}

async function authorize(request: IncomingMessage, authorizer: ApiAuthorizer, permission: ApiPermission, caseId?: string): Promise<ApiPrincipal> {
  return authorizer.authorize({
    authorizationHeader: request.headers.authorization,
    permission,
    ...(caseId === undefined ? {} : { caseId })
  });
}

async function readJson(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new ApiError(415, "JSON_REQUIRED", "Content-Type application/json is required.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    size += chunk.length;
    if (size > maxBodyBytes) throw new ApiError(413, "REQUEST_TOO_LARGE", `Request body exceeds ${maxBodyBytes} bytes.`);
    chunks.push(chunk);
  }
  if (size === 0) throw new ApiError(400, "BODY_REQUIRED", "A JSON request body is required.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body is not valid JSON.");
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ApiError(400, "OBJECT_REQUIRED", "A JSON object is required.");
  return value as Record<string, unknown>;
}

function parseLimit(rawLimit: string | null): number {
  if (rawLimit === null) return 100;
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, "INVALID_LIMIT", "limit must be an integer from 1 to 100.");
  return limit;
}

function decodeSegment(segment: string | undefined): string {
  if (segment === undefined) throw new ApiError(400, "INVALID_PATH", "The resource identifier is missing.");
  try {
    const decoded = decodeURIComponent(segment);
    if (decoded.length === 0) throw new Error("empty");
    return decoded;
  } catch {
    throw new ApiError(400, "INVALID_PATH", "The resource identifier is invalid.");
  }
}

function mapError(error: unknown): { statusCode: number; code: string; message: string } {
  if (error instanceof ApiError) return error;
  if (error instanceof ZodError) return { statusCode: 400, code: "VALIDATION_FAILED", message: "The request did not match the required schema." };
  return { statusCode: 500, code: "INTERNAL_ERROR", message: "The request could not be completed." };
}

function setSecurityHeaders(response: ServerResponse, requestId: string): void {
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  response.setHeader("x-request-id", requestId);
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  if (response.headersSent) return;
  response.statusCode = statusCode;
  response.end(JSON.stringify(body));
}

function safePath(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? "/", "http://trishul.local").pathname;
  } catch {
    return "/invalid-url";
  }
}
