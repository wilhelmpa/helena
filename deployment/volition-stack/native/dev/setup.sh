#!/usr/bin/env bash
# One-time setup of the isolated Plan development instance (see README.md).
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "setup.sh: run with sudo" >&2; exit 1; }

here=$(cd "$(dirname "$0")" && pwd)
dev_user=${DEV_USER:-${SUDO_USER:-}}
[[ -n $dev_user && $dev_user != root ]] || { echo "setup.sh: set DEV_USER" >&2; exit 1; }

run_dir=/srv/volition/dev-run
env_file=/etc/volition/plan-dev.env
token_conf=/etc/nginx/conf.d/volition-dev-local-owner.conf
site=/etc/nginx/sites-enabled/volition-dev.conf

# Only root and the developer's group may traverse the socket directory.
install -d -m 0750 -o root -g "$dev_user" "$run_dir"

token=$(openssl rand -hex 32)
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
python3 "$here/render-env.py" /etc/volition/plan.env /etc/volition/local-owner.env "$token" >"$tmp"
install -m 0640 -o root -g "$dev_user" "$tmp" "$env_file"

(
  umask 077
  printf 'map $host $volition_dev_owner_token {\n    default "%s";\n}\n' "$token" >"$token_conf"
)
install -m 0644 "$here/nginx-dev.conf" "$site"
nginx -t
systemctl reload nginx

"$here/refresh-db.sh"

# The development Mastra instance and its bridge to the development API, with tokens of
# their own. The API reads the control token as the developer, so it is theirs.
install -d -m 0750 -o root -g "$dev_user" /etc/volition/dev
for token in plan-control hermes-team; do
  [[ -s /etc/volition/dev/$token.token ]] || openssl rand -hex 32 >"/etc/volition/dev/$token.token"
done
chown "$dev_user:$dev_user" /etc/volition/dev/plan-control.token
chmod 0600 /etc/volition/dev/plan-control.token /etc/volition/dev/hermes-team.token
root=$(cd "$here/../../../.." && pwd)
runuser -u "$dev_user" -- bash -c "cd '$root/deployment/volition-stack/optional/mastra-studio' && bun install --frozen-lockfile >/dev/null && bun run build >/dev/null"
install -m 0644 "$here"/systemd/volition-*-dev.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now volition-hermes-team-bridge-dev.service volition-mastra-dev.service

echo "dev instance configured; start it with $here/start.sh as $dev_user"
