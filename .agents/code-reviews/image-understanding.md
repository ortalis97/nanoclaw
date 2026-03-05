# Code Review: Image Understanding for Alfred

**Date:** 2026-03-05
**Scope:** Image understanding feature — WhatsApp image download, save, and prompt injection

## Stats

- Files Modified: 5
- Files Added: 0
- Files Deleted: 0
- New lines: +316
- Deleted lines: -5

---

## Issues Found

---

```
severity: high
file: src/channels/whatsapp.test.ts
line: 737
issue: "blocks image download from non-allowed sender" test doesn't test what it claims
detail: The test uses vi.doMock() after the module is already loaded. vi.doMock() only
        affects future dynamic imports — it cannot retroactively change the ALLOWED_SENDERS
        value already imported by whatsapp.ts. During this test, ALLOWED_SENDERS remains
        null (from the top-level vi.mock at line 7), so senderIsAllowed = !null = true,
        and downloadImageMessage IS called — not blocked. The test only asserts
        onMessage was called once (which is true on the success path too), so it passes
        for the wrong reason. The critical assertion — expect(downloadImageMessage).not
        .toHaveBeenCalled() — is absent and replaced with a comment acknowledging the
        test doesn't work.
suggestion: Use vi.mocked or per-test config overrides that work with the static import
        pattern. One approach: export ALLOWED_SENDERS as a getter or wrap it in an
        object so it can be mutated per test. Alternatively, restructure the image
        handling to accept ALLOWED_SENDERS as a parameter (already passed to the class
        constructor area) and inject it in tests. At minimum, either make the test
        actually assert downloadImageMessage was not called, or rename it to reflect
        what it actually tests.
```

---

```
severity: medium
file: src/transcription.ts
line: 157
issue: messageId used as filename without path traversal sanitization
detail: The messageId parameter comes from msg.key.id in Baileys, which for legitimate
        WhatsApp clients is a hex string (e.g. "3EB01234ABCD"). However, the code
        does not validate or sanitize it before using it in path.join(imagesDir, filename).
        If a crafted message (e.g. from a modified client) set key.id to something like
        "../../../tmp/evil", the resulting path would be:
            groups/test-group/images/../../../tmp/evil.jpg
        path.join does not prevent traversal when the traversal is in the joined segment.
        resolveGroupFolderPath guards the group folder name but not individual filenames.
        The fallback `img-${Date.now()}` is safe, but msg.key.id is not validated.
suggestion: Add a sanitization step before constructing the filename:
        const safeId = (messageId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
        const filename = `${safeId || `img-${Date.now()}`}.${ext}`;
        This ensures filenames are safe regardless of what Baileys returns.
```

---

```
severity: low
file: src/transcription.ts / src/channels/whatsapp.ts
line: transcription.ts:137, whatsapp.ts:315
issue: Outer catch in whatsapp.ts is dead code for download errors
detail: downloadImageMessage internally catches all errors (line 137) and returns null
        instead of rethrowing. As a result, the catch block in whatsapp.ts (line 315)
        can only fire if some other unexpected exception occurs (e.g. from saveImageToGroup),
        not from download failures. The test for "falls back gracefully when image
        download fails" uses mockRejectedValueOnce to mock the entire function throwing,
        which does exercise the catch block but doesn't reflect production behavior
        where downloadImageMessage always returns null on failure. The error is logged
        via console.error (in transcription.ts) but the whatsapp.ts logger.error for
        "Image download error" never fires for download failures.
suggestion: Either rethrow from downloadImageMessage after logging, or remove the
        outer catch in whatsapp.ts and rely solely on the null check. Rethrowing is
        cleaner:
            } catch (err) {
              console.error('Failed to download image:', err);
              throw err; // let caller handle and log with pino
            }
        This lets whatsapp.ts log with structured pino (consistent with voice error
        handling pattern) and makes the test accurate.
```

---

```
severity: low
file: src/channels/whatsapp.ts
line: 248, 283
issue: isImageMessage called twice per message, normalizeMessageContent called 3x total
detail: For each image message, normalizeMessageContent is called:
        1. Line 192 — main loop normalization (stored as `normalized`, used for content)
        2. Line 248 — inside isImageMessage() for the skip check
        3. Line 283 — inside isImageMessage() for the handling block
        Then downloadImageMessage calls normalizeMessageContent a 4th time at line 116.
        The result of these calls is identical each time for the same msg object.
suggestion: Minor — normalizeMessageContent is cheap. Could pass `normalized` from
        the main loop into a local isImageMessage check instead of re-calling the function,
        but not worth refactoring unless profiling shows it matters.
```

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0     |
| High     | 1     |
| Medium   | 1     |
| Low      | 2     |

The feature logic is sound and follows the voice message pattern well. The primary concern is the broken security test (HIGH) which gives false confidence that unauthorized-sender blocking is tested when it is not. The path traversal issue (MEDIUM) is low real-world risk given WhatsApp's message ID format, but should be guarded defensively.
