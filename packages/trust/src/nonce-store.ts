/**
 * Nonce Store
 *
 * Manages nonce lifecycle for challenge-response flows.
 * Provides replay protection by enforcing single-use nonces with TTL.
 *
 * This is an in-memory implementation suitable for the prototype.
 * For production, replace with a Redis/DB-backed store.
 *
 * Owner: Vatsal Bhardwaj
 */

import { randomBytes } from "crypto";

interface StoredNonce {
  value: string;
  investigatorId: string;
  issuedAt: Date;
  expiresAt: Date;
  consumed: boolean;
}

export class NonceStore {
  private nonces = new Map<string, StoredNonce>();
  private readonly ttlMs: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * @param ttlMs - Time-to-live for nonces in milliseconds (default: 5 minutes)
   * @param cleanupIntervalMs - How often to purge expired nonces (default: 60 seconds)
   */
  constructor(ttlMs = 5 * 60 * 1000, cleanupIntervalMs = 60 * 1000) {
    this.ttlMs = ttlMs;
    this.cleanupInterval = setInterval(
      () => this.purgeExpired(),
      cleanupIntervalMs
    );
    // Allow the timer to not prevent process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Issue a fresh nonce for an investigator.
   * @returns The nonce value, challengeId, and expiry
   */
  issue(investigatorId: string): {
    nonce: string;
    challengeId: string;
    issuedAt: Date;
    expiresAt: Date;
  } {
    const nonce = randomBytes(32).toString("hex");
    const challengeId = randomBytes(16).toString("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlMs);

    this.nonces.set(nonce, {
      value: nonce,
      investigatorId,
      issuedAt: now,
      expiresAt,
      consumed: false,
    });

    return { nonce, challengeId, issuedAt: now, expiresAt };
  }

  /**
   * Consume a nonce. Returns true if the nonce was valid and unconsumed.
   * Returns false if the nonce is expired, already consumed, or unknown.
   *
   * This is the core replay protection mechanism.
   */
  consume(nonce: string): { valid: boolean; reason: string } {
    const stored = this.nonces.get(nonce);

    if (!stored) {
      return { valid: false, reason: "NONCE_UNKNOWN" };
    }

    if (stored.consumed) {
      return { valid: false, reason: "NONCE_REPLAY_DETECTED" };
    }

    const now = new Date();
    if (now > stored.expiresAt) {
      return { valid: false, reason: "NONCE_EXPIRED" };
    }

    // Mark as consumed — this nonce can never be used again
    stored.consumed = true;
    return { valid: true, reason: "NONCE_VALID" };
  }

  /**
   * Check if a nonce exists and is valid (without consuming it).
   */
  peek(nonce: string): { exists: boolean; expired: boolean; consumed: boolean } {
    const stored = this.nonces.get(nonce);
    if (!stored) {
      return { exists: false, expired: false, consumed: false };
    }
    const now = new Date();
    return {
      exists: true,
      expired: now > stored.expiresAt,
      consumed: stored.consumed,
    };
  }

  /**
   * Get the investigator ID associated with a nonce.
   */
  getInvestigatorId(nonce: string): string | null {
    return this.nonces.get(nonce)?.investigatorId ?? null;
  }

  /**
   * Purge all expired nonces from the store.
   */
  private purgeExpired(): void {
    const now = new Date();
    for (const [key, stored] of this.nonces) {
      if (now > stored.expiresAt) {
        this.nonces.delete(key);
      }
    }
  }

  /**
   * Destroy the store and clear the cleanup interval.
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.nonces.clear();
  }

  /** Number of active (non-expired) nonces — for testing/monitoring */
  get size(): number {
    return this.nonces.size;
  }
}
