# Code Review: Sender Allowlist Migration (d84ac41)

Reviewed commit: `d84ac41 feat: adopt upstream JSON-based sender allowlist (replaces ALLOWED_SENDERS env var)`

## Stats

- Files Modified: 6 (`src/config.ts`, `src/channels/whatsapp.ts`, `src/channels/whatsapp.test.ts`, `src/index.ts`, `.env.example`, `src/image-cleanup.ts`)
- Files Added: 2 (`src/sender-allowlist.ts`, `src/sender-allowlist.test.ts`)
- Files Deleted: 0
- New lines: +446
- Deleted lines: -89
- All 369 tests pass ✓

---

## Issues Found

---

```
severity: medium
file: src/channels/whatsapp.ts
line: 225-227
issue: Group participant JID not LID-translated before allowlist check
detail: In the auto-registration gate, `msgSender` for groups uses
  `msg.key.participant || msg.key.remoteJid || ''`. In newer WhatsApp versions
  (LID migration), `msg.key.participant` can be a LID JID (e.g., `xyz@lid`)
  instead of a phone JID. The allowlist config stores phone JIDs
  (e.g., `OWNER_PHONE_REDACTED@s.whatsapp.net`). The comparison
  `isSenderAllowed(chatJid, 'xyz@lid', cfg)` always returns false for any
  non-'*' allow list, so a valid group with allowed members will never
  auto-register when participants are addressed via LID JIDs.

  The old `hasAllowedMember()` method explicitly called
  `await this.translateJid(memberId)` for each participant before comparing
  to the allowlist. The new code does not translate.

  Note: For DMs, `msg.key.participant` is null, so `msg.key.remoteJid` is
  used — and for DMs, `remoteJid` is typically already a phone JID, so
  DMs are unaffected.
suggestion: For groups, use `await this.translateJid(msg.key.participant || '')`
  before the allowlist check. Since the surrounding loop is already in an async
  context (`messages.upsert` handler is async), the await is safe:

  const rawSender = isGroup
    ? msg.key.participant || msg.key.remoteJid || ''
    : chatJid; // chatJid is already LID-translated
  const msgSender = isGroup ? await this.translateJid(rawSender) : rawSender;
```

---

```
severity: medium
file: src/index.ts
line: 533
issue: Message drop check uses un-translated sender JID for group messages
detail: The `onMessage` callback (line 533) calls
  `isSenderAllowed(chatJid, msg.sender, cfg)`. For group messages,
  `msg.sender` is set from `msg.key.participant || msg.key.remoteJid` in
  whatsapp.ts (line 257) — the participant JID is NOT translated via
  `translateJid()` before being stored in the message object.

  If a group participant has a LID JID, `msg.sender` will be a LID
  (e.g. `xyz@lid`), which will not match any phone-JID allow list entry.
  This means allowed group participants' messages get dropped in drop-mode
  chats even though they should be stored.

  In practice, the current deployment has the self-chat set to `allow: '*'`
  (per-chat override) so messages are never dropped there, but any future
  registered group using the default drop mode would be silently broken for
  LID participants.
suggestion: Translate the sender JID in whatsapp.ts before building the
  NewMessage object, or do the translation inside the onMessage drop check.
  The cleanest fix is at the source — in `whatsapp.ts` around line 257:

  const rawSender = msg.key.participant || msg.key.remoteJid || '';
  const sender = isGroup ? await this.translateJid(rawSender) : rawSender;

  This requires making that block await — the surrounding handler is already
  async so this is safe.
```

---

```
severity: low
file: src/index.ts
line: 432-433
issue: Rate-limit sender is the first trigger pattern match, not the allowed trigger sender
detail: `hasTrigger` (line 421) finds a trigger message that also passes
  isTriggerAllowed. But `triggerMessage` at line 432 uses a separate
  `.find()` that only matches the trigger pattern with no allowlist check.

  If a non-allowed sender sends `@Alfred` before an allowed sender does,
  `hasTrigger` = true (because the allowed sender's message matches), but
  `triggerMessage` = the non-allowed sender's message (first pattern match).
  The rate limiter then charges the non-allowed sender instead of the allowed one.

  This is a pre-existing architectural issue that the allowlist adds a new
  dimension to — before, there was no need to distinguish "which trigger
  sender" since all stored messages were from allowed senders. Now trigger
  messages from non-allowed senders can exist in the DB (trigger-mode chats
  store all messages), making this mismatch possible.
suggestion: Use the same allowlist-aware lookup for the rate-limit sender:

  const triggerMessage = needsTrigger
    ? groupMessages.find(
        (m) =>
          TRIGGER_PATTERN.test(m.content.trim()) &&
          (m.is_from_me || isTriggerAllowed(chatJid, m.sender, allowlistCfg)),
      )
    : groupMessages[0];
```

---

```
severity: low
file: src/index.ts
line: 47
issue: Non-alphabetical import order for isSenderAllowed
detail: The import block orders isTriggerAllowed, loadSenderAllowlist,
  shouldDropMessage, then isSenderAllowed — breaking the alphabetical
  convention used throughout the file.
suggestion: Reorder to: isSenderAllowed, isTriggerAllowed, loadSenderAllowlist, shouldDropMessage
```

---

## Positives

- **Fail-closed default is correct**: `DEFAULT_CONFIG = { allow: [], mode: 'drop' }` prevents
  accidental open access if the config file is missing or corrupt. This is a meaningful
  improvement over upstream's allow-all default.

- **Robust validation**: `isValidEntry()` validates both the `allow` field (type-checks array
  items) and `mode`. Invalid per-chat entries are skipped individually rather than rejecting the
  whole file. `logDenied` defaults to `true` via `obj.logDenied !== false`.

- **Auto-registration gating preserved**: The lightweight gating in `whatsapp.ts` before
  `onAutoRegister` correctly prevents unknown senders from causing group registration.

- **Test coverage is thorough**: 17 unit tests cover all fail-closed paths (missing file, invalid
  JSON, invalid schema, non-string array items, invalid per-chat entries), the three exported
  functions, and per-chat overrides. The tmp-dir test pattern is clean.

- **`processGroupMessages` allowlist load is correct**: Loading the config inside the function
  (not at module init) ensures config hot-reloads without restart.

## Summary

Two medium issues relate to **LID JIDs not being translated** before allowlist checks — one in the
auto-registration gate (whatsapp.ts) and one in the onMessage drop filter (index.ts). These were
present in the original image-sender check as well (not a regression for that specific check), but
the new drop-mode filter in `onMessage` is a new code path that has the same gap.

The issues are unlikely to affect the current deployment (the self-chat uses `allow: '*'`, and
DMs use phone JIDs rather than LIDs), but they represent a correctness gap for group-based drop
filtering.
