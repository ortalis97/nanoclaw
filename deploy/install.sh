#!/bin/bash
# NanoClaw Phase 5 installer
#
# Run this script ON the Oracle Cloud VM after:
#   - Phase 1 (clone + npm install + build) is complete
#   - Phase 2 (.env created + Docker image built)
#   - Phase 3 (WhatsApp paired)
#   - Phase 4 (manual start verified)
#
# Usage:
#   cd /opt/nanoclaw
#   bash deploy/install.sh
#
# What this does:
#   1. Installs systemd service (nanoclaw.service)
#   2. Installs logrotate config
#   3. Copies backup.sh to /opt/nanoclaw/
#   4. Enables and starts the service
#   5. Adds daily 3am backup cron job

set -euo pipefail

INSTALL_DIR="/opt/nanoclaw"
USERNAME="$USER"

echo "=== NanoClaw Production Installer ==="
echo "User: $USERNAME"
echo "Install dir: $INSTALL_DIR"
echo ""

# --- Sanity checks ---
if [[ ! -f "$INSTALL_DIR/dist/index.js" ]]; then
  echo "ERROR: $INSTALL_DIR/dist/index.js not found."
  echo "       Run 'npm run build' first (Phase 1)."
  exit 1
fi

if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  echo "ERROR: $INSTALL_DIR/.env not found."
  echo "       Create it from .env.example and fill in your API key (Phase 2A)."
  exit 1
fi

if [[ ! -d "$INSTALL_DIR/store/auth" ]]; then
  echo "ERROR: $INSTALL_DIR/store/auth/ not found."
  echo "       Pair WhatsApp first (Phase 3)."
  exit 1
fi

if ! docker images | grep -q nanoclaw; then
  echo "ERROR: nanoclaw Docker image not found."
  echo "       Run './container/build.sh' first (Phase 2B)."
  exit 1
fi

echo "[OK] All prerequisites met."
echo ""

# --- 5C: Install systemd service ---
echo ">>> Installing systemd service..."
SERVICE_SRC="$INSTALL_DIR/deploy/nanoclaw.service"
SERVICE_DST="/etc/systemd/system/nanoclaw.service"

# Ensure logs directory exists before service starts (systemd append: doesn't create it)
mkdir -p "$INSTALL_DIR/logs"

# Substitute <YOUR_USERNAME> with actual username; use tee for root-safe redirect
sudo sed "s/<YOUR_USERNAME>/$USERNAME/g" "$SERVICE_SRC" \
  | sudo tee "$SERVICE_DST" > /dev/null

sudo systemctl daemon-reload
sudo systemctl enable nanoclaw
sudo systemctl start nanoclaw

echo "[OK] Service installed and started."
sudo systemctl status nanoclaw --no-pager -l
echo ""

# --- 5D: Install logrotate ---
echo ">>> Installing logrotate config..."
sudo cp "$INSTALL_DIR/deploy/nanoclaw.logrotate" /etc/logrotate.d/nanoclaw
sudo logrotate -d /etc/logrotate.d/nanoclaw 2>&1 | head -5
echo "[OK] Logrotate installed."
echo ""

# --- 5E: Install backup script and cron ---
echo ">>> Installing backup script..."
cp "$INSTALL_DIR/deploy/backup.sh" "$INSTALL_DIR/backup.sh"
chmod +x "$INSTALL_DIR/backup.sh"

# Run once to verify
"$INSTALL_DIR/backup.sh"

# Add daily cron at 3am (idempotent — only adds if exact entry not already present)
CRON_JOB="0 3 * * * $INSTALL_DIR/backup.sh >> $INSTALL_DIR/logs/backup.log 2>&1"
if crontab -l 2>/dev/null | grep -qF "$CRON_JOB"; then
  echo "[OK] Backup cron already installed, skipping."
else
  (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
  echo "[OK] Backup cron installed (daily at 3am)."
fi
echo ""

# --- Summary ---
echo "=== Installation Complete ==="
echo ""
echo "Quick reference:"
echo "  Status:   sudo systemctl status nanoclaw"
echo "  Logs:     tail -f $INSTALL_DIR/logs/nanoclaw.log"
echo "  Errors:   tail -f $INSTALL_DIR/logs/nanoclaw.error.log"
echo "  Restart:  sudo systemctl restart nanoclaw"
echo ""
echo "Next: verify the bot responds to '@Alfred hello' in WhatsApp."
