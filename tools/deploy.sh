#!/usr/bin/env bash
set -euo pipefail

REMOTE="${1:-}"

if [ -z "$REMOTE" ]; then
  echo "Usage: $0 <remote>"
  exit 1
fi

ssh "$REMOTE" <<'EOF'
set -euo pipefail

APP_DIR="$HOME/zetrick-api"
SERVICE="zetrick-api"
BRANCH="master"
WAIT_SECONDS=30

echo "==> Deploying in $APP_DIR"
cd "$APP_DIR"

echo "==> Pulling latest code"
git pull origin "$BRANCH"

echo "==> Installing dependencies"
npm install

echo "==> Restarting $SERVICE"
sudo systemctl restart "$SERVICE"

echo "==> Watching $SERVICE for ${WAIT_SECONDS}s..."
for ((i=1; i<=WAIT_SECONDS; i++)); do
  if ! sudo systemctl is-active --quiet "$SERVICE"; then
    echo
    echo "❌ Deploy failed: $SERVICE stopped during startup"
    echo
    echo "==> systemctl status"
    sudo systemctl status "$SERVICE" --no-pager || true
    echo
    echo "==> Recent logs"
    sudo journalctl -u "$SERVICE" -n 100 --no-pager || true
    exit 1
  fi
  sleep 1
done

echo
echo "✅ $SERVICE stayed up for ${WAIT_SECONDS}s"
echo
echo "==> Recent logs"
sudo journalctl -u "$SERVICE" -n 50 --no-pager

echo
echo "==> Following logs (Ctrl-C to stop)"
sudo journalctl -u "$SERVICE" -f
EOF
