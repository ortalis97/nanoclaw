# Default Timezone to Israel Time (Asia/Jerusalem) — Implementation Plan

> **For Claude:** REQUIRED: Follow this plan task-by-task. No TDD needed — this is a config-only change with no logic to unit-test.

**Goal:** Ensure NanoClaw defaults to `Asia/Jerusalem` for all timezone-sensitive operations (scheduler, cron, date display) without requiring a code change in `src/config.ts`.

**Architecture:** `src/config.ts` already exports `TIMEZONE` which reads `process.env.TZ` first and falls back to the system timezone. The only required change is documenting `TZ=Asia/Jerusalem` in `.env.example` and setting it in the live `.env` on the VM.

**Tech Stack:** TypeScript config, `.env` file, systemd service environment.

**Prerequisites:** SSH access to the VM (`ssh -i ~/.ssh/your-ssh-key ubuntu@VM_IP_REDACTED`). The bot should already be running.

---

## Context References

### Key Files
- `src/config.ts` (lines 61–64) — `TIMEZONE` constant. Already reads `process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone`. **No changes needed.**
- `.env.example` (line 39–41) — Logging section. New `TZ` entry goes here (before or after `LOG_LEVEL`).
- `/opt/nanoclaw/.env` (on VM) — Live environment. Must add `TZ=Asia/Jerusalem` manually.

### Existing Pattern for env vars
Every tunable value in `src/config.ts` follows the same pattern:
```typescript
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
```
The `TZ` env var is the standard POSIX name for timezone; Node.js and most system utilities respect it automatically when set in the process environment.

---

## Phase 1: Document in `.env.example` (Local)

> **Exit Criteria:** `.env.example` contains a `TZ=Asia/Jerusalem` line with a comment, committed to git.

### Task 1: Add `TZ` entry to `.env.example`

**Files:**
- Modify: `.env.example`

**Step 1:** Open `.env.example` and locate the `# --- Logging ---` section at the bottom (line 39).

**Step 2:** Insert the following block immediately before `LOG_LEVEL=info`:

```
# --- Timezone ---
# IANA timezone name. Controls cron scheduling and date display.
# See: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
TZ=Asia/Jerusalem
```

The final bottom of `.env.example` should look like:

```
# --- Timezone ---
# IANA timezone name. Controls cron scheduling and date display.
# See: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
TZ=Asia/Jerusalem

# --- Logging ---
LOG_LEVEL=info
```

**Step 3:** Verify the file looks correct by reading it end-to-end. No other lines should be changed.

**Step 4:** Commit.

```bash
cd /Users/ortalis/dev/nano_claw
git add .env.example
git commit -m "config: default timezone to Asia/Jerusalem"
```

---

## Phase 2: Apply to Live VM (Manual SSH Step)

> **Exit Criteria:** `TZ=Asia/Jerusalem` is set in `/opt/nanoclaw/.env` on the VM, service restarted, and `TIMEZONE` reported correctly in logs or a quick diagnostic.

### Task 2: Edit live `.env` on VM

**Step 1:** SSH into the VM.

```bash
ssh -i ~/.ssh/your-ssh-key ubuntu@VM_IP_REDACTED
```

**Step 2:** Add the `TZ` variable to the live `.env`.

```bash
# Check current .env (confirm TZ is not already set)
grep -i '^TZ' /opt/nanoclaw/.env || echo "TZ not set yet"

# Append TZ setting
echo "" >> /opt/nanoclaw/.env
echo "# Timezone" >> /opt/nanoclaw/.env
echo "TZ=Asia/Jerusalem" >> /opt/nanoclaw/.env
```

**Step 3:** Verify the line was added correctly.

```bash
tail -5 /opt/nanoclaw/.env
```

Expected output includes:
```
# Timezone
TZ=Asia/Jerusalem
```

**Step 4:** Restart the systemd service to pick up the new variable.

```bash
sudo systemctl restart nanoclaw
```

**Step 5:** Verify the service started cleanly.

```bash
sudo systemctl status nanoclaw
# Expect: "active (running)"

# Optional: confirm TZ is visible in the process environment
sudo cat /proc/$(pgrep -f "node dist/index.js")/environ | tr '\0' '\n' | grep ^TZ
# Expected: TZ=Asia/Jerusalem
```

**Step 6:** Exit the VM.

```bash
exit
```

---

## Phase 3: Push to GitHub and Deploy (Day-to-Day Workflow)

> **Exit Criteria:** The `.env.example` change is pushed to `ortalis97/alfred` and the VM has been refreshed.

### Task 3: Deploy the committed change

**Step 1:** Push to GitHub and deploy via the standard script.

```bash
cd /Users/ortalis/dev/nano_claw
bash deploy/deploy-changes.sh
```

The script handles: push to GitHub → pull on VM → npm install + build → service restart. Because there are **no TypeScript changes**, a `--rebuild-docker` flag is NOT needed.

**Step 2:** Confirm deployment succeeded.

```bash
ssh -i ~/.ssh/your-ssh-key ubuntu@VM_IP_REDACTED "sudo systemctl status nanoclaw --no-pager"
```

---

## Risks

| Risk | P | I | Score | Mitigation |
|------|---|---|-------|------------|
| TZ var not respected by Node.js | 1 | 3 | 3 | Node reads TZ from env at startup; confirmed by existing pattern in `config.ts` |
| systemd service strips env vars | 2 | 3 | 6 | nanoclaw.service uses `EnvironmentFile=/opt/nanoclaw/.env` — env vars from file are injected automatically |
| Israel observes DST (clocks change) | 2 | 2 | 4 | `Asia/Jerusalem` is the canonical IANA name and includes DST rules — no manual adjustment needed |
| Existing scheduled tasks drift | 1 | 2 | 2 | No scheduled tasks currently registered; low risk |

---

## Success Criteria

- [ ] `.env.example` contains `TZ=Asia/Jerusalem` with explanatory comment
- [ ] `/opt/nanoclaw/.env` on VM contains `TZ=Asia/Jerusalem`
- [ ] `sudo systemctl status nanoclaw` shows `active (running)` after restart
- [ ] `src/config.ts` is unchanged (no code modification required)

---

## Key Finding: No Code Change Needed

`src/config.ts` line 63–64 already reads:
```typescript
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
```

This means: **if `TZ=Asia/Jerusalem` is in the environment, it is already used automatically.** The original plan to "modify `src/config.ts` to read TZ from .env" is already done — the code is correct as-is.
