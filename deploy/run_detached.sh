#!/usr/bin/env bash
set -euo pipefail

# Simple fallback when systemd isn't available.
# Starts the server in the background and writes pid + logs under ./backend/

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

mkdir -p backend

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-8000}"
export RELOAD="${RELOAD:-0}"
export LOG_LEVEL="${LOG_LEVEL:-info}"

LOG_FILE="backend/server.log"
PID_FILE="backend/server.pid"

if [[ -f "${PID_FILE}" ]] && kill -0 "$(cat "${PID_FILE}")" 2>/dev/null; then
  echo "Server already running (pid=$(cat "${PID_FILE}"))."
  exit 0
fi

nohup /usr/bin/python3 "${REPO_ROOT}/run_server.py" >>"${LOG_FILE}" 2>&1 &
echo $! >"${PID_FILE}"

echo "Started (pid=$(cat "${PID_FILE}"))."
echo "Logs: tail -f ${LOG_FILE}"

