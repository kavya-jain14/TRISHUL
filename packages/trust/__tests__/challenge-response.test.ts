/**
 * Challenge-Response / Nonce Tests
 *
 * Tests nonce security:
 * - Fresh nonce accepted
 * - Reused nonce rejected (replay protection)
 * - Expired nonce rejected
 * - Unknown nonce rejected
 *
 * Owner: Vatsal Bhardwaj
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NonceStore } from "../src/nonce-store.js";

describe("NonceStore", () => {
  let store: NonceStore;

  beforeEach(() => {
    // 2-second TTL for fast testing, no automatic cleanup
    store = new NonceStore(2000, 60_000);
  });

  afterEach(() => {
    store.destroy();
  });

  it("should issue a fresh nonce", () => {
    const result = store.issue("investigator-001");

    expect(result.nonce).toBeDefined();
    expect(result.nonce.length).toBe(64); // 32 bytes hex
    expect(result.challengeId).toBeDefined();
    expect(result.issuedAt).toBeInstanceOf(Date);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt.getTime()).toBeGreaterThan(
      result.issuedAt.getTime()
    );
  });

  it("should accept a fresh nonce on consumption", () => {
    const { nonce } = store.issue("investigator-001");
    const result = store.consume(nonce);

    expect(result.valid).toBe(true);
    expect(result.reason).toBe("NONCE_VALID");
  });

  it("should reject a reused nonce (replay protection)", () => {
    const { nonce } = store.issue("investigator-001");

    // First use — should succeed
    const first = store.consume(nonce);
    expect(first.valid).toBe(true);

    // Second use — replay detected
    const second = store.consume(nonce);
    expect(second.valid).toBe(false);
    expect(second.reason).toBe("NONCE_REPLAY_DETECTED");
  });

  it("should reject an expired nonce", async () => {
    // Create store with very short TTL
    const shortStore = new NonceStore(100, 60_000); // 100ms TTL
    const { nonce } = shortStore.issue("investigator-001");

    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 200));

    const result = shortStore.consume(nonce);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("NONCE_EXPIRED");

    shortStore.destroy();
  });

  it("should reject an unknown nonce", () => {
    const result = store.consume("nonexistent-nonce-value");

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("NONCE_UNKNOWN");
  });

  it("should track the investigator ID for each nonce", () => {
    const { nonce } = store.issue("investigator-42");

    expect(store.getInvestigatorId(nonce)).toBe("investigator-42");
    expect(store.getInvestigatorId("unknown-nonce")).toBeNull();
  });

  it("should allow peeking without consuming", () => {
    const { nonce } = store.issue("investigator-001");

    // Peek should not consume
    const peek1 = store.peek(nonce);
    expect(peek1.exists).toBe(true);
    expect(peek1.expired).toBe(false);
    expect(peek1.consumed).toBe(false);

    // Should still be consumable after peek
    const consumeResult = store.consume(nonce);
    expect(consumeResult.valid).toBe(true);

    // Peek after consumption
    const peek2 = store.peek(nonce);
    expect(peek2.consumed).toBe(true);
  });

  it("should issue unique nonces", () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const { nonce } = store.issue(`investigator-${i}`);
      expect(nonces.has(nonce)).toBe(false);
      nonces.add(nonce);
    }
    expect(nonces.size).toBe(100);
  });
});
