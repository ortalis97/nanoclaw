# Feature: Alfred GitHub Issues Integration

The following plan should be complete, but validate codebase patterns before implementing.

Pay special attention to how secrets are allowlisted and passed to containers — the pattern is strict and must be followed exactly.

## Feature Description

Alfred (the WhatsApp bot) can document bugs, todos, and observations by creating GitHub Issues on the repo using the GitHub REST API via `curl`. Issues are tagged with an `alfred` label so they're easy to filter. When the developer runs `/prime` in Claude Code on their Mac, open Alfred-reported issues are automatically pulled into context via `gh issue list`.

## User Story

As a developer using Alfred,
I want Alfred to be able to log bugs and todos as GitHub Issues,
So that they are immediately accessible in my Claude Code context without any git sync or SSH needed.

## Problem Statement

Alfred discovers issues (bugs, improvement ideas, todos) during operation on the VM. There is no sync path from VM → Mac without manual intervention. GitHub Issues are accessible from both sides without any sync.

## Solution Statement

1. Add `GITHUB_TOKEN` to the secrets allowlist so it's forwarded into the container environment (available to `curl` in Bash).
2. Add usage instructions to Alfred's `CLAUDE.md` so it knows how to create issues with the correct format and labels.
3. Update `MEMORY.md` so `/prime` automatically loads open Alfred-reported issues via `gh issue list`.

**No container rebuild required** — `curl` is already available in the container image.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Low
**Primary Systems Affected**: `src/container-runner.ts`, `groups/main/CLAUDE.md`, `MEMORY.md`, `.env.example`
**Dependencies**: `GITHUB_TOKEN` (fine-grained PAT with Issues: Read & Write on the fork repo)

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ BEFORE IMPLEMENTING

- `src/container-runner.ts` (lines 217–224) — `readSecrets()`: the allowlist of secrets passed to containers via stdin. **GITHUB_TOKEN must be added here.**
- `src/container-runner.ts` (lines 511–516) — `sdkEnv` construction: secrets from stdin are merged into `sdkEnv` which becomes the subprocess environment. GITHUB_TOKEN will be available to Bash automatically.
- `container/agent-runner/src/index.ts` (lines 191–209) — `createSanitizeBashHook`: strips `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` from Bash subprocesses. GITHUB_TOKEN is NOT in this list, so it WILL be available to `curl` in Bash without any changes here.
- `src/env.ts` — `readEnvFile(keys)`: reads `.env` for specific keys. Used by `readSecrets()`.
- `groups/main/CLAUDE.md` — Alfred's system prompt for the main channel. GitHub Issues instructions go here.
- `~/.claude/projects/.../memory/MEMORY.md` — Always loaded into Claude Code context. Prime instruction goes here.
- `.env.example` — Template for `.env`. Document the new var here.

### New Files to Create

None. This is pure configuration + documentation.

### Relevant Documentation

- [GitHub REST API — Create an Issue](https://docs.github.com/en/rest/issues/issues#create-an-issue)
  - Why: Exact JSON schema for the `curl` call Alfred will use
- [GitHub Fine-Grained PAT](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token)
  - Why: Minimal-scope token (Issues: R/W on the fork repo only) is safest

### Patterns to Follow

**Secret allowlisting** (`src/container-runner.ts` lines 217–224):
```typescript
function readSecrets(): Record<string, string> {
  return readEnvFile([
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_AUTH_TOKEN',
  ]);
}
```
Add `'GITHUB_TOKEN'` to this array. Nothing else changes — the rest of the pipeline handles it automatically.

**Alfred curl pattern** (to put in `groups/main/CLAUDE.md`):
```bash
curl -s -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  https://api.github.com/repos/$GITHUB_REPO/issues \
  -d '{
    "title": "Bug: <short description>",
    "body": "**Context:** ...\n\n**Observed:** ...\n\n**Expected:** ...",
    "labels": ["alfred", "bug"]
  }'
```

---

## IMPLEMENTATION PLAN

### Phase 1: Secret Forwarding

Add `GITHUB_TOKEN` to the container secrets allowlist.

### Phase 2: Alfred Instructions

Teach Alfred how and when to create GitHub Issues.

### Phase 3: Prime Integration

Update `MEMORY.md` so `/prime` loads open Alfred issues into context.

### Phase 4: Documentation

Update `.env.example` so future setups know to add the token.

---

## STEP-BY-STEP TASKS

### UPDATE `src/container-runner.ts`

- **IMPLEMENT**: Add `'GITHUB_TOKEN'` to the `readSecrets()` array (line ~218)
- **PATTERN**: `src/container-runner.ts:217-224` — mirror exactly, just append the key
- **GOTCHA**: Do NOT add it to `SECRET_ENV_VARS` in `container/agent-runner/src/index.ts` — that list strips vars from Bash, which is the opposite of what we want. GITHUB_TOKEN must reach `curl`.
- **VALIDATE**: `npm run typecheck`

```typescript
// Before:
function readSecrets(): Record<string, string> {
  return readEnvFile([
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_AUTH_TOKEN',
  ]);
}

// After:
function readSecrets(): Record<string, string> {
  return readEnvFile([
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_AUTH_TOKEN',
    'GITHUB_TOKEN',
  ]);
}
```

### UPDATE `groups/main/CLAUDE.md`

- **IMPLEMENT**: Add a "## Reporting Bugs & Todos" section at the end of the file
- **GOTCHA**: Alfred uses WhatsApp formatting elsewhere — this section is internal instructions, markdown is fine
- **VALIDATE**: Read the file back and confirm the section is appended cleanly

### UPDATE `MEMORY.md`

- **IMPLEMENT**: Add an "Alfred Issues" section that tells prime to run `gh issue list`
- **GOTCHA**: MEMORY.md has a 200-line limit before truncation — keep the new section concise (5–8 lines)
- **VALIDATE**: Read MEMORY.md back, confirm total line count stays under 200

### UPDATE `.env.example`

- **IMPLEMENT**: Add `GITHUB_TOKEN` entry with a comment explaining scope
- **VALIDATE**: `grep GITHUB_TOKEN .env.example`

Add after the `ANTHROPIC_API_KEY` block:

```bash
# GitHub Personal Access Token for Alfred to create issues
# Scope: Fine-grained PAT, Issues: Read & Write on your fork repo only
# Generate at: https://github.com/settings/personal-access-tokens
GITHUB_TOKEN=
```

### MANUAL STEP (not code): Create GitHub Labels

Run once:
```bash
gh label create alfred --color 5319e7 --description "Reported by Alfred" --repo <your-fork-repo>
gh label create bug --color d73a4a --description "Something isn't working" --repo <your-fork-repo> 2>/dev/null || true
gh label create enhancement --color a2eeef --description "New feature or request" --repo <your-fork-repo> 2>/dev/null || true
gh label create todo --color e4e669 --description "Action needed" --repo <your-fork-repo> 2>/dev/null || true
```

### MANUAL STEP (not code): Add token to VM .env

SSH to VM and add the token:
```bash
source deploy/deploy.conf && ssh -i $DEPLOY_KEY $DEPLOY_HOST
echo "GITHUB_TOKEN=ghp_your_token_here" >> /opt/nanoclaw/.env
sudo systemctl restart nanoclaw
```

---

## TESTING STRATEGY

### Manual Validation (the only meaningful test here)

1. SSH to VM, confirm `GITHUB_TOKEN` is in `/opt/nanoclaw/.env`
2. Send Alfred a message: `@Alfred you have a test todo: verify GitHub issue creation works`
3. Alfred should create an issue — check your fork's issue tracker
4. On Mac: `gh issue list --repo <your-fork-repo> --label alfred --state open` should show it
5. Run `/prime` — confirm the issue appears in context summary

### Unit Tests

No unit tests needed — the only logic change is adding one string to an array. Existing tests cover `readEnvFile` and `readSecrets` indirectly.

---

## VALIDATION COMMANDS

### Level 1: Type check
```bash
npm run typecheck
```

### Level 2: Tests
```bash
npm test
```

### Level 3: Manual
```bash
# Confirm GITHUB_TOKEN will be read from .env (simulate)
node -e "
import('./src/env.js').then(m => {
  const r = m.readEnvFile(['GITHUB_TOKEN']);
  console.log('GITHUB_TOKEN present:', !!r.GITHUB_TOKEN);
});
"
```

### Level 4: End-to-end
```bash
# On Mac after deployment:
gh issue list --repo <your-fork-repo> --label alfred --state open --json number,title,createdAt
```

---

## ACCEPTANCE CRITERIA

- [ ] `GITHUB_TOKEN` is in `readSecrets()` allowlist
- [ ] Alfred's `CLAUDE.md` has clear instructions with the exact `curl` command
- [ ] `MEMORY.md` has the `gh issue list` command for prime to run
- [ ] `.env.example` documents the token
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] Alfred can successfully create a GitHub Issue from a conversation
- [ ] `/prime` surfaces the issue in context

---

## COMPLETION CHECKLIST

- [ ] `src/container-runner.ts` updated (1-line change)
- [ ] `groups/main/CLAUDE.md` updated (new section appended)
- [ ] `MEMORY.md` updated (new section appended, under 200 lines total)
- [ ] `.env.example` updated
- [ ] GitHub labels created (manual)
- [ ] Token added to VM `.env` (manual)
- [ ] Service restarted on VM
- [ ] End-to-end test passed

---

## NOTES

**Why `curl` and not `gh` CLI?** `gh` is not in the container image and adding it requires a rebuild. `curl` is already present and the GitHub REST API is stable. If a rebuild happens for another reason in the future, `gh` could be added then.

**Why fine-grained PAT vs classic?** Fine-grained PAT can be scoped to a single repo with Issues-only permission — minimal blast radius if the token leaks from a container.

**Token in Bash env:** The `createSanitizeBashHook` in `container/agent-runner/src/index.ts` only strips `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN`. GITHUB_TOKEN is intentionally NOT in that list, so it reaches `curl` unmodified.

**Prime integration:** The `gh issue list` command runs on the Mac (not the VM), so it works regardless of whether `gh` is in the container.
