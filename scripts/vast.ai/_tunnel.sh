#!/bin/bash
# Shared self-healing SSH tunnel for vast.ai workers.
#
# Source this from a worker start-*.sh script:
#     source "$(dirname "$0")/_tunnel.sh"
#
# Establishes an autossh tunnel to the main gorm host, forwarding:
#     localhost:5432 -> remote postgres (5433)
#     localhost:6379 -> remote redis    (6379)
#
# autossh restarts the underlying ssh process automatically when the main
# host or network blips, so workers don't get stranded with a dead tunnel
# (which is what happened when the main server last crashed).

set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-rune@gorm.predictioninstitute.com}"
TUNNEL_MATCH="autossh.*-L 6379:localhost:6379"

# Install autossh if missing (vast images are Ubuntu-based, usually root)
if ! command -v autossh >/dev/null 2>&1; then
    echo "Installing autossh..."
    SUDO=""
    [ "$(id -u)" -ne 0 ] && SUDO="sudo"
    $SUDO apt-get update -y
    $SUDO apt-get install -y autossh
fi

# Kill any previous tunnel (autossh or bare ssh) so we start clean
pkill -f "$TUNNEL_MATCH" 2>/dev/null || true
pkill -f "ssh.*-L 5432.*gorm.predictioninstitute" 2>/dev/null || true
sleep 1

# Make sure redis is running on the main host before we try to forward to it
ssh -o StrictHostKeyChecking=accept-new "$REMOTE_HOST" \
    "cd ~/workspace/projects/crypto.ai && docker compose up -d redis"

LOG_DIR="${HOME}/.gorm-tunnel"
mkdir -p "$LOG_DIR"

# Start autossh in the background.
#   -M 0                : disable autossh's own monitoring port; rely on
#                         ssh's ServerAlive* keepalives below.
#   -f -N               : fork to background, do not run a remote command.
#   AUTOSSH_GATETIME=0  : retry immediately even if the very first connection
#                         fails (useful when the main host is still booting).
AUTOSSH_GATETIME=0 \
AUTOSSH_LOGFILE="$LOG_DIR/autossh.log" \
autossh -M 0 -f -N \
    -o StrictHostKeyChecking=accept-new \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes \
    -o TCPKeepAlive=yes \
    -L 5432:localhost:5433 \
    -L 6379:localhost:6379 \
    "$REMOTE_HOST"

# Wait for the tunnel to come up
echo "Waiting for tunnel..."
for i in $(seq 1 20); do
    if python3 -c "import socket; s=socket.socket(); s.settimeout(2); s.connect(('localhost',6379)); s.close()" 2>/dev/null; then
        echo "Tunnel ready (autossh log: $LOG_DIR/autossh.log)"
        break
    fi
    [ "$i" -eq 20 ] && { echo "ERROR: Tunnel failed to come up"; exit 1; }
    sleep 1
done
