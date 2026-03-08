#!/bin/bash
# Usage: bash deploy/deploy-changes.sh [--rebuild-docker]
#
# Pushes local changes to GitHub, pulls on VM, rebuilds, and restarts the service.
# Use --rebuild-docker only when container/Dockerfile changes.

set -euo pipefail

# Load deploy config (VM host + SSH key)
CONF="$(dirname "$0")/deploy.conf"
if [[ ! -f "$CONF" ]]; then
  echo "Error: deploy/deploy.conf not found."
  echo "Copy deploy/deploy.conf.example to deploy/deploy.conf and fill in your values."
  exit 1
fi
# shellcheck source=deploy/deploy.conf
source "$CONF"

SSH="ssh -i $DEPLOY_KEY $DEPLOY_HOST"

echo ">>> Pushing to GitHub..."
git push origin main

echo ">>> Pulling on VM..."
$SSH "cd /opt/nanoclaw && git pull origin main"

echo ">>> Installing deps + building..."
$SSH "cd /opt/nanoclaw && NODE_OPTIONS='--max-old-space-size=512' npm install --legacy-peer-deps && npm run build"

if [[ "${1:-}" == "--rebuild-docker" ]]; then
  echo ">>> Rebuilding Docker image (this takes 10-15 min)..."
  $SSH "cd /opt/nanoclaw && ./container/build.sh"
fi

echo ">>> Restarting service..."
$SSH "sudo systemctl restart nanoclaw"

echo ">>> Checking status..."
$SSH "sudo systemctl status nanoclaw --no-pager -l"
echo ""
echo "Deploy complete. Tail logs: ssh -i $DEPLOY_KEY $DEPLOY_HOST 'tail -f /opt/nanoclaw/logs/nanoclaw.log'"
