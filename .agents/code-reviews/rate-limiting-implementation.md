# Code Review: Rate Limiting Implementation

**Date:** 2026-03-04
**Reviewer:** Claude Code (validation:code-review)
**Scope:** Rate limiting integration for WhatsApp message sending and inbound spam protection

## Stats

- Files Modified: 4
- Files Added: 0
- Files Deleted: 1
- New lines: 23
- Deleted lines: 224

## Overview

The implementation successfully wires up three rate limiting components (`PerUserRateLimiter`, `MessagePacer`, `ExponentialBackoff`) into the NanoClaw WhatsApp bot. The overall architecture is sound, but there are several issues ranging from critical bugs to minor improvements.

## Issues Found

---

### Issue 1: Per-User Rate Limiter Checks Wrong Sender

```
severity: high
file: src/index.ts
line: 414-419
issue: Rate limit check uses first message sender, not trigger message sender
detail: The code checks `groupMessages[0]?.sender` for rate limiting, but this is the sender
of the first message in the batch, not necessarily the sender who triggered the bot. In a
group chat where User A sends "hi" followed by User B sending "@Alfred help", the trigger
check passes (User B has trigger) but the rate limit is checked against User A's sender ID.
This can rate limit innocent users and allow spammers to bypass the limit.

Example scenario:
- User A (allowed sender): "hello"
- User B (spammer): "@Alfred help"
- Both messages in same poll cycle
- Code checks if ANY message has trigger (passes)
- Code rate-limits User A instead of User B

suggestion: Extract the sender from the message that contains the trigger, not the first message.
Replace lines 414-419 with:

  // Rate limit check: prevent individual users from spamming the agent
  const triggerMessage = needsTrigger
    ? groupMessages.find((m) => TRIGGER_PATTERN.test(m.content.trim()))
    : groupMessages[0];
  const sender = triggerMessage?.sender;
  if (sender && !perUserLimiter.checkLimit(sender)) {
    logger.info({ sender, chatJid }, 'Sender rate limited, skipping trigger');
    continue;
  }
```

---

### Issue 2: Rate Limiter Cleanup Has No Shutdown Hook

```
severity: medium
file: src/rate-limiter.ts
line: 164-172
issue: setInterval in startRateLimiterCleanup() never cleared, potential memory leak
detail: The startRateLimiterCleanup() function creates a setInterval but doesn't return
the timer ID or provide any way to clear it. If this function is called multiple times
(e.g., during reconnections or tests), it will create multiple intervals. Also, on graceful
shutdown, the interval continues running unnecessarily.

The main() function in src/index.ts has a shutdown handler (line 482-486) that should clean
up all intervals.

suggestion: Return the interval ID and clear it in the shutdown handler:

// src/rate-limiter.ts
export function startRateLimiterCleanup(limiter: PerUserRateLimiter): NodeJS.Timeout {
  return setInterval(
    () => {
      limiter.cleanup();
      logger.debug('Rate limiter history cleaned up');
    },
    5 * 60 * 1000,
  );
}

// src/index.ts (in main())
let rateLimiterCleanupTimer: NodeJS.Timeout;
// ... after loadState()
rateLimiterCleanupTimer = startRateLimiterCleanup(perUserLimiter);

// ... in shutdown handler
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutdown signal received');
  if (rateLimiterCleanupTimer) clearInterval(rateLimiterCleanupTimer);
  await queue.shutdown(10000);
  for (const ch of channels) await ch.disconnect();
  process.exit(0);
};
```

---

### Issue 3: Voice Messages Not Rate Limited

```
severity: medium
file: src/channels/whatsapp.ts
line: 324-342
issue: sendVoiceMessage() bypasses rate limiting entirely
detail: The sendVoiceMessage() method sends messages directly to WhatsApp without using
MessagePacer or ExponentialBackoff. This creates an inconsistency where text messages are
rate limited but voice messages can be sent in rapid bursts. WhatsApp's rate limiting
applies to all message types, not just text.

This could lead to account suspension if the bot sends many voice messages in quick
succession, especially during TTS (text-to-speech) operations.

suggestion: Apply the same rate limiting to voice messages as text messages:

async sendVoiceMessage(jid: string, audio: Buffer): Promise<void> {
  if (!this.connected) {
    logger.warn(
      { jid },
      'WA disconnected, dropping voice message (best-effort)',
    );
    return;
  }
  try {
    await this.messagePacer.pace(jid);
    await this.backoff.execute(() =>
      this.sock.sendMessage(jid, {
        audio,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,
      })
    );
    logger.info({ jid, bytes: audio.length }, 'Voice message sent');
  } catch (err) {
    logger.warn({ jid, err }, 'Failed to send voice message');
  }
}
```

---

### Issue 4: Rate Limiter Bypassed for Piped Messages

```
severity: medium
file: src/index.ts
line: 425
issue: Messages piped to active containers bypass per-user rate limiting
detail: When a container is already running for a chat, new messages are piped directly
via queue.sendMessage() without checking the rate limiter. This means a user can:
1. Send a trigger message (passes rate limit)
2. Container starts
3. Send 100 more messages that all get piped to the container (no rate limit check)

The per-user rate limiter is only checked when spawning a NEW container, not when
adding messages to an existing session.

This partially defeats the purpose of spam protection, as a determined user can still
overwhelm the bot by sending many messages while their container is active.

suggestion: Consider one of these approaches:

Option A (Simple): Don't pipe messages if sender is rate limited
  const sender = messagesToSend[0]?.sender;
  if (sender && !perUserLimiter.checkLimit(sender)) {
    logger.info({ sender, chatJid }, 'Sender rate limited, skipping piped message');
    continue;
  }
  if (queue.sendMessage(chatJid, formatted)) { ... }

Option B (Comprehensive): Track per-sender message counts within active sessions and
enforce limits there too (more complex, may not be necessary for initial release).

Note: This may be acceptable as-is depending on the threat model. If the goal is only
to prevent spawning many containers, the current implementation works. If the goal is
to limit total message processing per user, this needs addressing.
```

---

### Issue 5: Wasted Pacing on Failed Sends

```
severity: low
file: src/channels/whatsapp.ts
line: 309-320
issue: Pacing delay consumed before send attempt, wasted if send fails
detail: The sendMessage() flow is:
1. await messagePacer.pace(jid) - delays N seconds
2. await backoff.execute(() => send()) - attempts send
3. If send fails, message is queued

If the send fails immediately (e.g., connection dropped after pace() but before send()),
we've consumed the pacing delay for nothing. On reconnect, flushOutgoingQueue() will
pace again, so the message gets double-paced.

This is not a bug per se (messages still eventually send), but it's inefficient. During
reconnection scenarios with queued messages, the total send time will be longer than
necessary.

suggestion: Consider moving pace() inside the backoff.execute() try block, so pacing only
happens if we're actually about to send:

try {
  await this.backoff.execute(async () => {
    await this.messagePacer.pace(jid);
    await this.sock.sendMessage(jid, { text: prefixed });
  });
  logger.info({ jid, length: prefixed.length }, 'Message sent');
} catch (err) {
  // If send fails, queue it for retry on reconnect
  this.outgoingQueue.push({ jid, text: prefixed });
  ...
}

This ensures pacing is only consumed when a send actually succeeds.
```

---

## Summary

**Critical Issues:** 0
**High Issues:** 1 (wrong sender rate limited)
**Medium Issues:** 3 (cleanup leak, voice messages unprotected, piped messages unprotected)
**Low Issues:** 1 (inefficient pacing)

### Recommended Action Priority

1. **Fix Issue #1 immediately** - This is a functional bug that rate limits the wrong user
2. **Fix Issue #3** - Voice messages should be protected to avoid account suspension
3. **Fix Issue #2** - Good hygiene for production systems
4. **Evaluate Issue #4** - Depends on threat model; may be acceptable for v1
5. **Optional: Issue #5** - Nice-to-have optimization, not urgent

### Positive Aspects

- Clean separation of concerns (3 classes with single responsibilities)
- Comprehensive error handling in most paths
- Good logging for debugging
- Proper use of async/await patterns
- TypeScript types are correct
- Rate limiting logic itself (sliding window, exponential backoff) is sound
- Integration points are well-chosen (single chokepoint for outbound, trigger check for inbound)

### Overall Assessment

The implementation is **75% production-ready**. Issue #1 must be fixed before deployment as it's a functional bug. Issue #3 should be fixed to avoid WhatsApp account risks. Issues #2, #4, and #5 can be addressed in follow-up work.
