# Plan: Contribute Image Understanding Skill to Upstream NanoClaw

## Overview

Package our working image understanding feature as a pluggable skill in upstream's `.claude/skills/add-image-understanding/` directory, following the exact conventions of `add-voice-transcription`. Submit as a PR to `qwibitai/nanoclaw`.

---

## File Tree

```
.claude/skills/add-image-understanding/
  SKILL.md                                          # Interactive guide (phases)
  manifest.yaml                                     # Skill metadata
  add/
    src/image-handler.ts                            # isImageMessage, downloadImageMessage, saveImageToGroup
    src/image-cleanup.ts                            # cleanupOldImages, startImageCleanup
  modify/
    src/channels/whatsapp.ts                        # Full file with image handling added
    src/channels/whatsapp.ts.intent.md              # What changed + invariants
    src/channels/whatsapp.test.ts                   # Full file with image test cases added
    src/channels/whatsapp.test.ts.intent.md         # What changed + invariants
    src/index.ts                                    # Full file with cleanup timer added
    src/index.ts.intent.md                          # What changed + invariants
    groups/global/CLAUDE.md                         # Full file with image instructions added
    groups/global/CLAUDE.md.intent.md               # What changed + invariants
  tests/
    image-understanding.test.ts                     # Skill package validation tests
```

---

## File Contents Outline

### `manifest.yaml`

```yaml
skill: image-understanding
version: 1.0.0
description: "Image understanding — download, save, and prompt agent to view WhatsApp images"
core_version: 0.1.0
adds:
  - src/image-handler.ts
  - src/image-cleanup.ts
modifies:
  - src/channels/whatsapp.ts
  - src/channels/whatsapp.test.ts
  - src/index.ts
  - groups/global/CLAUDE.md
structured:
  npm_dependencies: {}         # No new deps — uses Baileys' downloadMediaMessage (already a dep via add-whatsapp)
  env_additions: []            # No new env vars
conflicts: []
depends: []                    # Works independently of voice-transcription
test: "npx vitest run src/channels/whatsapp.test.ts"
```

**Key decisions:**
- `npm_dependencies: {}` — Baileys is already installed by add-whatsapp skill
- `env_additions: []` — no API key needed (uses Baileys built-in download)
- `depends: []` — does NOT depend on voice-transcription (works with or without it)
- `conflicts: []` — coexists with voice-transcription (separate code paths)

### `add/src/image-handler.ts`

New file. Contains three functions extracted from our `src/transcription.ts` lines 107-161. Does NOT go in `transcription.ts` to avoid conflicts with voice-transcription skill.

```typescript
import fs from 'fs';
import path from 'path';
import {
  downloadMediaMessage,
  normalizeMessageContent,
  WAMessage,
  WASocket,
} from '@whiskeysockets/baileys';
import { resolveGroupFolderPath } from './group-folder.js';

export function isImageMessage(msg: WAMessage): boolean { ... }
export async function downloadImageMessage(msg: WAMessage, sock: WASocket): Promise<{buffer: Buffer; mimetype: string} | null> { ... }
export function saveImageToGroup(groupFolder: string, buffer: Buffer, mimetype: string, messageId: string): string { ... }
```

**Differences from our fork's implementation:**
- Uses `normalizeMessageContent` from Baileys for robust message unwrapping
- Imports `resolveGroupFolderPath` from `./group-folder.js` (upstream's path utility)
- Returns container-relative path: `/workspace/group/images/<filename>`
- No dependency on our fork's `ALLOWED_SENDERS` env var

### `add/src/image-cleanup.ts`

New file. Copied from our `src/image-cleanup.ts` with minimal changes.

```typescript
import fs from 'fs';
import path from 'path';
import { GROUPS_DIR } from './config.js';
import { isValidGroupFolder } from './group-folder.js';
import { logger } from './logger.js';

export function cleanupOldImages(maxAgeMs?: number): number { ... }
export function startImageCleanup(): NodeJS.Timeout { ... }
```

**Unchanged from our fork** -- uses upstream's `GROUPS_DIR`, `isValidGroupFolder`, `logger`. These all exist in upstream already.

### `modify/src/channels/whatsapp.ts`

Full file = upstream's **voice-transcription version** + image handling additions.

**Base:** `.claude/skills/add-voice-transcription/modify/src/channels/whatsapp.ts` (366 lines on upstream/main). This is the correct base because:
- add-whatsapp creates the base whatsapp.ts
- add-voice-transcription modifies it (adds voice handling + `finalContent` variable)
- add-image-understanding modifies it further (adds image handling after voice handling)

**Changes to make on top of voice-transcription version:**

1. **Imports (top of file):** Add:
   ```typescript
   import { isImageMessage, downloadImageMessage, saveImageToGroup } from '../image-handler.js';
   import { isSenderAllowed, loadSenderAllowlist } from '../sender-allowlist.js';
   ```

2. **Content skip guard (line ~186):** Change:
   ```typescript
   // FROM:
   if (!content && !isVoiceMessage(msg)) continue;
   // TO:
   if (!content && !isVoiceMessage(msg) && !isImageMessage(msg)) continue;
   ```

3. **Image handling block (after voice handling, before `this.opts.onMessage`):** Add:
   ```typescript
   // Handle image messages
   if (isImageMessage(msg)) {
     const imageSender = isGroup
       ? msg.key.participant || msg.key.remoteJid || ''
       : chatJid;
     const allowlistCfg = loadSenderAllowlist();
     const senderIsAllowed = isSenderAllowed(chatJid, imageSender, allowlistCfg);

     if (senderIsAllowed) {
       try {
         const imageData = await downloadImageMessage(msg, this.sock);
         if (imageData) {
           const group = groups[chatJid];
           if (group) {
             const imagePath = saveImageToGroup(
               group.folder, imageData.buffer, imageData.mimetype,
               msg.key.id || `img-${Date.now()}`
             );
             const caption = content ? ` with caption: "${content}"` : '';
             finalContent = `[Image${caption} — view it by reading: ${imagePath}]`;
             logger.info({ chatJid, sender: imageSender, size: imageData.buffer.length, mimetype: imageData.mimetype }, 'Downloaded and saved image');
           }
         } else {
           finalContent = content || '[Image - download failed]';
         }
       } catch (err) {
         logger.error({ err, chatJid }, 'Image download error');
         finalContent = content || '[Image - download failed]';
       }
     } else {
       finalContent = content || '[Image from unauthorized sender]';
     }
   }
   ```

**Key difference from our fork:** Uses `isSenderAllowed(chatJid, imageSender, loadSenderAllowlist())` instead of our fork's `ALLOWED_SENDERS` env var Set. This matches upstream's JSON-based sender-allowlist pattern.

### `modify/src/channels/whatsapp.ts.intent.md`

```markdown
# Intent: src/channels/whatsapp.ts modifications

## What changed
Added image message handling. When an image arrives, it is downloaded via Baileys,
saved to the group's images/ directory, and the agent receives a prompt to read the
file path. Sender allowlist is checked before downloading.

## Key sections

### Imports (top of file)
- Added: `isImageMessage`, `downloadImageMessage`, `saveImageToGroup` from `../image-handler.js`
- Added: `isSenderAllowed`, `loadSenderAllowlist` from `../sender-allowlist.js`

### Content skip guard
- Changed: `if (!content && !isVoiceMessage(msg)) continue;`
  → `if (!content && !isVoiceMessage(msg) && !isImageMessage(msg)) continue;`
  (image messages may have no text content but should still be processed)

### messages.upsert handler (after voice handling block)
- Added: `isImageMessage(msg)` check
- Added: sender allowlist check via `isSenderAllowed()`
- Added: try/catch calling `downloadImageMessage()` + `saveImageToGroup()`
  - Success: `finalContent = '[Image with caption: "..." — view it by reading: /workspace/group/images/file.jpg]'`
  - Download fail: `finalContent = content || '[Image - download failed]'`
  - Unauthorized: `finalContent = content || '[Image from unauthorized sender]'`

## Invariants (must-keep)
- All existing message handling (conversation, extendedTextMessage, videoMessage) unchanged
- Voice transcription handling unchanged (isVoiceMessage block untouched)
- Connection lifecycle (connect, reconnect, disconnect) unchanged
- LID translation logic unchanged
- Outgoing message queue unchanged
- Group metadata sync unchanged
- sendMessage prefix logic unchanged
- setTyping, ownsJid, isConnected — all unchanged
```

### `modify/src/channels/whatsapp.test.ts`

Full file = upstream's voice-transcription test version + image test cases.

**Changes to make:**

1. **Mock section:** Add `image-handler.js` mock:
   ```typescript
   vi.mock('../image-handler.js', () => ({
     isImageMessage: vi.fn((msg: any) => msg.message?.imageMessage != null),
     downloadImageMessage: vi.fn().mockResolvedValue({
       buffer: Buffer.from('fake-image-data'),
       mimetype: 'image/jpeg',
     }),
     saveImageToGroup: vi.fn().mockReturnValue('/workspace/group/images/test.jpg'),
   }));
   ```

2. **Mock section:** Add `sender-allowlist.js` mock:
   ```typescript
   vi.mock('../sender-allowlist.js', () => ({
     isSenderAllowed: vi.fn(() => true),
     loadSenderAllowlist: vi.fn(() => ({ default: { allow: '*', mode: 'trigger' }, chats: {}, logDenied: false })),
   }));
   ```

3. **Imports:** Add:
   ```typescript
   import { downloadImageMessage, saveImageToGroup } from '../image-handler.js';
   import { isSenderAllowed } from '../sender-allowlist.js';
   ```

4. **Test cases** (inside "message handling" describe block): Add 5 tests:
   - `downloads and saves image from allowed sender` — image with no caption, expects `[Image — view it by reading: ...]`
   - `includes caption alongside image path` — image with caption, expects `[Image with caption: "..." — view it by reading: ...]`
   - `blocks image download from non-allowed sender` — `isSenderAllowed` returns false, expects `downloadImageMessage` NOT called
   - `does not skip image without caption` — image-only message (no text), verifies it passes through content skip guard
   - `falls back gracefully when image download fails` — `downloadImageMessage` rejects, expects `[Image - download failed]`

### `modify/src/channels/whatsapp.test.ts.intent.md`

```markdown
# Intent: src/channels/whatsapp.test.ts modifications

## What changed
Added mocks for image-handler and sender-allowlist modules, and 5 test cases for image handling.

## Key sections

### Mocks (top of file)
- Added: `vi.mock('../image-handler.js', ...)` with isImageMessage, downloadImageMessage, saveImageToGroup
- Added: `vi.mock('../sender-allowlist.js', ...)` with isSenderAllowed, loadSenderAllowlist
- Added: imports for downloadImageMessage, saveImageToGroup, isSenderAllowed

### Test cases (inside "message handling" describe block)
- Added: "downloads and saves image from allowed sender"
- Added: "includes caption alongside image path"
- Added: "blocks image download from non-allowed sender"
- Added: "does not skip image without caption"
- Added: "falls back gracefully when image download fails"

## Invariants (must-keep)
- All existing test cases for text, extendedTextMessage, videoMessage unchanged
- All voice transcription test cases unchanged
- All connection lifecycle tests unchanged
- All LID translation tests unchanged
- All outgoing queue tests unchanged
- All existing mocks (config, logger, db, fs, child_process, baileys, transcription) unchanged
- Test helpers (createTestOpts, triggerConnection, triggerDisconnect, triggerMessages, connectChannel) unchanged
```

### `modify/src/index.ts`

Full file = upstream's `src/index.ts` + image cleanup import + timer start + timer clear.

**Changes:**

1. **Imports:** Add:
   ```typescript
   import { startImageCleanup } from './image-cleanup.js';
   ```

2. **Module-level variable:** Add:
   ```typescript
   let imageCleanupTimer: NodeJS.Timeout | undefined;
   ```

3. **In startup function** (where message loop starts): Add:
   ```typescript
   imageCleanupTimer = startImageCleanup();
   ```

4. **In shutdown handler:** Add:
   ```typescript
   if (imageCleanupTimer) clearInterval(imageCleanupTimer);
   ```

### `modify/src/index.ts.intent.md`

```markdown
# Intent: src/index.ts modifications

## What changed
Added image cleanup lifecycle — starts a weekly timer that deletes images older than 30 days
from all group images/ directories. Timer is cleared on shutdown.

## Key sections

### Imports
- Added: `startImageCleanup` from `./image-cleanup.js`

### Module-level state
- Added: `let imageCleanupTimer: NodeJS.Timeout | undefined;`

### Startup
- Added: `imageCleanupTimer = startImageCleanup();` (runs cleanup once, then every 7 days)

### Shutdown
- Added: `if (imageCleanupTimer) clearInterval(imageCleanupTimer);`

## Invariants (must-keep)
- All existing imports unchanged
- Channel registration, message loop, container runner — all unchanged
- Task scheduler, IPC watcher — unchanged
- All other shutdown cleanup — unchanged
```

### `modify/groups/global/CLAUDE.md`

Full file = upstream's `groups/global/CLAUDE.md` + Images section added before Message Formatting.

**Addition** (insert after "## Memory" section, before "## Message Formatting"):

```markdown
## Images

When a user sends an image, you'll see a message like `[Image — view it by reading: /workspace/group/images/filename.jpg]`. Use the `Read` tool to view the image, then respond about what you see. If the message includes a caption (e.g. `[Image with caption: "What is this?" — view it by reading: ...]`), treat the caption as the user's question about the image.

Images from unauthorized senders appear as `[Image from unauthorized sender]`. Let the user know the image could not be processed.
```

**Note:** Upstream uses "Andy" as assistant name; keep "Andy" in the upstream version (not "Alfred"). Do NOT mention specific user names (Or, Maya) -- keep it generic.

### `modify/groups/global/CLAUDE.md.intent.md`

```markdown
# Intent: groups/global/CLAUDE.md modifications

## What changed
Added an "Images" section that instructs the agent how to handle image messages
(reading the file path, interpreting captions, handling unauthorized senders).

## Key sections
- Added: "## Images" section between "## Memory" and "## Message Formatting"

## Invariants (must-keep)
- All existing sections unchanged (assistant name, what you can do, communication, workspace, memory, message formatting)
- No changes to assistant name or personality
```

### `tests/image-understanding.test.ts`

Skill package validation tests (same pattern as `tests/voice-transcription.test.ts`).

```typescript
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('image-understanding skill package', () => {
  const skillDir = path.resolve(__dirname, '..');

  it('has a valid manifest', () => { ... });                         // Check skill name, version, no npm_dependencies
  it('has all files declared in adds', () => { ... });               // image-handler.ts + image-cleanup.ts exist, contain expected exports
  it('has all files declared in modifies', () => { ... });           // whatsapp.ts, whatsapp.test.ts, index.ts, global/CLAUDE.md
  it('has intent files for modified files', () => { ... });          // All 4 .intent.md files exist
  it('modified whatsapp.ts preserves core structure', () => { ... });// Class, methods, core imports all present
  it('modified whatsapp.ts includes image handling', () => { ... }); // image-handler import, isImageMessage, downloadImageMessage, saveImageToGroup, isSenderAllowed
  it('modified whatsapp.test.ts includes image mock and tests', () => { ... }); // Mock, 5 test cases
  it('modified whatsapp.test.ts preserves all existing test sections', () => { ... }); // All describe blocks
  it('modified index.ts includes cleanup timer', () => { ... });     // startImageCleanup import, imageCleanupTimer, clearInterval
  it('modified global CLAUDE.md includes image instructions', () => { ... }); // Images section present
});
```

### `SKILL.md`

```markdown
---
name: add-image-understanding
description: Add image understanding to NanoClaw. Downloads WhatsApp images, saves them to group folders, and prompts the agent to read them using the Read tool.
---

# Add Image Understanding

This skill adds image understanding to NanoClaw's WhatsApp channel. When an image arrives,
it is downloaded via Baileys, saved to the group's images/ folder, and the agent receives
a prompt like `[Image — view it by reading: /workspace/group/images/file.jpg]` so it can
use the Read tool to view the image.

## Phase 1: Pre-flight

### Check if already applied
Read `.nanoclaw/state.yaml`. If `image-understanding` is in `applied_skills`, skip to Phase 3.

### Prerequisites
- No additional API keys needed (uses Baileys' built-in media download)
- Works with or without the voice-transcription skill

## Phase 2: Apply Code Changes

### Initialize skills system (if needed)
```bash
npx tsx scripts/apply-skill.ts --init
```

### Apply the skill
```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-image-understanding
```

This deterministically:
- Adds `src/image-handler.ts` (image download + save functions)
- Adds `src/image-cleanup.ts` (weekly cleanup of old images)
- Three-way merges image handling into `src/channels/whatsapp.ts`
- Three-way merges image tests into `src/channels/whatsapp.test.ts`
- Three-way merges cleanup timer into `src/index.ts`
- Adds image instructions to `groups/global/CLAUDE.md`
- Records the application in `.nanoclaw/state.yaml`

If the apply reports merge conflicts, read the intent files:
- `modify/src/channels/whatsapp.ts.intent.md`
- `modify/src/channels/whatsapp.test.ts.intent.md`
- `modify/src/index.ts.intent.md`
- `modify/groups/global/CLAUDE.md.intent.md`

### Validate code changes
```bash
npm test
npm run build
```

## Phase 3: Configure

No configuration needed. Image understanding uses Baileys' built-in media download — no API key required.

### Sender allowlist (optional)
By default, images from all senders are processed. To restrict which senders can send images,
configure `sender-allowlist.json` (same file used for message allowlisting).

### Build and restart
```bash
npm run build
```

## Phase 4: Verify

### Test with an image
Send an image in any registered WhatsApp chat. The agent should receive it as
`[Image — view it by reading: /workspace/group/images/...]` and describe what it sees.

### Check logs if needed
```bash
tail -f logs/nanoclaw.log | grep -i image
```

Look for:
- `Downloaded and saved image` — successful download with size + mimetype
- `Image download error` — media download failure
- `Deleted old image` — cleanup running correctly

## Troubleshooting

### Agent says "Image - download failed"
1. Check logs for the specific error
2. Verify Baileys is connected (WhatsApp web session active)
3. Media download may time out on slow connections — retry

### Images not cleaned up
1. Check logs for `Image cleanup` entries
2. Cleanup runs at startup + every 7 days
3. Only deletes images older than 30 days

### Agent doesn't respond to images at all
1. Verify the chat is registered
2. Check sender-allowlist.json if configured
3. Verify `groups/global/CLAUDE.md` contains the Images section
```

---

## Git / PR Workflow

### Step 1: Create branch from upstream/main

```bash
git fetch upstream
git checkout -b feat/add-image-understanding upstream/main
```

This ensures the branch is based on upstream, not our fork.

### Step 2: Create all skill files

Create the entire `.claude/skills/add-image-understanding/` tree as detailed above.

**Critical:** The `modify/` files must contain the FULL file contents with changes applied, not patches. The skills engine uses three-way merge with these as the "ours" version.

### Step 3: Generate the modify/ full files

For each modified file, start from the upstream version and apply our changes:

1. **`modify/src/channels/whatsapp.ts`** — Start from upstream's `add-voice-transcription/modify/src/channels/whatsapp.ts`, add image handling
2. **`modify/src/channels/whatsapp.test.ts`** — Start from upstream's `add-voice-transcription/modify/src/channels/whatsapp.test.ts`, add image mocks + tests
3. **`modify/src/index.ts`** — Start from upstream's `src/index.ts`, add cleanup timer
4. **`modify/groups/global/CLAUDE.md`** — Start from upstream's `groups/global/CLAUDE.md`, add Images section

### Step 4: Validate locally

```bash
# Run the skill package tests
npx vitest run .claude/skills/add-image-understanding/tests/image-understanding.test.ts

# Verify all files exist and are well-formed
ls -la .claude/skills/add-image-understanding/add/src/
ls -la .claude/skills/add-image-understanding/modify/src/channels/
ls -la .claude/skills/add-image-understanding/modify/src/
ls -la .claude/skills/add-image-understanding/modify/groups/global/
ls -la .claude/skills/add-image-understanding/tests/
```

### Step 5: Commit and push

```bash
git add .claude/skills/add-image-understanding/
git commit -m "feat: add image understanding skill for WhatsApp

Downloads WhatsApp images via Baileys, saves to group folders,
and prompts the agent to read them. Includes weekly cleanup of
images older than 30 days.

- add/src/image-handler.ts: isImageMessage, downloadImageMessage, saveImageToGroup
- add/src/image-cleanup.ts: weekly cleanup timer
- modify/src/channels/whatsapp.ts: image handling in messages.upsert
- modify/src/index.ts: cleanup timer lifecycle
- modify/groups/global/CLAUDE.md: agent instructions for reading images
- Respects sender-allowlist.json for image download authorization
- No new dependencies or env vars required"

git push origin feat/add-image-understanding
```

### Step 6: Create PR

```bash
gh pr create \
  --repo qwibitai/nanoclaw \
  --base main \
  --head ortalis97:feat/add-image-understanding \
  --title "feat: add image understanding skill" \
  --body "$(cat <<'EOF'
## Summary

Adds a new skill `.claude/skills/add-image-understanding/` that gives NanoClaw the ability to understand images sent in WhatsApp.

When an image arrives:
1. Downloads via Baileys' built-in `downloadMediaMessage`
2. Saves to `groups/<folder>/images/<messageId>.jpg`
3. Injects prompt: `[Image with caption: "..." — view it by reading: /workspace/group/images/file.jpg]`
4. Agent uses the Read tool to view the image and respond

Also includes:
- Weekly cleanup of images older than 30 days
- Sender allowlist integration (respects `sender-allowlist.json`)
- Agent instructions in `groups/global/CLAUDE.md`
- 5 test cases for image handling

No new npm dependencies or environment variables required.

## Design

- Image functions live in `src/image-handler.ts` (NOT `transcription.ts`) to avoid conflicts with voice-transcription skill
- Uses upstream's `isSenderAllowed()` from `sender-allowlist.ts` for authorization
- `depends: []` — works independently, coexists with voice-transcription

## Test plan

- [ ] `npx vitest run .claude/skills/add-image-understanding/tests/image-understanding.test.ts` passes
- [ ] Apply skill to clean checkout: `npx tsx scripts/apply-skill.ts .claude/skills/add-image-understanding`
- [ ] `npm test` passes after apply
- [ ] `npm run build` succeeds after apply
- [ ] Send image in WhatsApp → agent receives `[Image — view it by reading: ...]` and describes image
- [ ] Send image with caption → caption appears in prompt
- [ ] Image from non-allowed sender → blocked message
EOF
)"
```

---

## Adaptation Notes (fork vs upstream)

| Our Fork | Upstream Skill |
|----------|---------------|
| `ALLOWED_SENDERS` env var (Set) | `isSenderAllowed()` + `loadSenderAllowlist()` from `sender-allowlist.ts` |
| Image funcs in `transcription.ts` | Separate `image-handler.ts` (avoid conflicts) |
| Cleanup in `image-cleanup.ts` | Same file, same logic |
| "Alfred" in CLAUDE.md | "Andy" (upstream default name) |
| Mentions allowed users by name | Generic "unauthorized sender" message |
| `ASSISTANT_NAME` in error messages | Generic message (no name reference) |
| Uses `normalizeMessageContent` for `isImageMessage` | Same — Baileys' normalizer for robust unwrapping |

## Risk Checklist

- [ ] `modify/src/channels/whatsapp.ts` must be based on voice-transcription's version (which already has `finalContent` variable), NOT the base add-whatsapp version
- [ ] Content skip guard must include `&& !isImageMessage(msg)` — otherwise captionless images are silently dropped
- [ ] `isSenderAllowed` needs both `chatJid` AND `sender` params (3-arg function) — our fork's 1-Set check doesn't translate directly
- [ ] For DMs, the `imageSender` should be `chatJid` (already translated from LID); for groups, use `msg.key.participant`
- [ ] The `modify/src/index.ts` must be the FULL upstream index.ts — this file is large and has the multi-channel refactor code (channel registry, not direct WhatsApp import)
- [ ] Do NOT include `normalizeMessageContent` import in whatsapp.ts — the voice-transcription version dropped it and uses `msg.message?.` directly
- [ ] Use `msg.message?.imageMessage` (not `normalized?.imageMessage`) in whatsapp.ts message handler to match the voice-transcription version's pattern — BUT `image-handler.ts`'s `isImageMessage()` should use `normalizeMessageContent` internally for robust detection
