#!/usr/bin/env bash
# Local HTTPS for the home network under its own name (helena-home.volition.one): a Let's
# Encrypt certificate through the DNS-01 challenge, so nothing has to be reachable from the
# internet. certbot with its Cloudflare DNS plugin (Debian: certbot, python3-certbot-dns-cloudflare;
# Apache-2.0). Debian's lego 4.9 has no Cloudflare provider. Dry run by default.
# docs/helena-decisions/security-hardening.md §5.
#
# The name resolves publicly to the LAN address (a DNS-only record, e.g.
#   helena-home.volition.one  A  192.168.2.58
# in Cloudflare DNS; the router needs a DNS-rebind exception for it). From outside it leads
# nowhere; at home it is the direct way in, next to the tunnel's helena.volition.one.
#
# The DNS token (Cloudflare → My Profile → API Tokens, Zone:DNS:Edit) is the owner's. It is
# read without echo into /etc/helena/cloudflare/dns.token (0600 root); certbot gets it through
# a credentials file it keeps for its renewals (/etc/helena/cloudflare/certbot-dns.ini, 0600
# root). Neither is ever printed.
#
#   sudo tls-setup.sh check                                    what is there, expiry
#   sudo tls-setup.sh --apply token                            the OWNER pastes the DNS token
#   sudo tls-setup.sh [--apply] issue --email ADDRESS --accept-letsencrypt-terms
#        [--host helena-home.volition.one] [--also NAME ...]  the certificate (DNS-01)
#   sudo tls-setup.sh [--apply] renewal                        certbot.timer + the nginx deploy hook
#   sudo tls-setup.sh [--apply] renew-now                      a renewal check now (certbot renew)
set -uo pipefail
export LC_ALL=C PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

etc=${HELENA_CLOUDFLARE_ETC:-/etc/helena/cloudflare}
dns_token=$etc/dns.token
credentials=$etc/certbot-dns.ini
letsencrypt=${HELENA_LETSENCRYPT_DIR:-/etc/letsencrypt}
hook=$letsencrypt/renewal-hooks/deploy/helena-nginx-reload
host=${HELENA_HOME_HOST:-helena-home.volition.one}
apply=0 email= terms=0 cmd= also=()
while (($#)); do
  case "$1" in
    --apply) apply=1 ;;
    --email) email=${2:-}; shift ;;
    --accept-letsencrypt-terms) terms=1 ;;
    --host) host=${2:-}; shift ;;
    --also) also+=("${2:-}"); shift ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) [[ -z $cmd ]] && cmd=$1 || { echo "tls-setup.sh: unexpected $1" >&2; exit 2; } ;;
  esac
  shift
done
say() { echo "tls-setup.sh: $*"; }
die() { echo "tls-setup.sh: $*" >&2; exit 1; }
run() { if [[ $apply -eq 1 ]]; then "$@"; else printf 'tls-setup.sh: [dry-run] would run:'; printf ' %q' "$@"; printf '\n'; fi; }
name_ok() { [[ $1 =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$ ]]; }
[[ ${HELENA_TLS_SETUP_TEST:-0} == 1 || $EUID -eq 0 ]] || die "run with sudo"
name_ok "$host" || die "invalid host"
for name in "${also[@]}"; do name_ok "$name" || die "invalid --also name"; done

# certbot names the lineage after --cert-name: the files are always here, whatever SANs it has.
live=$letsencrypt/live/$host

# The credentials file certbot reads, written from the stored token without passing the
# token through an argument, an environment listing or the terminal. Rewritten only when the
# token changed (compared as files, never shown).
write_credentials() {
  local tmp
  tmp=$(umask 077; mktemp "$etc/.certbot-dns.XXXXXX") || die "cannot write in $etc"
  { printf '# Helena: the Cloudflare DNS token for certbot (tls-setup.sh). Secret; 0600 root.\n'
    printf 'dns_cloudflare_api_token = '
    cat "$dns_token"
    printf '\n'; } >"$tmp"
  chmod 0600 "$tmp"
  if [[ -e $credentials ]] && cmp -s "$tmp" "$credentials"; then rm -f "$tmp"; return 0; fi
  mv -f "$tmp" "$credentials"
  say "credentials for certbot written ($credentials, 0600; the token was not printed)"
}

deploy_hook() {
  cat <<'EOF'
#!/bin/sh
# Helena (cloudflare/tls-setup.sh): a renewed certificate reaches nginx. Only a config nginx
# accepts is loaded; otherwise the old certificate keeps serving until the next renewal.
nginx -t -q && systemctl reload nginx
EOF
}

case "$cmd" in
  check)
    printf '%-24s %s\n' "certbot" "$(dpkg-query -W -f='${Version}' certbot 2>/dev/null || echo 'missing (apt install certbot python3-certbot-dns-cloudflare, owner OK)')"
    printf '%-24s %s\n' "dns-cloudflare plugin" "$(dpkg-query -W -f='${Version}' python3-certbot-dns-cloudflare 2>/dev/null || echo missing)"
    printf '%-24s %s\n' "DNS token" "$( [[ -s $dns_token ]] && stat -c '%a %U:%G' "$dns_token" || echo missing)"
    printf '%-24s %s\n' "certbot credentials" "$( [[ -s $credentials ]] && stat -c '%a %U:%G' "$credentials" || echo 'missing (written by issue)')"
    if [[ -e $live/fullchain.pem ]]; then
      end=$(openssl x509 -noout -enddate -in "$live/fullchain.pem" | cut -d= -f2)
      days=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))
      names=$(openssl x509 -noout -ext subjectAltName -in "$live/fullchain.pem" 2>/dev/null | grep -o 'DNS:[^,]*' | cut -d: -f2 | paste -sd, -)
      printf '%-24s %s\n' "certificate" "$host: until $end ($days days), names $names"
    else
      printf '%-24s %s\n' "certificate" "none for $host"
    fi
    printf '%-24s %s\n' "renewal (certbot.timer)" "$(systemctl is-active certbot.timer 2>/dev/null)"
    printf '%-24s %s\n' "nginx deploy hook" "$( [[ -x $hook ]] && echo present || echo 'missing (renewal)')"
    ;;
  token)
    run install -d -m 0755 -o root -g root /etc/helena; run install -d -m 0700 -o root -g root "$etc"
    if [[ $apply -eq 0 ]]; then say "[dry-run] would read the DNS token (no echo) into $dns_token (0600 root)"; exit 0; fi
    [[ -t 0 ]] || die "run this in a terminal: the token is read without echo"
    read -rsp "Cloudflare DNS API token (input hidden): " value; echo
    [[ ${#value} -ge 30 && $value =~ ^[A-Za-z0-9_-]+$ ]] || die "that does not look like an API token; nothing written"
    (umask 077; printf '%s' "$value" >"$dns_token.new"); unset value
    chown root:root "$dns_token.new"; chmod 0600 "$dns_token.new"; mv -f "$dns_token.new" "$dns_token"
    say "DNS token stored in $dns_token (0600 root). It was not printed."
    if [[ -e $credentials ]]; then write_credentials; fi
    ;;
  issue)
    command -v certbot >/dev/null || die "certbot is not installed (apt install certbot python3-certbot-dns-cloudflare, owner OK)"
    [[ -s $dns_token ]] || die "no DNS token (tls-setup.sh --apply token)"
    [[ -n $email ]] || die "--email is the Let's Encrypt account address (expiry notices)"
    [[ $terms -eq 1 ]] || die "the owner accepts the Let's Encrypt subscriber agreement with --accept-letsencrypt-terms"
    domains=(-d "$host")
    for name in "${also[@]}"; do domains+=(-d "$name"); done
    args=(certonly --non-interactive --agree-tos -m "$email" --no-eff-email
      --dns-cloudflare --dns-cloudflare-credentials "$credentials" --dns-cloudflare-propagation-seconds 30
      --cert-name "$host" --key-type ecdsa --elliptic-curve secp256r1 --keep-until-expiring --expand
      "${domains[@]}")
    if [[ $apply -eq 1 ]]; then
      write_credentials
      certbot "${args[@]}" || die "issuing failed (see above and /var/log/letsencrypt; the token was not printed)"
      say "certificate: $live/fullchain.pem (key $live/privkey.pem)"
    else
      say "[dry-run] would write $credentials (0600) from the stored token"
      printf 'tls-setup.sh: [dry-run] would run: certbot'; printf ' %q' "${args[@]}"; printf '\n'
    fi
    ;;
  renewal)
    # Debian's certbot package brings certbot.timer (twice a day, renews under 30 days left);
    # a renewed certificate reaches nginx through this deploy hook.
    run install -d -m 0755 "$letsencrypt/renewal-hooks/deploy"
    if [[ $apply -eq 1 ]]; then
      deploy_hook >"$hook.new" && chmod 0755 "$hook.new" && mv -f "$hook.new" "$hook"
      say "deploy hook $hook installed"
    else
      say "[dry-run] would install the deploy hook $hook:"; deploy_hook | sed 's/^/    /'
    fi
    run systemctl enable --now certbot.timer
    # The lego-era units of this script (never enabled live) are removed if present.
    if [[ -e /etc/systemd/system/helena-tls-renew.timer ]]; then
      run systemctl disable --now helena-tls-renew.timer
      run rm -f /etc/systemd/system/helena-tls-renew.timer /etc/systemd/system/helena-tls-renew.service
      run systemctl daemon-reload
    fi
    ;;
  renew-now)
    command -v certbot >/dev/null || die "certbot is not installed"
    run certbot renew --cert-name "$host" --non-interactive
    ;;
  *) sed -n '2,25p' "$0"; exit 2 ;;
esac
