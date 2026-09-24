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
# Uploads of the dev instance, apart from the live files.
install -d -m 0700 -o "$dev_user" -g "$dev_user" /var/lib/volition/plan-dev /var/lib/volition/plan-dev/storage

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
# A socket left behind by an unclean shutdown would keep nginx from starting on boot.
install -d -m 0755 /etc/systemd/system/nginx.service.d
install -m 0644 "$here/systemd/nginx.service.d/volition-stale-socket.conf" /etc/systemd/system/nginx.service.d/
systemctl daemon-reload
nginx -t
systemctl reload nginx

"$here/refresh-db.sh"

# The dev API's control token, its own. The API reads it as the developer, so it is theirs.
install -d -m 0750 -o root -g "$dev_user" /etc/volition/dev
(
  umask 077
  [[ -s /etc/volition/dev/plan-control.token ]] || openssl rand -hex 32 >/etc/volition/dev/plan-control.token
)
chmod 0600 /etc/volition/dev/plan-control.token
chown "$dev_user:$dev_user" /etc/volition/dev/plan-control.token

echo "dev instance configured; start it with $here/start.sh as $dev_user"
