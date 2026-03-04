/**
 * Rate limiting utilities for WhatsApp message sending.
 * Prevents account suspension by:
 * - Limiting per-user triggers (anti-spam)
 * - Spacing global message sends (appear human)
 * - Handling WhatsApp 440 errors with exponential backoff
 */

import { logger } from './logger.js';

/**
 * Per-user rate limiter: prevents individual users from triggering too many responses.
 * Default: 3 responses per minute per user (same as Logan bot).
 */
export class PerUserRateLimiter {
  private history: Map<string, number[]> = new Map();
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests = 3, windowMs = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * Check if a user can trigger a response.
   * @param userId - WhatsApp JID of the sender
   * @returns true if allowed, false if rate limited
   */
  checkLimit(userId: string): boolean {
    const now = Date.now();
    const userHistory = this.history.get(userId) || [];

    // Remove timestamps outside the window
    const recentRequests = userHistory.filter((ts) => now - ts < this.windowMs);

    if (recentRequests.length >= this.maxRequests) {
      logger.warn(
        { userId, count: recentRequests.length, limit: this.maxRequests },
        'Per-user rate limit exceeded',
      );
      return false;
    }

    recentRequests.push(now);
    this.history.set(userId, recentRequests);
    return true;
  }

  /**
   * Clean up old history entries (call periodically)
   */
  cleanup(): void {
    const now = Date.now();
    for (const [userId, timestamps] of this.history.entries()) {
      const recent = timestamps.filter((ts) => now - ts < this.windowMs);
      if (recent.length === 0) {
        this.history.delete(userId);
      } else {
        this.history.set(userId, recent);
      }
    }
  }
}

/**
 * Global message pacer: spaces out outgoing messages to appear human.
 * WhatsApp's informal limits:
 * - ~60 messages/minute globally
 * - ~20 messages/minute to same chat
 * - Bursts are suspicious
 */
export class MessagePacer {
  private lastSendTime = 0;
  private perChatLastSend: Map<string, number> = new Map();
  private globalDelayMs: number;
  private perChatDelayMs: number;

  constructor(globalDelayMs = 1500, perChatDelayMs = 3000) {
    this.globalDelayMs = globalDelayMs; // 1.5s between any messages (40/min)
    this.perChatDelayMs = perChatDelayMs; // 3s to same chat (20/min)
  }

  /**
   * Wait before sending the next message to avoid rate limits.
   * @param chatJid - Destination chat JID
   */
  async pace(chatJid: string): Promise<void> {
    const now = Date.now();

    // Calculate required delays
    const globalWait = Math.max(
      0,
      this.lastSendTime + this.globalDelayMs - now,
    );
    const chatLastSend = this.perChatLastSend.get(chatJid) || 0;
    const chatWait = Math.max(0, chatLastSend + this.perChatDelayMs - now);

    const totalWait = Math.max(globalWait, chatWait);

    if (totalWait > 0) {
      logger.debug(
        { chatJid, waitMs: totalWait },
        'Pacing message send to avoid rate limits',
      );
      await new Promise((resolve) => setTimeout(resolve, totalWait));
    }

    // Update timestamps
    this.lastSendTime = Date.now();
    this.perChatLastSend.set(chatJid, Date.now());
  }
}

/**
 * Exponential backoff for WhatsApp 440 errors (rate limit responses).
 */
export class ExponentialBackoff {
  private baseDelayMs: number;
  private maxRetries: number;

  constructor(baseDelayMs = 2000, maxRetries = 3) {
    this.baseDelayMs = baseDelayMs;
    this.maxRetries = maxRetries;
  }

  /**
   * Execute a function with exponential backoff on failure.
   * @param fn - Async function to execute
   * @param attempt - Current attempt number (used for recursion)
   * @returns Result of fn
   */
  async execute<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      const is440 = err?.output?.statusCode === 440 || err?.statusCode === 440;
      const shouldRetry = is440 && attempt < this.maxRetries;

      if (!shouldRetry) {
        throw err;
      }

      // Calculate delay with jitter
      const exponentialDelay = this.baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * 1000; // 0-1s jitter
      const delayMs = exponentialDelay + jitter;

      logger.warn(
        { attempt: attempt + 1, delayMs, maxRetries: this.maxRetries },
        'WhatsApp 440 error, retrying with backoff',
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return this.execute(fn, attempt + 1);
    }
  }
}

/**
 * Cleanup old rate limiter data periodically.
 * Call this on an interval (e.g., every 5 minutes).
 * @returns Timer ID that can be cleared with clearInterval()
 */
export function startRateLimiterCleanup(
  limiter: PerUserRateLimiter,
): NodeJS.Timeout {
  return setInterval(
    () => {
      limiter.cleanup();
      logger.debug('Rate limiter history cleaned up');
    },
    5 * 60 * 1000,
  ); // 5 minutes
}
