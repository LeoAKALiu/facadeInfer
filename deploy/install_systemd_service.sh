#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="newdemo-facade"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "ERROR: systemctl not found (systemd not available)."
  echo "Fallback: use deploy/run_detached.sh (nohup)."
  exit 1
fi

echo "[1/4] Installing systemd unit: ${SERVICE_NAME}.service"
sudo cp "${SCRIPT_DIR}/${SERVICE_NAME}.service" "/etc/systemd/system/${SERVICE_NAME}.service"

echo "[2/4] Reloading systemd"
sudo systemctl daemon-reload

echo "[3/4] Enabling + starting ${SERVICE_NAME}"
sudo systemctl enable --now "${SERVICE_NAME}"

echo "[4/4] Status"
sudo systemctl status "${SERVICE_NAME}" --no-pager -l || true

echo
echo "Tail logs:"
echo "  sudo journalctl -u ${SERVICE_NAME} -f"
echo
echo "Verify listener:"
echo "  sudo ss -ltnp | grep ':8000'"

