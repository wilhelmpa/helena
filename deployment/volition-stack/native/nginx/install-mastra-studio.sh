#!/usr/bin/env bash
# Creates the Mastra control and gateway tokens that the units load, and puts Mastra
# Studio behind the Plan login of the Nginx site. Existing tokens are kept, so it can run
# again. Run as root; ETC_ROOT, NGINX_BIN and SYSTEMCTL_BIN exist for the tests.
set -euo pipefail
umask 077

etc="${ETC_ROOT:-/etc}"
nginx_bin="${NGINX_BIN:-/usr/sbin/nginx}"
systemctl_bin="${SYSTEMCTL_BIN:-/usr/bin/systemctl}"
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
site="$etc/nginx/sites-available/volition.conf"
anchor='    include /etc/nginx/snippets/volition-project-terminal.conf;'
include='    include /etc/nginx/snippets/volition-mastra-studio.conf;'

for name in mastra-control mastra-gateway; do
  [[ -s "$etc/volition/$name.token" ]] || openssl rand -hex 32 >"$etc/volition/$name.token"
done
gateway="$(<"$etc/volition/mastra-gateway.token")"
printf 'map $host $volition_mastra_gateway_token {\n    default "%s";\n}\n' "$gateway" \
  >"$etc/nginx/conf.d/volition-mastra-gateway.conf"
install -m 0644 "$here/mastra-studio.conf" "$etc/nginx/snippets/volition-mastra-studio.conf"

backup=''
if ! grep -qxF -- "$include" "$site"; then
  if ! grep -qxF -- "$anchor" "$site"; then
    echo "install-mastra-studio.sh: $site has no line '$anchor'" >&2
    exit 1
  fi
  backup="$(mktemp "$site.XXXXXX")"
  cp -p -- "$site" "$backup"
  awk -v anchor="$anchor" -v line="$include" '{ print } $0 == anchor { print line }' \
    "$backup" >"$site"
fi

restore() {
  if [[ -n $backup ]]; then
    cp -p -- "$backup" "$site"
    rm -f -- "$backup"
  fi
}

if ! "$nginx_bin" -t; then
  restore
  echo "install-mastra-studio.sh: Nginx refused the configuration; the site was restored." >&2
  exit 1
fi
if ! "$systemctl_bin" reload nginx.service; then
  restore
  echo "install-mastra-studio.sh: Nginx did not reload; the site was restored." >&2
  exit 1
fi
[[ -z $backup ]] || rm -f -- "$backup"
echo "Mastra Studio is served below /mastra/ for the instance owner."
