# Code Review: OAuth-First Auth with API Key Fallback (+ Rate Limiter & Backoff Fixes)

**Reviewed by:** Claude Code (code-review-patterns skill)
**Date:** 2026-03-04
**Files reviewed:**
- `container/agent-runner/src/index.ts` (primary focus: OAuth fallback)
- `src/rate-limiter.ts`
- `src/index.ts`
- `src/channels/whatsapp.ts`
- `src/container-runner.ts`
- `src/channels/whatsapp.test.ts`
- `groups/global/CLAUDE.md`
- `CLAUDE.md`

---

## Stage 1: Spec Compliance

**Requirements (from task description):**
- [x] `isAuthError()` helper with regex patterns — implemented at `container/agent-runner/src/index.ts:61-74`
- [x] `runQueryWithFallback()` wrapper that retries with API key on auth error — implemented at `container/agent-runner/src/index.ts:520-541`
- [x] Query loop calls `runQueryWithFallback()` instead of `runQuery()` — implemented at `container/agent-runner/src/index.ts:594`
- [x] `startRateLimiterCleanup` now returns `NodeJS.Timeout` for clean shutdown — `src/rate-limiter.ts:165-175`
- [x] `messagePacer.pace()` moved inside `backoff.execute()` for all send paths — `src/channels/whatsapp.ts:309-314`, `328-336`, `480-484`
- [x] Per-user rate limiter wired into main message loop — `src/index.ts:57-58`, `412-427`

**Verdict:** Meets spec.

---

## Stage 2: Code Quality

---

### ISSUE 1 — Regex pattern `/expired/i` is too broad

```
severity: high
file: container/agent-runner/src/index.ts
line: 65
issue: Regex /expired/ matches legitimate non-auth errors containing "expired"
detail: The pattern "/expired/i" is not scoped to token/credential expiry.
        It will match error messages like "Operation expired", "Request expired",
        "Session expired (idle timeout)", or any third-party SDK error that contains
        the word "expired" in context unrelated to authentication. This triggers a
        silent OAuth-to-API-key fallback and logs an incorrect diagnosis. In a
        long-running container where the session truly timed out or the agent SDK
        raised a timeout error, the fallback consumes the API key silently.
suggestion: Scope the pattern to token/credential expiry contexts:
            /token.*expired|expired.*token|credential.*expired|session.*expired.*auth/i
            or separate it into two specific patterns. Remove the bare /expired/i.
```

---

### ISSUE 2 — Rate limit check consumes a token for a request that may already be in-flight

```
severity: medium
file: src/index.ts
line: 421
issue: checkLimit() is called (and records the attempt) even when the queue already has an active container for that chat
detail: The rate limit check at line 421 runs BEFORE the queue.sendMessage() /
        queue.startContainer() branch at line 440. The check records a timestamp
        in the per-user history unconditionally. But if queue.sendMessage() at
        line 440 succeeds (piping into an existing container), the prior trigger
        that STARTED that container already consumed a rate limit slot. So a
        follow-up IPC message (valid continuation of the same conversation) eats
        another slot out of the user's 3-per-minute budget. Users who send follow-
        up messages to an active session are unfairly penalised.
suggestion: Move the rate limit check to only the branch where a new container
            is being started (i.e., inside the else branch that calls
            queue.startContainer), not before queue.sendMessage(). IPC pipe-ins
            to an existing container should bypass the per-trigger rate limit.
```

---

### ISSUE 3 — sdkEnv mutation is non-local and hard to reason about

```
severity: low
file: container/agent-runner/src/index.ts
line: 536
issue: delete sdkEnv['CLAUDE_CODE_OAUTH_TOKEN'] mutates a shared object; the
       comment calls this "sticky" but this is an implicit side-effect
detail: The function's JSDoc comment documents the sticky mutation, which is
        intentional per design. However, mutating the passed-in object instead of
        returning a modified copy makes the function impure and harder to test in
        isolation. The caller at line 594 passes the same sdkEnv on every loop
        iteration, so after a single fallback the token is permanently gone from
        sdkEnv for all future iterations — which is the goal, but a future
        refactor could easily break this invariant by passing a fresh copy.
suggestion: Either: (a) keep as-is and accept the documented contract, or
            (b) have runQueryWithFallback() return an updated sdkEnv and let the
            caller update its own variable:
              const { sdkEnv: updatedEnv, ...result } = await runQueryWithFallback(...)
              sdkEnv = updatedEnv;
            Option (b) makes the side-effect explicit without hiding it in a delete.
```

---

### ISSUE 4 — messagePacer.pace() inside backoff.execute() causes pacing on every retry attempt

```
severity: low
file: src/channels/whatsapp.ts
line: 309-314 (and 328-336, 480-484)
issue: pace() is now called inside execute()'s retry lambda, so a 440-triggered
       retry waits the pacing delay AGAIN on top of the exponential backoff delay
detail: Before this change, pace() ran once before the send attempt. Now that
        pace() is inside execute()'s fn lambda, every retry of fn() calls pace()
        again. The pacing delay is typically 1.5-3 seconds; with 3 retries and
        exponential backoff starting at 2s, a worst-case retry sequence adds
        3 × (1.5-3s) of extra pacing on top of (2s + 4s + 8s) backoff. This
        is probably acceptable operationally (it just means slower retries) and
        not harmful, but it is a latency regression on retry paths.
        NOTE: This placement IS correct for ensuring pacing is honored on retries
        too. The trade-off is documented here for awareness.
suggestion: Accept this as a reasonable trade-off (pacing on retries is safe
            and conservative) or call pace() once before execute() and remove
            it from inside the lambda if retry pacing is undesirable.
```

---

### ISSUE 5 — No user feedback when rate limited

```
severity: low
file: src/index.ts
line: 421-426
issue: Rate-limited users receive no response — the trigger is silently dropped
detail: When checkLimit() returns false, the code logs at INFO level and
        continues to the next group. The user who sent @Alfred never gets any
        indication they were rate limited. From their perspective, the bot just
        ignored them. This is a UX gap, especially for legitimate users who
        accidentally spam during testing.
suggestion: Optionally send a short reply to the user via the channel before
            continuing:
              channel.sendMessage(chatJid,
                'Too many requests. Please wait a moment before trying again.');
            This is optional — silent dropping is a valid anti-spam choice — but
            worth a deliberate decision.
```

---

## Summary

**Decision:** Changes Requested (1 high, 3 low, 1 medium)

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 1 |
| Medium | 1 |
| Low | 3 |

**Required fixes before merge:**
1. Scope the `/expired/i` regex to credential/token expiry contexts to prevent false-positive OAuth fallbacks (Issue 1 — high confidence, high severity).

**Acceptable as-is or advisory:**
- Issue 2 (medium): Rate limit token consumption on IPC pipe-ins. Worth fixing but not blocking.
- Issues 3, 4, 5 (low): Documented trade-offs or minor UX gaps.

---

## SIGNAL_SCORES

```
SIGNAL_SCORES:
  security: [HARD] 90    — No secrets exposed; OAuth token deletion is correct;
                           false-positive auth fallback risk is non-critical
  correctness: [HARD] 80 — Core OAuth fallback logic is sound; /expired/ regex
                           false-positive is a logic concern not a crash
  performance: [SOFT] 80 — Pacing inside backoff is a latency regression on
                           retries but operationally safe
  maintainability: [SOFT] 85 — sdkEnv mutation is documented but impure
CONFIDENCE: 80  (min HARD=80, avg SOFT=82.5)
```

