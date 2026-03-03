# NanoClaw — Oracle Cloud Production Deployment

Deploy NanoClaw as a 24/7 WhatsApp bot on an Oracle Cloud Always Free VM (1 OCPU, 1GB RAM, Ubuntu 22.04).

Bot name: **Alfred** | Trigger: `@Alfred`

---

## Prerequisites

- Ubuntu 22.04 VM (Oracle Cloud Always Free)
- Node.js ≥ 20 (`node --version`)
- Docker running (`docker run hello-world`)
- 2GB swap enabled (recommended for 1GB RAM)
- Anthropic API key or Claude Code OAuth token

---

## Phase 1 — System Prep

```bash
# Create install directory
sudo mkdir -p /opt/nanoclaw
sudo chown $USER:$USER /opt/nanoclaw

# Clone repo
cd /opt/nanoclaw
git clone https://github.com/ortalis97/nanoclaw.git .

# Install dependencies (memory-safe)
NODE_OPTIONS="--max-old-space-size=512" npm install

# Build TypeScript
npm run build

# Create logs directory
mkdir -p /opt/nanoclaw/logs
```

---

## Phase 2 — .env + Docker Image (Run in Parallel)

### 2A — Create .env (Session 1)

```bash
cp /opt/nanoclaw/.env.example /opt/nanoclaw/.env
chmod 600 /opt/nanoclaw/.env
nano /opt/nanoclaw/.env   # fill in ANTHROPIC_API_KEY
```

### 2B — Build Docker Image (Session 2 — takes 10–15 min)

```bash
# Run inside tmux so it survives SSH disconnect
tmux new -s build
cd /opt/nanoclaw
./container/build.sh
# Ctrl+B then D to detach; tmux attach -t build to check

# Verify when done:
docker images | grep nanoclaw
```

---

## Phase 3 — WhatsApp Pairing

No GUI on VM → use pairing code method:

```bash
cd /opt/nanoclaw
npx tsx src/whatsapp-auth.ts --pairing-code --phone <PHONE_NUMBER>
```

`<PHONE_NUMBER>` = international format, no `+` (e.g., `14155551234`)

On the phone:
1. WhatsApp → **Settings → Linked Devices → Link a Device**
2. Tap **Link with phone number instead**
3. Enter the 6-digit code from terminal

**Back up auth immediately after pairing:**
```bash
cp -r /opt/nanoclaw/store/auth/ ~/nanoclaw-auth-backup-$(date +%Y%m%d)/
```

---

## Phase 4 — Verify Manual Start

```bash
cd /opt/nanoclaw
node dist/index.js
```

Send `@Alfred hello` in a WhatsApp chat. Confirm response. Then `Ctrl+C`.

---

## Phase 5 — Automated Install (Service + Logrotate + Backup)

Run the installer script (handles all of 5C, 5D, 5E automatically):

```bash
cd /opt/nanoclaw
bash deploy/install.sh
```

Or manually:

### 5C — systemd Service
```bash
sudo sed "s/<YOUR_USERNAME>/$USER/g" deploy/nanoclaw.service \
  | sudo tee /etc/systemd/system/nanoclaw.service > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable nanoclaw
sudo systemctl start nanoclaw
```

### 5D — Log Rotation
```bash
sudo cp deploy/nanoclaw.logrotate /etc/logrotate.d/nanoclaw
sudo logrotate -d /etc/logrotate.d/nanoclaw   # dry-run verify
```

### 5E — Backup Script + Cron
```bash
cp deploy/backup.sh /opt/nanoclaw/backup.sh
chmod +x /opt/nanoclaw/backup.sh
/opt/nanoclaw/backup.sh   # run once to verify

# Add cron (daily at 3am)
(crontab -l 2>/dev/null; echo "0 3 * * * /opt/nanoclaw/backup.sh >> /opt/nanoclaw/logs/backup.log 2>&1") | crontab -
```

---

## Quick Reference

| Action | Command |
|--------|---------|
| Manual start | `cd /opt/nanoclaw && node dist/index.js` |
| Service start | `sudo systemctl start nanoclaw` |
| Service stop | `sudo systemctl stop nanoclaw` |
| Service restart | `sudo systemctl restart nanoclaw` |
| Service status | `sudo systemctl status nanoclaw` |
| Live logs | `tail -f /opt/nanoclaw/logs/nanoclaw.log` |
| Error logs | `tail -f /opt/nanoclaw/logs/nanoclaw.error.log` |
| Manual backup | `/opt/nanoclaw/backup.sh` |

| Location | Path |
|----------|------|
| WhatsApp auth | `/opt/nanoclaw/store/auth/` |
| SQLite database | `/opt/nanoclaw/store/messages.db` |
| Group memory | `/opt/nanoclaw/groups/` |
| Logs | `/opt/nanoclaw/logs/` |

---

## Verification Checklist

- [ ] `node --version` ≥ 20
- [ ] `docker run hello-world` succeeds
- [ ] `.env` has API key filled in
- [ ] `docker images | grep nanoclaw` shows the image
- [ ] `store/auth/` has files (WhatsApp paired)
- [ ] `node dist/index.js` connects without errors
- [ ] Bot responds to `@Alfred hello` in WhatsApp
- [ ] `sudo systemctl status nanoclaw` shows `active (running)`
- [ ] Service survives `sudo reboot`
- [ ] `/opt/nanoclaw/backup.sh` creates archive

---

## Memory Tuning (1GB RAM)

The `.env` is pre-tuned for Oracle Cloud Always Free:

| Variable | Value | Reason |
|----------|-------|--------|
| `MAX_CONCURRENT_CONTAINERS` | `1` | Each container ~300–500MB; only one fits |
| `CONTAINER_TIMEOUT` | `600000` (10 min) | Down from default 30 min |
| `IDLE_TIMEOUT` | `300000` (5 min) | Kill idle containers fast to free RAM |
| `NODE_OPTIONS` (systemd) | `--max-old-space-size=384` | Cap Node.js heap |
| `MemoryMax` (systemd) | `512M` | Hard OOM limit for the service |
