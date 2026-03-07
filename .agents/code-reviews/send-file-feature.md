# Code Review: send_file MCP Tool (f41d400)

**Date:** 2026-03-07
**Scope:** send_file feature across container and host

## Stats

- Files Modified: 6
- Files Added: 0 (file-sending.ts and file-sending.test.ts were new in the commit, not in this diff)
- Files Deleted: 0
- Net change in this diff: +144 / -40 lines (formatting only — all logic was introduced in f41d400)

---

## Issues

---

```
severity: medium
file: src/index.ts
line: 666-667
issue: fs.copyFileSync to outbox not inside a try-catch
detail: The outbox copy happens before the retry loop and is NOT wrapped in try-catch.
  If `displayName` (which comes from the agent-controlled `filename` IPC field, validated
  only as `z.string()`) contains a path separator — e.g., the agent calls send_file with
  filename: "reports/q1.pdf" — path.join(outboxDir, outboxName) resolves to a path in a
  non-existent subdirectory. fs.copyFileSync throws ENOENT. This propagates out of
  sendFile(), gets caught by the outer handler in ipc.ts, and the IPC file is moved to
  errors/. The file is never sent to WhatsApp and the user receives no error message.
suggestion: Wrap the outbox copy (and mkdirSync) in a try-catch. On failure, log a warning
  and continue to the send loop — the outbox copy is only for cleanup tracking and its
  failure should not abort delivery:

    try {
      const outboxDir = path.join(GROUPS_DIR, regGroup.folder, 'outbox');
      fs.mkdirSync(outboxDir, { recursive: true });
      const outboxName = `${Date.now()}-${path.basename(displayName)}`;  // basename for safety
      fs.copyFileSync(hostPath, path.join(outboxDir, outboxName));
    } catch (err) {
      logger.warn({ err, hostPath }, 'Failed to copy file to outbox — continuing with send');
    }

  Alternatively, sanitise displayName with path.basename() before using it as a filename
  component so slashes are stripped before they reach copyFileSync.
```

---

```
severity: low
file: src/index.ts
line: 626-631
issue: Garbled error message when file has no extension
detail: path.extname('noext') returns '' and ''.slice(1) is still ''. The user-facing
  message becomes: "Cannot send file: . files are not allowed." — a bare dot with no
  extension name. While the check itself is correct (empty ext → not allowed), the message
  is confusing.
suggestion: Add a guard for the empty-extension case:

    if (!ext) {
      if (ch) await ch.sendMessage(jid, 'Cannot send file: files with no extension are not allowed.');
      return;
    }
    if (!isAllowedExtension(ext)) {
      if (ch) await ch.sendMessage(jid, `Cannot send file: .${ext} files are not allowed.`);
      return;
    }
```

---

```
severity: low
file: src/file-sending.test.ts
line: 35-40
issue: validateContainerPath not tested with double-slash or single-dot segments
detail: The traversal tests cover ".." but not edge cases like:
  - "/workspace/group//file.txt" (double slash, empty segment)
  - "/workspace/group/./file.txt" (single dot, no-op but odd)
  These are harmless on Linux but the absence of test coverage means any future change
  to validateContainerPath could accidentally allow them without failing tests.
suggestion: Add two more test cases:
    it('accepts paths with single-dot segments (harmless)', () => {
      // single dot is not a traversal, path.join normalises it away on the host
      expect(validateContainerPath('/workspace/group/./file.txt')).toBeNull();
    });
    it('accepts double-slash paths (empty segments, harmless)', () => {
      expect(validateContainerPath('/workspace/group//file.txt')).toBeNull();
    });
  Or, if the intent is to be strict, add rejection tests for these cases.
```

---

## Notes

**Path traversal validation is sound overall.** `validateContainerPath` correctly rejects any
path segment equal to `..`. On the host side, `path.join` (not `path.resolve`) is used, so
no inner segment can reset to root. The registered group folder is validated through
`isValidGroupFolder()` which uses the stricter `path.relative`-based check from
`group-folder.ts`. Defense-in-depth is present: the container MCP tool validates before
writing the IPC file, and the host validates again before reading the file.

**IPC authorization is consistent.** The file handler in `ipc.ts` applies the same
source-group-matches-target-group check as the existing message and voice handlers.

**Extension allowlist is duplicated intentionally.** Both the container
(`ipc-mcp-stdio.ts`) and the host (`file-sending.ts`) maintain the allowlist, which is
correct — the container provides early rejection with a helpful error, the host enforces
as a security boundary.
