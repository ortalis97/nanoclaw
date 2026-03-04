# Rate Limiting Integration Guide

## Overview

This document describes how to integrate rate limiting into NanoClaw's WhatsApp channel to prevent account suspension.

## Changes Required

### 1. Add Rate Limiter Imports to `whatsapp.ts`

```typescript
// Add after existing imports (around line 23)
import {
  PerUserRateLimiter,
  MessagePacer,
  ExponentialBackoff,
  startRateLimiterCleanup,
} from '../rate-limiter.js';
```

### 2. Add Rate Limiter Instances to WhatsAppChannel Class

```typescript
// Add after line 51 in whatsapp.ts
export class WhatsAppChannel implements Channel {
  name = 'whatsapp';

  private sock!: WASocket;
  private connected = false;
  private lidToPhoneMap: Record<string, string> = {};
  private outgoingQueue: Array<{ jid: string; text: string }> = [];
  private flushing = false;
  private groupSyncTimerStarted = false;

  private groupParticipants: Map<string, Set<string>> = new Map();
  private opts: WhatsAppChannelOpts;

  // === ADD THESE THREE LINES ===
  private userRateLimiter = new PerUserRateLimiter(3, 60_000); // 3 msgs/min per user
  private messagePacer = new MessagePacer(1500, 3000); // 1.5s global, 3s per-chat
  private backoff = new ExponentialBackoff(2000, 3); // 2s base, 3 retries
  // === END ADD ===

  constructor(opts: WhatsAppChannelOpts) {
    this.opts = opts;
    // === ADD THIS LINE ===
    startRateLimiterCleanup(this.userRateLimiter);
    // === END ADD ===
  }
```

### 3. Add Per-User Rate Limiting to Message Handler

In the `messages.upsert` event handler (around line 229), add rate limiting check:

```typescript
// FIND THIS CODE (around line 219):
if (groups[chatJid]) {
  const content = /* ... */;
  // ... rest of message processing

// REPLACE WITH:
if (groups[chatJid]) {
  // === ADD RATE LIMIT CHECK ===
  // Check per-user rate limit (prevents spam from individual users)
  // Only apply to non-bot messages
  const fromMe = msg.key.fromMe || false;
  if (!fromMe) {
    const sender = msg.key.participant || msg.key.remoteJid || '';
    if (!this.userRateLimiter.checkLimit(sender)) {
      logger.info(
        { sender, chatJid },
        'User rate limited - ignoring message',
      );
      continue; // Skip this message
    }
  }
  // === END ADD ===

  const content = /* ... existing code ... */;
  // ... rest of message processing continues unchanged
```

### 4. Add Message Pacing to sendMessage()

Replace the `sendMessage()` method (lines 288-316) with this version:

```typescript
async sendMessage(jid: string, text: string): Promise<void> {
  const prefixed = ASSISTANT_HAS_OWN_NUMBER
    ? text
    : `${ASSISTANT_NAME}: ${text}`;

  if (!this.connected) {
    this.outgoingQueue.push({ jid, text: prefixed });
    logger.info(
      { jid, length: prefixed.length, queueSize: this.outgoingQueue.length },
      'WA disconnected, message queued',
    );
    return;
  }

  try {
    // === ADD PACING ===
    await this.messagePacer.pace(jid);
    // === END ADD ===

    // === WRAP WITH EXPONENTIAL BACKOFF ===
    await this.backoff.execute(async () => {
      await this.sock.sendMessage(jid, { text: prefixed });
    });
    // === END WRAP ===

    logger.info({ jid, length: prefixed.length }, 'Message sent');
  } catch (err) {
    this.outgoingQueue.push({ jid, text: prefixed });
    logger.warn(
      { jid, err, queueSize: this.outgoingQueue.length },
      'Failed to send, message queued',
    );
  }
}
```

### 5. Update Queue Flushing with Pacing

Replace `flushOutgoingQueue()` (lines 441-461) with:

```typescript
private async flushOutgoingQueue(): Promise<void> {
  if (this.flushing || this.outgoingQueue.length === 0) return;
  this.flushing = true;
  try {
    logger.info(
      { count: this.outgoingQueue.length },
      'Flushing outgoing message queue',
    );
    while (this.outgoingQueue.length > 0) {
      const item = this.outgoingQueue.shift()!;

      // === ADD PACING ===
      await this.messagePacer.pace(item.jid);
      // === END ADD ===

      // === WRAP WITH EXPONENTIAL BACKOFF ===
      await this.backoff.execute(async () => {
        await this.sock.sendMessage(item.jid, { text: item.text });
      });
      // === END WRAP ===

      logger.info(
        { jid: item.jid, length: item.text.length },
        'Queued message sent',
      );
    }
  } finally {
    this.flushing = false;
  }
}
```

## Configuration via Environment Variables (Optional Enhancement)

Add these to `.env.example` and `config.ts`:

```bash
# Rate Limiting Configuration
# Max responses per user per minute (default: 3)
USER_RATE_LIMIT=3
# Window for user rate limit in milliseconds (default: 60000 = 1 minute)
USER_RATE_WINDOW_MS=60000
# Global delay between any messages in milliseconds (default: 1500 = 1.5s)
GLOBAL_MESSAGE_DELAY_MS=1500
# Per-chat delay in milliseconds (default: 3000 = 3s)
PER_CHAT_DELAY_MS=3000
```

Then update the constructor to use these values:

```typescript
private userRateLimiter = new PerUserRateLimiter(
  parseInt(process.env.USER_RATE_LIMIT || '3'),
  parseInt(process.env.USER_RATE_WINDOW_MS || '60000'),
);
private messagePacer = new MessagePacer(
  parseInt(process.env.GLOBAL_MESSAGE_DELAY_MS || '1500'),
  parseInt(process.env.PER_CHAT_DELAY_MS || '3000'),
);
```

## Testing

1. **Test per-user rate limiting:**
   - Send 4+ messages within 1 minute from same user
   - 4th message should be silently dropped with log entry

2. **Test message pacing:**
   - Queue multiple messages while disconnected
   - Reconnect and observe 1.5s delays between sends in logs

3. **Test exponential backoff:**
   - Simulate 440 error (may need to send many messages rapidly)
   - Check logs for retry attempts with increasing delays

## Performance Impact

- **Latency:** Each message delayed by ~1.5s (acceptable for async bot)
- **Memory:** Minimal (~1KB per user in rate limiter history)
- **CPU:** Negligible (simple timestamp checks)

## Rollback Plan

If issues occur:
1. Comment out the rate limiter instantiation in constructor
2. Remove `checkLimit()` call from message handler
3. Remove `pace()` calls from `sendMessage()` and `flushOutgoingQueue()`
4. Restart service

The `rate-limiter.ts` file can remain — it won't be used.
