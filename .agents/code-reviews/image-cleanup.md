# Code Review: Image Cleanup

**Date:** 2026-03-05
**Files Reviewed:** `src/image-cleanup.ts` (new), `src/index.ts` (modified)

---

**Stats:**

- Files Modified: 1 (`src/index.ts`)
- Files Added: 1 (`src/image-cleanup.ts`)
- Files Deleted: 0
- New lines: 74
- Deleted lines: 0

---

## Issues Found

---

```
severity: medium
file: src/image-cleanup.ts
line: 27
issue: Folder names from readdirSync are not validated before use in path construction
detail: The rest of the codebase consistently validates folder names via `isValidGroupFolder()`
        and `resolveGroupFolderPath()` before using them in any path operation. Here, every
        entry in GROUPS_DIR — including `global` (a reserved folder), hidden directories, or
        any unexpected files — is passed raw to `path.join(GROUPS_DIR, folder, 'images')`.
        The `global` folder is explicitly reserved in group-folder.ts and should not be
        treated as a group. Additionally, symlinks or directories with unexpected names could
        be iterated without the path-escape guard that `ensureWithinBase` provides.
suggestion: Add a guard at the top of the for-loop:
            if (!isValidGroupFolder(folder)) continue;
            Import `isValidGroupFolder` from './group-folder.js'. This is consistent with
            every other path operation in the codebase and automatically excludes `global`
            and any unexpected entries.
```

---

```
severity: low
file: src/image-cleanup.ts
line: 28
issue: Redundant `fs.existsSync` check before a try/catch-guarded `readdirSync`
detail: `fs.existsSync(imagesDir)` is immediately followed by a `try { fs.readdirSync(imagesDir) }
        catch { continue }` block that already handles missing directories. The existsSync
        adds a superfluous syscall and introduces a TOCTOU window (directory could be removed
        between the check and the read — harmlessly handled by the catch, but the check
        adds no value).
suggestion: Remove the `existsSync` check entirely and rely on the try/catch on readdirSync,
            which already handles the non-existent case correctly.
```

---

## index.ts Changes

No issues. The wiring follows the exact same pattern as `startRateLimiterCleanup`:
import → module-level timer variable → start in `main()` → clear in shutdown handler.
