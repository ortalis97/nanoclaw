# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Workspace Is

This is the **fork of NanoClaw** (`ortalis97/alfred`) — a 24/7 WhatsApp bot named Alfred. The source code lives here and the Oracle Cloud Always Free VM (1 OCPU, 1GB RAM, Ubuntu 22.04) runs the deployed version at `/opt/nanoclaw`.

- **Fork:** `git@github.com:ortalis97/alfred.git`
- **Upstream:** `https://github.com/qwibitai/nanoclaw.git`
- **VM:** `ubuntu@VM_IP_REDACTED` (SSH key: `~/.ssh/your-ssh-key`)

To get upstream NanoClaw updates: `git fetch upstream && git merge upstream/main`

## Deployment Files

| File | Purpose |
|------|---------|
| `.env.example` | Environment template — copy to `.env`, fill in API key |
| `deploy/install.sh` | One-shot Phase 5 installer (run on VM after Phase 1–4) |
| `deploy/nanoclaw.service` | systemd unit — replaces `<YOUR_USERNAME>` with `$USER` at install time |
| `deploy/nanoclaw.logrotate` | Logrotate config — installed to `/etc/logrotate.d/nanoclaw` |
| `deploy/backup.sh` | Daily backup of auth, DB, groups, .env — installed to `/opt/nanoclaw/backup.sh` |
| `deploy/README.md` | Full deployment walkthrough (Phases 1–5) |

## Deployment Flow

**Run on the VM, not locally.** Full walkthrough in `deploy/README.md`.

```
Phase 1: clone + npm install + npm run build  (sequential)
Phase 2: .env creation ∥ Docker image build   (parallel — image takes 10-15 min)
Phase 3: WhatsApp pairing via pairing code    (no GUI on VM)
Phase 4: manual start verification            (node dist/index.js, test @Alfred hello)
Phase 5: bash deploy/install.sh              (systemd + logrotate + backup + cron)
```

Key Phase 2B command (run in `tmux` so it survives SSH disconnect):
```bash
tmux new -s build && ./container/build.sh
```

Key Phase 3 command (no GUI — pairing code method):
```bash
npx tsx src/whatsapp-auth.ts --pairing-code --phone <NUMBER_WITHOUT_PLUS>
```

## NanoClaw Architecture (Source Repo)

The deployed application (`/opt/nanoclaw`) is a TypeScript project:

- **Entry point:** `src/index.ts` → built to `dist/index.js`
- **WhatsApp layer:** Receives messages, routes to agent via trigger (`@Alfred`)
- **Agent containers:** Each Claude Code session runs in an isolated Docker container (`nanoclaw-agent:latest`) that includes Chromium + Claude Code. Containers are spawned per request and killed after `CONTAINER_TIMEOUT` or `IDLE_TIMEOUT`.
- **Persistence:**
  - `store/auth/` — WhatsApp session credentials (losing this requires re-pairing)
  - `store/messages.db` — SQLite message history
  - `groups/` — Per-group memory/context files (created on first use)
  - `data/sessions/` — Agent session data (created on first use)
- **Build:** `npm run build` (TypeScript → `dist/`)
- **Docker image:** `./container/build.sh` → `nanoclaw-agent:latest`

## Memory Constraints (1GB RAM VM)

Agent containers each use ~300–500MB (Chromium + Claude Code). The `.env.example` is pre-tuned:

- `MAX_CONCURRENT_CONTAINERS=1` — only one container at a time
- `CONTAINER_TIMEOUT=600000` — 10 min max per session (vs 30 min default)
- `IDLE_TIMEOUT=300000` — kill idle containers after 5 min
- systemd `MemoryMax=512M` — cgroup RAM limit (does not include swap)
- `NODE_OPTIONS=--max-old-space-size=384` — Node.js heap cap

## Critical Operational Notes
- **DO NOT USE cc10x !!!!**
- **Back up `store/auth/` immediately after pairing** — losing it requires re-pairing the phone number.
- **Backup archives contain `.env`** (API key). The backup dir is `chmod 700` and archives are `chmod 600`.
- `SupplementaryGroups=docker` in the service unit (not `Group=docker`) — preserves the user's primary group while adding Docker socket access.
- `ExecStartPre=/bin/mkdir -p /opt/nanoclaw/logs` in the service unit — systemd `append:` log mode does not auto-create parent directories.
- `groups/` and `data/sessions/` don't exist until first bot use — the backup script handles their absence gracefully via existence-check before including them in tar.

## Service Management (on the VM)

```bash
sudo systemctl status nanoclaw
sudo systemctl restart nanoclaw
tail -f /opt/nanoclaw/logs/nanoclaw.log
tail -f /opt/nanoclaw/logs/nanoclaw.error.log
```

## Environment Sync Rule

**Local `.env` and VM `/opt/nanoclaw/.env` must stay in sync.**

- Local may be ahead (e.g. experimenting with new vars) — that's fine.
- Local must **never be behind** the VM — if a var is set on the VM it must also exist locally.
- When adding a new env var: update both files in the same session. Update `.env.example` too.
- To verify sync: `diff <(grep -v '^#' .env | grep -v '^$' | sort) <(ssh -i ~/.ssh/your-ssh-key ubuntu@VM_IP_REDACTED "grep -v '^#' /opt/nanoclaw/.env | grep -v '^$' | sort")`

## Ongoing Development Workflow

Edit code locally → commit → run `deploy/deploy-changes.sh`.

```bash
# Day-to-day change
git add <files> && git commit -m "description"
bash deploy/deploy-changes.sh

# When container/Dockerfile changes (takes 10-15 min)
bash deploy/deploy-changes.sh --rebuild-docker
```

The script: pushes to GitHub → pulls on VM → npm install + build → restarts systemd service.

**SSH to VM:** `ssh -i ~/.ssh/your-ssh-key ubuntu@VM_IP_REDACTED`
