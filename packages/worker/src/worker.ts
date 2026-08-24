import { evidenceAnchorRequestSchema } from "../../contracts/src/case.ts";
import type { SyntheticLedger } from "../../ledger/src/ledger.ts";
import { InMemoryOutbox, type OutboxJob } from "./outbox.ts";

export class TransactionEventPipeline {
  readonly #ledger: SyntheticLedger;
  readonly #outbox: InMemoryOutbox;

  constructor(ledger: SyntheticLedger, outbox: InMemoryOutbox) {
    this.#ledger = ledger;
    this.#outbox = outbox;
  }

  ingest(rawEvent: unknown): { ledgerStatus: "APPENDED" | "IDEMPOTENT_REPLAY"; traceJob: OutboxJob } {
    const appended = this.#ledger.append(rawEvent);
    const traceJob = this.#outbox.enqueue({
      type: "TRACE_REFRESH", payload: { transactionId: appended.event.transactionId }, idempotencyKey: `trace-refresh:${appended.event.eventId}`,
      createdAt: appended.event.occurredAt
    }).job;
    return { ledgerStatus: appended.status, traceJob };
  }
}

type EvidenceAnchorWriter = { anchor(rawInput: unknown): unknown };

export class EvidenceAnchorWorker {
  readonly #outbox: InMemoryOutbox;
  readonly #anchors: EvidenceAnchorWriter;

  constructor(outbox: InMemoryOutbox, anchors: EvidenceAnchorWriter) {
    this.#outbox = outbox;
    this.#anchors = anchors;
  }

  processOne(now: string): "PROCESSED" | "IDLE" | "RETRY_SCHEDULED" | "FAILED" {
    const job = this.#outbox.claimNext("EVIDENCE_ANCHOR", now);
    if (job === undefined) return "IDLE";
    try {
      this.#anchors.anchor(evidenceAnchorRequestSchema.parse(job.payload));
      this.#outbox.succeed(job, now);
      return "PROCESSED";
    } catch (error) {
      this.#outbox.fail(job, now, error instanceof Error ? error.message : "Unknown worker error");
      return job.status === "FAILED" ? "FAILED" : "RETRY_SCHEDULED";
    }
  }
}

type TraceRefreshHandler = { refreshTracesForTransaction(transactionId: string): unknown };

export class TraceRefreshWorker {
  readonly #outbox: InMemoryOutbox;
  readonly #handler: TraceRefreshHandler;

  constructor(outbox: InMemoryOutbox, handler: TraceRefreshHandler) {
    this.#outbox = outbox;
    this.#handler = handler;
  }

  processOne(now: string): "PROCESSED" | "IDLE" | "RETRY_SCHEDULED" | "FAILED" {
    const job = this.#outbox.claimNext("TRACE_REFRESH", now);
    if (job === undefined) return "IDLE";
    try {
      const payload = job.payload as { transactionId?: unknown };
      if (typeof payload.transactionId !== "string") throw new Error("Trace-refresh job has no transaction ID.");
      this.#handler.refreshTracesForTransaction(payload.transactionId);
      this.#outbox.succeed(job, now);
      return "PROCESSED";
    } catch (error) {
      this.#outbox.fail(job, now, error instanceof Error ? error.message : "Unknown worker error");
      return job.status === "FAILED" ? "FAILED" : "RETRY_SCHEDULED";
    }
  }
}

