#!/usr/bin/env bash
# Stop the dev API and web servers.
set -euo pipefail

tmux kill-session -t plan-dev 2>/dev/null && echo "stopped" || echo "not running"
