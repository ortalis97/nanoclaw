# Plan: Adopt Upstream's JSON-Based Sender Allowlist

**Goal:** Replace our custom `ALLOWED_SENDERS` env var (comma-separated JIDs in `.env`) with upstream's `sender-allowlist.json` file approach, which supports per-chat overrides and `drop` vs `trigger` modes.

**Upstream commit:** `4de981b` (add sender allowlist for per-chat access control)

---

## Architecture Diff

| Aspect | Current (fork) | Target (upstream-aligned) |
|--------|---------------|--------------------------|
| Config source | `ALLOWED_SENDERS` env var | `~/.config/nanoclaw/sender-allowlist.json` |
| Parsing | `src/config.ts` — `Set<string>` | `src/sender-allowlist.ts` — `loadSenderAllowlist()` |
| Gating location | `src/channels/whatsapp.ts` (inside `messages.upsert`) | `src/index.ts` (in `onMessage` callback + trigger checks) |
| Granularity | Binary: allowed or dropped | Per-chat: `drop` (discard) or `trigger` (can see but can't trigger) |
| Image gating | `src/channels/whatsapp.ts` — checks `ALLOWED_SENDERS.has()` | Same file — calls `isSenderAllowed()` |
| Group gating | `hasAllowedMember()` in whatsapp.ts | Per-chat entry in JSON config |
| Auto-registration | Gated by `ALLOWED_SENDERS` in whatsapp.ts | Gated by `shouldDropMessage()` + `isSenderAllowed()` in index.ts |

**Key design decision:** Upstream moved allowlist checks from the channel layer to `index.ts`. We should do the same for the `onMessage` drop-mode check and the trigger-allowed check. However, the image-sender check must stay in `whatsapp.ts` because it needs the raw message object to determine the actual sender (participant vs chatJid).

---

## Steps

### Step 1: Port `src/sender-allowlist.ts` and test file

Copy from upstream verbatim:
- `src/sender-allowlist.ts` — contains `loadSenderAllowlist()`, `isSenderAllowed()`, `shouldDropMessage()`, `isTriggerAllowed()`
- `src/sender-allowlist.test.ts` — full test coverage

Source: `git show upstream/main:src/sender-allowlist.ts` and `git show upstream/main:src/sender-allowlist.test.ts`

No modifications needed -- these files are self-contained with only two imports: `SENDER_ALLOWLIST_PATH` from config and `logger`.

### Step 2: Add `SENDER_ALLOWLIST_PATH` to `src/config.ts`

Add after the `MOUNT_ALLOWLIST_PATH` line:

```ts
export const SENDER_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanoclaw',
  'sender-allowlist.json',
);
```

This matches upstream exactly. The path `~/.config/nanoclaw/` already exists (it holds `mount-allowlist.json`).

### Step 3: Remove `ALLOWED_SENDERS` from `src/config.ts`

- Remove `'ALLOWED_SENDERS'` from the `readEnvFile()` array
- Remove the `ALLOWED_SENDERS` export (the `Set<string> | null` block, lines 24-32)
- Also remove `'ASSISTANT_HEBREW_NAME'` and `'AGENT_MODEL'` from `readEnvFile` only if they also moved upstream (check first -- they didn't, so keep them)

Only remove `ALLOWED_SENDERS` from the `readEnvFile` call and its export.

### Step 4: Update `src/channels/whatsapp.ts` -- remove sender-level gating

**4a. Remove import of `ALLOWED_SENDERS`:**
```diff
- import {
-   ALLOWED_SENDERS,
-   ASSISTANT_HAS_OWN_NUMBER,
-   ASSISTANT_NAME,
-   STORE_DIR,
- } from '../config.js';
+ import {
+   ASSISTANT_HAS_OWN_NUMBER,
+   ASSISTANT_NAME,
+   STORE_DIR,
+ } from '../config.js';
```

**4b. Add import of allowlist functions:**
```ts
import { isSenderAllowed, loadSenderAllowlist } from '../sender-allowlist.js';
```

**4c. Remove the entire `ALLOWED_SENDERS` block in `messages.upsert` (lines 207-216):**

The DM/group-level gating that was here (`if (ALLOWED_SENDERS) { ... }`) will move to `index.ts` step 5. Delete this entire block. Messages now flow through unconditionally at the channel level -- the `onMessage` callback in `index.ts` will handle drop-mode filtering.

**4d. Replace image sender check (lines 291-293):**
```diff
- const senderIsAllowed =
-   !ALLOWED_SENDERS || ALLOWED_SENDERS.has(imageSender);
+ const allowlistCfg = loadSenderAllowlist();
+ const senderIsAllowed = isSenderAllowed(chatJid, imageSender, allowlistCfg);
```

**4e. Remove `hasAllowedMember()` method entirely (lines 470-493):**

This was the group-level check ("does this group have an allowed member?"). The JSON allowlist handles this differently -- per-chat entries define who is allowed in each chat. Remove the entire method and the `groupParticipants` field (used only by this method and `syncGroupMetadata`).

Wait -- `groupParticipants` is also populated in `syncGroupMetadata()` for other purposes. Check: it's only used by `hasAllowedMember()`. So we can remove:
- The `groupParticipants` field declaration
- The `groupParticipants.set()` calls in `syncGroupMetadata()`
- The `hasAllowedMember()` method

### Step 5: Update `src/index.ts` -- add allowlist gating

**5a. Add import:**
```ts
import {
  isSenderAllowed,
  isTriggerAllowed,
  loadSenderAllowlist,
  shouldDropMessage,
} from './sender-allowlist.js';
```

**5b. Remove `ALLOWED_SENDERS` from config import** (it's no longer exported).

**5c. Add drop-mode filtering in `onMessage` callback** (in `main()`, around line 514):

Replace:
```ts
onMessage: (_chatJid: string, msg: NewMessage) => storeMessage(msg),
```

With:
```ts
onMessage: (chatJid: string, msg: NewMessage) => {
  // Sender allowlist drop mode: discard messages from denied senders before storing
  if (!msg.is_from_me && !msg.is_bot_message && registeredGroups[chatJid]) {
    const cfg = loadSenderAllowlist();
    if (
      shouldDropMessage(chatJid, cfg) &&
      !isSenderAllowed(chatJid, msg.sender, cfg)
    ) {
      if (cfg.logDenied) {
        logger.debug(
          { chatJid, sender: msg.sender },
          'sender-allowlist: dropping message (drop mode)',
        );
      }
      return;
    }
  }
  storeMessage(msg);
},
```

**5d. Update trigger checks in `processGroupMessages()`** (around line 184):

Replace:
```ts
const hasTrigger = missedMessages.some((m) =>
  TRIGGER_PATTERN.test(m.content.trim()),
);
```

With:
```ts
const allowlistCfg = loadSenderAllowlist();
const hasTrigger = missedMessages.some(
  (m) =>
    TRIGGER_PATTERN.test(m.content.trim()) &&
    (m.is_from_me || isTriggerAllowed(chatJid, m.sender, allowlistCfg)),
);
```

**5e. Update trigger checks in `startMessageLoop()`** (around line 411):

Same pattern -- replace the `hasTrigger` check with the allowlist-gated version:
```ts
const allowlistCfg = loadSenderAllowlist();
const hasTrigger = groupMessages.some(
  (m) =>
    TRIGGER_PATTERN.test(m.content.trim()) &&
    (m.is_from_me || isTriggerAllowed(chatJid, m.sender, allowlistCfg)),
);
```

**5f. Update auto-registration gating** (around line 229):

Currently, auto-registration in `whatsapp.ts` is implicitly gated by the `ALLOWED_SENDERS` block above it -- if the sender is not allowed, the message is `continue`d before reaching auto-registration.

After moving the gating to `index.ts`, auto-registration happens in the `onAutoRegister` callback. We need to add a check there too:

In `whatsapp.ts`, the `onAutoRegister` call (line 235) should remain as-is. The drop-mode check in the `onMessage` callback (step 5c) handles the gating: if a message from a denied sender in drop mode never gets stored, it never triggers processing.

But we need to gate auto-registration itself. Add a check in `autoRegisterChat()` in index.ts or in the `onAutoRegister` callback. The cleanest approach: in `whatsapp.ts`, before calling `onAutoRegister`, check if the sender is allowed:

Actually, re-examining the flow: in our fork, the `ALLOWED_SENDERS` block in `whatsapp.ts` (lines 207-216) prevents messages from non-allowed senders from ever reaching `onAutoRegister`. If we remove that block, non-allowed senders will trigger auto-registration.

**Solution:** Keep a lightweight check in `whatsapp.ts` at the point where auto-registration is called. Before calling `onAutoRegister`, check:
```ts
// Gate auto-registration: only register for allowed senders
const cfg = loadSenderAllowlist();
const msgSender = msg.key.participant || chatJid;
if (shouldDropMessage(chatJid, cfg) && !isSenderAllowed(chatJid, msgSender, cfg)) {
  continue; // skip this message entirely if in drop mode and sender not allowed
}
```

This replaces the removed `ALLOWED_SENDERS` block. Place it at the same location (after LID translation, before `onChatMetadata`).

### Step 6: Create `sender-allowlist.json` config file

Create `~/.config/nanoclaw/sender-allowlist.json` locally:

```json
{
  "default": {
    "allow": [
      "<OWNER_PHONE>@s.whatsapp.net",
      "<ALLOWED_PHONE_2>@s.whatsapp.net"
    ],
    "mode": "drop"
  },
  "chats": {
    "<ALFRED_PHONE>@s.whatsapp.net": {
      "allow": "*",
      "mode": "trigger"
    }
  },
  "logDenied": true
}
```

Rationale:
- **default:** Only allowed contacts are permitted; unknown senders are dropped (silenced). This matches our current `ALLOWED_SENDERS` behavior.
- **self-chat**: Allow all (`*`) with trigger mode. This is Alfred's own number -- all messages are from "me".
- **logDenied:** true for debugging.

### Step 7: Clean up `.env` and `.env.example`

**`.env.example`:** Remove the `ALLOWED_SENDERS` section (lines 47-53). Add a comment pointing to the JSON file:

```
# --- Sender Allowlist ---
# Per-chat access control is configured in ~/.config/nanoclaw/sender-allowlist.json
# See src/sender-allowlist.ts for the schema.
```

**`.env` (local):** Remove the `ALLOWED_SENDERS=...` line.

### Step 8: Deploy to VM

```bash
source deploy/deploy.conf

# 1. Create the config directory on VM (already exists for mount-allowlist.json)
ssh -i $DEPLOY_KEY $DEPLOY_HOST "mkdir -p ~/.config/nanoclaw"

# 2. Deploy the JSON file
scp -i $DEPLOY_KEY ~/.config/nanoclaw/sender-allowlist.json \
  $DEPLOY_HOST:~/.config/nanoclaw/sender-allowlist.json

# 3. Remove ALLOWED_SENDERS from VM .env
ssh -i $DEPLOY_KEY $DEPLOY_HOST \
  "sed -i '/^ALLOWED_SENDERS/d' /opt/nanoclaw/.env"

# 4. Deploy code changes
bash deploy/deploy-changes.sh
```

### Step 9: Build and test

```bash
# Local
npm run build
npm test  # runs vitest -- sender-allowlist.test.ts should pass

# VM verification
source deploy/deploy.conf
ssh -i $DEPLOY_KEY $DEPLOY_HOST \
  "sudo systemctl status nanoclaw && tail -20 /opt/nanoclaw/logs/nanoclaw.log"
```

Test cases:
1. Send a message from the owner's DM -- should be processed normally
2. (If possible) Have an unknown number message -- should be silently dropped
3. Self-chat messages should work (allow: *)

---

## Files Modified

| File | Action |
|------|--------|
| `src/sender-allowlist.ts` | **NEW** -- copied from upstream |
| `src/sender-allowlist.test.ts` | **NEW** -- copied from upstream |
| `src/config.ts` | Add `SENDER_ALLOWLIST_PATH`, remove `ALLOWED_SENDERS` |
| `src/channels/whatsapp.ts` | Remove `ALLOWED_SENDERS` gating, use `isSenderAllowed()` for images, remove `hasAllowedMember()`, remove `groupParticipants` |
| `src/index.ts` | Add allowlist imports, add drop-mode in `onMessage`, add `isTriggerAllowed` in trigger checks |
| `.env.example` | Replace `ALLOWED_SENDERS` block with pointer to JSON file |
| `~/.config/nanoclaw/sender-allowlist.json` | **NEW** -- local config (not in git) |

## Files NOT Modified

- `src/index.ts` auto-registration logic -- no changes needed since drop-mode filtering in `onMessage` prevents unauthorized messages from being stored, which prevents them from triggering agent processing
- Upstream's channel registry refactor -- we are NOT adopting that; we keep our `WhatsAppChannel` in `src/channels/whatsapp.ts`

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Missing sender-allowlist.json on VM | `loadSenderAllowlist()` returns allow-all defaults when file is missing -- safe fallback |
| Breaking auto-registration for allowed senders | The drop-mode check is in `onMessage`, which only filters stored messages. Auto-registration in `whatsapp.ts` still fires for any message that reaches the handler. If a chat is in drop mode, auto-registration still happens but messages get silently dropped before storage -- acceptable. |
| Image gating regression | Replace `ALLOWED_SENDERS.has()` with `isSenderAllowed()` -- same behavior, different source |
| LID translation for allowlist | Image sender check already uses translated chatJid for DMs. The allowlist JSON uses phone JIDs, matching post-translation values. |

## Commit Plan

Single commit: `feat: adopt upstream JSON-based sender allowlist (replaces ALLOWED_SENDERS env var)`
