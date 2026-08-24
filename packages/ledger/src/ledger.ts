import { traceSeedSchema, transactionEventSchema, type TraceSeed, type TransactionEvent } from "./schema.ts";

export type AppendResult =
  | { status: "APPENDED"; event: TransactionEvent }
  | { status: "IDEMPOTENT_REPLAY"; event: TransactionEvent };

export type TraceResult = {
  seed: TraceSeed;
  events: readonly TransactionEvent[];
  hopCount: number;
  terminalAccountIds: readonly string[];
};

export class SyntheticLedger {
  readonly #eventsByTransaction = new Map<string, TransactionEvent[]>();
  readonly #eventsByIdempotencyKey = new Map<string, TransactionEvent>();

  append(rawEvent: unknown): AppendResult {
    const event = transactionEventSchema.parse(rawEvent);
    const prior = this.#eventsByIdempotencyKey.get(event.idempotencyKey);

    if (prior !== undefined) {
      if (JSON.stringify(prior) !== JSON.stringify(event)) {
        throw new Error(`Idempotency key ${event.idempotencyKey} was reused with a different event.`);
      }
      return { status: "IDEMPOTENT_REPLAY", event: prior };
    }

    const events = this.#eventsByTransaction.get(event.transactionId) ?? [];
    if (events.some((existing) => existing.eventId === event.eventId)) {
      throw new Error(`Event ${event.eventId} already exists for transaction ${event.transactionId}.`);
    }
    const immutableCopy = Object.freeze({ ...event });
    this.#eventsByIdempotencyKey.set(immutableCopy.idempotencyKey, immutableCopy);
    this.#eventsByTransaction.set(event.transactionId, [...events, immutableCopy]);
    return { status: "APPENDED", event: immutableCopy };
  }

  resolve(rawSeed: unknown): readonly TransactionEvent[] {
    const seed = traceSeedSchema.parse(rawSeed);
    const directEvents = this.#eventsByTransaction.get(seed.transactionId) ?? [];
    return [...directEvents].sort(compareEvents);
  }

  trace(rawSeed: unknown): TraceResult {
    const seed = traceSeedSchema.parse(rawSeed);
    const seedEvents = this.resolve(seed);
    const selected = new Map(seedEvents.map((event) => [event.eventId, event]));
    let frontier = seedEvents;
    let hopCount = 0;

    while (frontier.length > 0 && hopCount < seed.maxHops) {
      const next = this.allEvents().filter((candidate) =>
        !selected.has(candidate.eventId) &&
        frontier.some((incoming) =>
          candidate.fromAccountId === incoming.toAccountId && candidate.occurredAt >= incoming.occurredAt
        )
      );
      if (next.length === 0) break;
      next.forEach((event) => selected.set(event.eventId, event));
      frontier = next;
      hopCount += 1;
    }

    const events = [...selected.values()].sort(compareEvents);
    const forwardedFrom = new Set(events.map((event) => event.fromAccountId));
    const terminalAccountIds = [...new Set(events.map((event) => event.toAccountId))]
      .filter((accountId) => !forwardedFrom.has(accountId))
      .sort();
    return { seed, events, hopCount, terminalAccountIds };
  }

  allEvents(): readonly TransactionEvent[] {
    return [...this.#eventsByTransaction.values()].flat().sort(compareEvents);
  }
}

function compareEvents(left: TransactionEvent, right: TransactionEvent): number {
  return left.occurredAt.localeCompare(right.occurredAt) || left.sequence - right.sequence || left.eventId.localeCompare(right.eventId);
}

