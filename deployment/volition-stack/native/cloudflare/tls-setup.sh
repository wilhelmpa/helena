#!/usr/bin/env bash
# Local HTTPS for the home network under the public name (helena.volition.one): a Let's
# Encrypt certificate through the DNS-01 challenge, so nothing has to be reachable from the
# internet. lego (Debian package, MIT) with Cloudflare's DNS API. Dry run by default.
# docs/helena-decisions/security-hardening.md §5.
#
# The DNS token: lego follows a CNAME on _acme-challenge, so the token can be scoped to a
# separate, otherwise unused zone instead of volition.one (whose token could rewrite the
# company's mail and web records). Recommended: in Cloudflare DNS for volition.one, one record
#   _acme-challenge.helena  CNAME  helena.<acme-zone>        (DNS only)
# and a token with Zone:DNS:Edit for <acme-zone> only. A token for volition.one works too.
#
#   sudo tls-setup.sh --apply token                          the OWNER pastes the DNS token
#   sudo tls-setup.sh --apply issue --email ADDRESS --accept-letsencrypt-terms
#   sudo tls-setup.sh --apply renew-timer                    daily renewal check, reloads nginx
#   sudo tls-setup.sh check
set -uo pipefail
export LC_ALL=C PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

here=$(cd "$(dirname "$0")" && pwd)
etc=/etc/helena/cloudflare
dns_token=$etc/dns.token
tls=/etc/helena/tls
host=${HELENA_PUBLIC_HOST:-helena.volition.one}
apply=0 email= terms=0 cmd=
while (($#)); do
  case "$1" in
    --apply) apply=1 ;;
    --email) email=${2:-}; shift ;;
    --accept-letsencrypt-terms) terms=1 ;;
    --host) host=${2:-}; shift ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) [[ -z $cmd ]] && cmd=$1 || { echo "tls-setup.sh: unexpected $1" >&2; exit 2; } ;;
  esac
  shift
done
say() { echo "tls-setup.sh: $*"; }
die() { echo "tls-setup.sh: $*" >&2; exit 1; }
run() { if [[ $apply -eq 1 ]]; then "$@"; else printf 'tls-setup.sh: [dry-run] would run:'; printf ' %q' "$@"; printf '\n'; fi; }
[[ $EUID -eq 0 ]] || die "run with sudo"
[[ $host =~ ^[a-z0-9.-]+$ ]] || die "invalid host"

cert=$tls/lego/certificates/$host.crt

# lego reads the token from the file itself (the *_FILE form of its variables), in a
# transient unit that gets the file as a credential: the token is never in a process
# argument, an environment listing or a log line.
lego_run() {
  local name=helena-lego-$$
  systemd-run --wait --pipe --collect --quiet --unit="$name" \
    -p LoadCredential=cf-dns-token:"$dns_token" \
    -p Environment=CF_DNS_API_TOKEN_FILE="/run/credentials/$name.service/cf-dns-token" \
    -p Environment=CLOUDFLARE_PROPAGATION_TIMEOUT=180 \
    -p UMask=0077 -p NoNewPrivileges=yes -p PrivateTmp=yes \
    /usr/bin/lego --path "$tls/lego" --dns cloudflare --dns.resolvers 1.1.1.1:53 \
      --domains "$host" --key-type ec256 "$@"
}

case "$cmd" in
  check)
    printf '%-24s %s\n' "lego" "$(dpkg-query -W -f='${Version}' lego 2>/dev/null || echo 'missing (apt install lego, owner OK)')"
    printf '%-24s %s\n' "DNS token" "$( [[ -s $dns_token ]] && stat -c '%a %U:%G' "$dns_token" || echo missing)"
    if [[ -e $cert ]]; then
      printf '%-24s %s\n' "certificate" "$(openssl x509 -noout -enddate -in "$cert" | cut -d= -f2)"
    else
      printf '%-24s %s\n' "certificate" "none"
    fi
    printf '%-24s %s\n' "renewal timer" "$(systemctl is-active helena-tls-renew.timer 2>/dev/null)"
    ;;
  token)
    run install -d -m 0700 -o root -g root /etc/helena "$etc"
    if [[ $apply -eq 0 ]]; then say "[dry-run] would read the DNS token (no echo) into $dns_token (0600 root)"; exit 0; fi
    [[ -t 0 ]] || die "run this in a terminal: the token is read without echo"
    read -rsp "Cloudflare DNS API token (input hidden): " value; echo
    [[ ${#value} -ge 30 && $value =~ ^[A-Za-z0-9_-]+$ ]] || die "that does not look like an API token; nothing written"
    (umask 077; printf '%s' "$value" >"$dns_token.new"); unset value
    chown root:root "$dns_token.new"; chmod 0600 "$dns_token.new"; mv -f "$dns_token.new" "$dns_token"
    say "DNS token stored in $dns_token (0600 root). It was not printed."
    ;;
  issue)
    command -v lego >/dev/null || die "lego is not installed (apt install lego, with the owner's OK)"
    [[ -s $dns_token ]] || die "no DNS token (tls-setup.sh token)"
    [[ -n $email ]] || die "--email is the Let's Encrypt account address (expiry notices)"
    [[ $terms -eq 1 ]] || die "the owner accepts the Let's Encrypt subscriber agreement with --accept-letsencrypt-terms"
    run install -d -m 0700 "$tls" "$tls/lego"
    if [[ $apply -eq 1 ]]; then
      lego_run --email "$email" --accept-tos run || die "issuing failed (see above; the token was not printed)"
      chmod 0600 "$tls/lego/certificates/"*.key
      say "certificate: $cert"
    else
      say "[dry-run] would request a certificate for $host (DNS-01 via Cloudflare) into $tls/lego"
    fi
    ;;
  renew-timer)
    run install -m 0644 "$here/helena-tls-renew.service" /etc/systemd/system/helena-tls-renew.service
    run install -m 0644 "$here/helena-tls-renew.timer" /etc/systemd/system/helena-tls-renew.timer
    run install -m 0755 "$here/tls-setup.sh" /usr/local/libexec/helena-tls-setup
    run systemctl daemon-reload
    run systemctl enable --now helena-tls-renew.timer
    ;;
  renew)
    [[ -e $cert ]] || die "no certificate yet"
    [[ $apply -eq 1 ]] || { say "[dry-run] would renew when fewer than 30 days are left"; exit 0; }
    before=$(sha256sum "$cert" | cut -c1-16)
    lego_run renew --days 30 || die "renewal failed"
    after=$(sha256sum "$cert" | cut -c1-16)
    if [[ $before != "$after" ]]; then
      chmod 0600 "$tls/lego/certificates/"*.key
      nginx -t && systemctl reload nginx && say "renewed and nginx reloaded"
    fi
    ;;
  *) sed -n '2,19p' "$0"; exit 2 ;;
esac
