# Code Review: Group-Membership-Aware Allowlist (b7a71a4)

**Date:** 2026-03-07
**Scope:** Group membership allowlist feature — `src/sender-allowlist.ts`, `src/channels/whatsapp.ts`, `src/index.ts`, `src/types.ts`

## Stats

- Files Modified: 8
- Files Added: 1 (`.agents/code-reviews/send-file-feature.md`)
- Files Deleted: 0
- New lines: +291
- Deleted lines: -52

---

## Issues

---

```
severity: medium
file: src/channels/whatsapp.ts
line: 297-302
issue: Image download still uses per-sender allowlist check in groups — inconsistent with text message behavior
detail: After this change, text messages from any group member are stored and processed
  when an allowed member is in the group. However, the image download block still
  checks isSenderAllowed() per-sender:

    const senderIsAllowed = isSenderAllowed(chatJid, imageSender, allowlistCfg);

  Result: if an unauthorized member sends a photo in the group, it's rejected with
  "[Image from unauthorized sender — Alfred can only process images from allowed users]",
  while their text messages flow through fine. The inconsistency will be confusing — Alfred
  reads their texts but ignores their images.
suggestion: Apply the same group membership logic to image handling. Replace the
  isSenderAllowed check with:

    const isGroup = chatJid.endsWith('@g.us');
    const senderIsAllowed = isGroup
      ? isAnyMemberAllowed(chatJid, await this.getGroupParticipants(chatJid), allowlistCfg)
      : isSenderAllowed(chatJid, imageSender, allowlistCfg);

  This requires importing isAnyMemberAllowed (already imported) and making the block async
  (it already is — the parent handler is async).
```

---

```
severity: medium
file: src/channels/whatsapp.ts
line: 505-521
issue: Participant cache never invalidated on group membership changes
detail: groupParticipantsCache is populated on startup and every 24 hours via
  syncGroupMetadata(). Baileys emits a 'groups.update' or 'group-participants.update' event
  when membership changes, but the cache is never invalidated in response.

  Two security-relevant scenarios:
  1. An allowed member leaves the group → cache still shows them as a participant for up to
     24h → Alfred continues responding to everyone in that group when it should stop.
  2. A new allowed member joins a newly seen group → cache miss → on-demand fetch captures
     them correctly (getGroupParticipants falls through to groupMetadata). This case is OK
     because cache miss triggers a fresh fetch.

  Scenario 1 is the concerning one: stale allowance after an allowed member leaves.
suggestion: Subscribe to Baileys group participant events and invalidate (or update) the cache:

    this.sock.ev.on('group-participants.update', ({ id }) => {
      this.groupParticipantsCache.delete(id);
    });

  Deleting the entry forces a fresh fetch on the next message, capturing the updated
  membership. Add this in connectInternal() alongside the other ev.on subscriptions.
```

---

```
severity: low
file: src/index.ts
line: 561-590
issue: Async onMessage callback is fire-and-forget with no unhandled rejection handling
detail: whatsapp.ts calls opts.onMessage(...) without awaiting the returned Promise
  (line 344 of whatsapp.ts). The OnInboundMessage type now returns void | Promise<void>
  but the call site does not attach a .catch(). If the async onMessage ever throws
  (e.g., a future change adds a fallible operation), the error is silently swallowed
  and the message is neither stored nor surfaced in logs.

  Current code paths are safe: getGroupParticipants() has its own try-catch, storeMessage
  is synchronous, and the pure allowlist functions can't throw. But the architectural
  pattern creates a silent exception trap for future modifications.
suggestion: Add a catch at the call site in whatsapp.ts:

    const result = this.opts.onMessage(chatJid, { ... });
    if (result instanceof Promise) {
      result.catch((err) =>
        logger.error({ err, chatJid }, 'onMessage callback threw'),
      );
    }

  Or simply: Promise.resolve(this.opts.onMessage(chatJid, { ... })).catch((err) => ...)
```

---

```
severity: low
file: src/channels/whatsapp.ts
line: 436-442 (index.ts startMessageLoop)
issue: getGroupParticipants called on every message loop iteration for groups with messages
detail: In startMessageLoop, for each chatJid in messagesByGroup, getGroupParticipants is
  awaited unconditionally for @g.us chats (short-circuit guards DMs correctly). Since the
  function returns from the in-memory Map cache synchronously (wrapped in a resolved
  Promise), this is fast. But it forces an async tick per group per polling cycle even
  when no allowlist check is needed (e.g., main group with requiresTrigger=false still
  hits getGroupParticipants, computes groupHasAllowedMember, but then the needsTrigger
  check is false and groupHasAllowedMember is unused).

  Not a correctness issue — just unnecessary async overhead on each iteration.
suggestion: Move the getGroupParticipants call inside the needsTrigger block:

    if (needsTrigger) {
      const groupHasAllowedMember =
        chatJid.endsWith('@g.us') &&
        isAnyMemberAllowed(chatJid, await whatsapp.getGroupParticipants(chatJid), allowlistCfg);
      const hasTrigger = groupMessages.some(...);
      ...
    }

  Same refactor applies to processGroupMessages (already scoped inside the requiresTrigger
  block there — ✓ correct). Only startMessageLoop has this issue.
```

---

## Notes

**Core logic is correct.** The three-layer approach (auto-registration gate in whatsapp.ts,
message storage in onMessage, trigger detection in processGroupMessages/startMessageLoop)
is consistent — all three now use group membership awareness.

**DM behavior is unchanged.** The `chatJid.endsWith('@g.us')` guards are correctly placed in
all relevant code paths. DMs continue to use per-sender allowlist checks.

**LID translation in participant cache is correct.** translateJid() returns immediately for
non-LID JIDs (`!jid.endsWith('@lid')` early-return), so the O(n) loop over participants adds
negligible overhead for normal phone-JID participants.

**isAnyMemberAllowed is clean.** Pure function, short-circuits on first allowed member,
correct Iterable<string> signature that works with Set<string>.

**Short-circuit behavior of `&&` with `await` is correct.** JavaScript short-circuits before
evaluating the right-hand side of `&&`, so `chatJid.endsWith('@g.us') && await getGroupParticipants(...)`
does NOT call getGroupParticipants for non-group chats.
