#!/bin/bash
# Installs the agent runtimes Helena runs besides Hermes, system-wide and pinned:
#
#   claude            Claude Code, the native binary from Anthropic's release bucket
#   codex             Codex CLI, from npm
#   claude-agent-acp  ACP adapter for Claude Code (orchestrator decision D-C3: installed
#   codex-acp         ACP adapter for Codex         outside Helena's tree, never a dependency)
#
# Versions and checksums are pinned in runtimes.json next to this script; npm packages are
# pinned with their integrity in npm/<runtime>/package-lock.json. Claude Code's binary is
# checked against the pinned SHA-256 and against the release manifest, whose signature is
# checked with Anthropic's pinned release key. npm checks every package against the
# lockfile's sha512 and runs no install script.
#
# Layout (root-owned, read-only for everyone else):
#   /opt/helena/runtimes/<runtime>/<version>/   one installed version
#   /opt/helena/runtimes/<runtime>/current      the version in use
#   /opt/helena/runtimes/<runtime>/previous     the one before, for rollback
#   /usr/local/bin/<program>                    link into current
#
# Idempotent: a version already installed and intact is not downloaded again; running it
# again only puts missing links back. Downloads need the owner's OK (docs/volition-agent-rules.md).
#
#   sudo install-cli-runtimes.sh plan                 what would be downloaded, from where
#   sudo install-cli-runtimes.sh install [--only claude,codex] [--without-acp] [--dry-run]
#   sudo install-cli-runtimes.sh status [--json]
#   sudo install-cli-runtimes.sh rollback <runtime>
#   sudo install-cli-runtimes.sh verify               the installed files against the pins
set -euo pipefail
umask 022

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
pins=${HELENA_RUNTIME_PINS:-$here/runtimes.json}
python=${PYTHON:-/usr/bin/python3}
npm=${NPM:-/usr/local/bin/npm}
node=${NODE:-/usr/local/bin/node}
# The tests serve a release from files and run without root (test_install_cli_runtimes.py).
testing=${HELENA_RUNTIME_TESTING:-}
curl_opts=(--proto "$([[ -n "$testing" ]] && echo '=https,file' || echo '=https')" --tlsv1.2 -fsSL --retry 3 --connect-timeout 20)

die() { printf 'install-cli-runtimes: %s\n' "$*" >&2; exit 1; }
say() { printf 'install-cli-runtimes: %s\n' "$*"; }

# Staging directories of an install that did not finish, removed on any exit.
cleanup=()
trap 'for path in "${cleanup[@]}"; do rm -rf -- "$path"; done' EXIT

need_root() { [[ -n "$testing" || $EUID -eq 0 ]] || die "$1 needs root (it writes $prefix and $bindir)"; }

pin() {
  # pin <runtime|-> <dotted.key> — a value of runtimes.json, empty when absent.
  "$python" -I - "$pins" "$1" "$2" <<'PY'
import json, sys
pins = json.load(open(sys.argv[1]))
node = pins if sys.argv[2] == '-' else pins['runtimes'].get(sys.argv[2])
for part in sys.argv[3].split('.'):
    node = node.get(part) if isinstance(node, dict) else None
if isinstance(node, (dict, list)):
    print(json.dumps(node))
elif node is not None:
    print(node if not isinstance(node, bool) else str(node).lower())
PY
}

runtimes() { "$python" -I -c 'import json,sys; print("\n".join(json.load(open(sys.argv[1]))["runtimes"]))' "$pins"; }

prefix=${HELENA_RUNTIME_PREFIX:-$(pin - prefix)}
bindir=${HELENA_RUNTIME_BIN:-$(pin - bin)}
[[ "$prefix" == /* && "$bindir" == /* ]] || die "prefix and bin must be absolute paths"

platform() {
  case "$(uname -m)" in
    x86_64|amd64) echo linux-x64 ;;
    aarch64|arm64) echo linux-arm64 ;;
    *) die "unsupported machine $(uname -m)" ;;
  esac
}

installed_version() { # the version `current` points at, or nothing
  local link="$prefix/$1/current"
  [[ -L "$link" ]] && basename -- "$(readlink -- "$link")" || true
}

# Points <runtime>/current at <version> (and previous at the old one) and every program of
# the runtime at current, each link replaced in one rename.
switch_to() {
  local name=$1 version=$2 dir="$prefix/$1" old
  old=$(installed_version "$name")
  if [[ -n "$old" && "$old" != "$version" ]]; then
    ln -sfn "$old" "$dir/.previous.$$" && mv -T "$dir/.previous.$$" "$dir/previous"
  fi
  ln -sfn "$version" "$dir/.current.$$" && mv -T "$dir/.current.$$" "$dir/current"
  local links program target
  links=$(pin "$name" links)
  while IFS=$'\t' read -r program target; do
    [[ -n "$program" ]] || continue
    [[ -e "$dir/current/$target" ]] || die "$name $version has no $target"
    ln -sfn "$dir/current/$target" "$bindir/.$program.$$" && mv -T "$bindir/.$program.$$" "$bindir/$program"
  done < <("$python" -I -c 'import json,sys; [print(k+"\t"+v) for k,v in json.loads(sys.argv[1]).items()]' "$links")
}

staging_dir() {
  install -d -m 0700 "$prefix/.staging"
  mktemp -d "$prefix/.staging/$1.XXXXXX"
}

new_staging() { # sets $staging and removes it again unless the install finishes
  staging=$(staging_dir "$1")
  cleanup+=("$staging")
}

finish_install() { # finish_install <runtime> <version> <staging>: moves it into place
  local name=$1 version=$2 staging=$3 dir="$prefix/$1"
  install -d -m 0755 "$dir"
  [[ $EUID -ne 0 ]] || chown -R root:root "$staging"
  chmod -R go-w,a+rX "$staging"
  rm -rf -- "$dir/$version.old"
  [[ -e "$dir/$version" ]] && mv -T "$dir/$version" "$dir/$version.old"
  mv -T "$staging" "$dir/$version"
  rm -rf -- "$dir/$version.old"
}

# ── Claude Code ───────────────────────────────────────────────────────────────────────

claude_intact() { # claude_intact <dir> <sha256>
  [[ -f "$1/.helena-installed" && -x "$1/claude" ]] &&
    [[ "$(sha256sum "$1/claude" | cut -d' ' -f1)" == "$2" ]]
}

install_claude() {
  local version url plat sha size key fpr dir staging gnupg status manifest_sha
  version=$(pin claude version); url=$(pin claude url); plat=$(platform)
  sha=$(pin claude "platforms.$plat.sha256"); size=$(pin claude "platforms.$plat.size")
  key="$here/$(pin claude signingKey)"; fpr=$(pin claude signingKeyFingerprint)
  [[ "$sha" =~ ^[0-9a-f]{64}$ && -n "$size" ]] || die "claude $version has no pin for $plat"
  dir="$prefix/claude/$version"
  if claude_intact "$dir" "$sha"; then
    say "claude $version is installed"
  elif [[ -n "${dry_run:-}" ]]; then
    say "would download $url/$version/$plat/claude ($size bytes) and its signed manifest"
    return
  else
    new_staging claude
    say "downloading the manifest of claude $version"
    curl "${curl_opts[@]}" -o "$staging/manifest.json" "$url/$version/manifest.json"
    curl "${curl_opts[@]}" -o "$staging/manifest.json.sig" "$url/$version/manifest.json.sig"
    gnupg=$(mktemp -d "$staging/gnupg.XXXXXX")
    GNUPGHOME=$gnupg gpg --batch --quiet --import "$key" 2>/dev/null
    status=$(GNUPGHOME=$gnupg gpg --batch --status-fd 1 --verify "$staging/manifest.json.sig" "$staging/manifest.json" 2>/dev/null || true)
    grep -q "^\[GNUPG:\] VALIDSIG $fpr " <<<"$status" || die "the manifest of claude $version is not signed with the pinned release key"
    rm -rf -- "$gnupg"
    manifest_sha=$("$python" -I -c 'import json,sys; m=json.load(open(sys.argv[1])); assert m["version"]==sys.argv[3]; print(m["platforms"][sys.argv[2]]["checksum"])' "$staging/manifest.json" "$plat" "$version") ||
      die "the manifest names another version or no $plat"
    [[ "$manifest_sha" == "$sha" ]] || die "the signed manifest and the pin disagree about claude $version"
    say "downloading claude $version for $plat ($size bytes)"
    curl "${curl_opts[@]}" -o "$staging/claude" "$url/$version/$plat/claude"
    [[ "$(stat -c %s "$staging/claude")" == "$size" ]] || die "claude $version has the wrong size"
    [[ "$(sha256sum "$staging/claude" | cut -d' ' -f1)" == "$sha" ]] || die "claude $version has the wrong checksum"
    chmod 0755 "$staging/claude"
    local home; home=$(mktemp -d "$staging/home.XXXXXX")
    env -i HOME="$home" PATH=/usr/bin:/bin DISABLE_AUTOUPDATER=1 DISABLE_UPDATES=1 \
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 "$staging/claude" --version | grep -qF "$version" ||
      die "claude $version does not start"
    rm -rf -- "$home"
    printf '{"version":"%s","sha256":"%s","installedAt":"%s"}\n' "$version" "$sha" "$(date -u +%FT%TZ)" >"$staging/.helena-installed"
    finish_install claude "$version" "$staging"
    say "claude $version installed"
  fi
  [[ -n "${dry_run:-}" ]] || switch_to claude "$version"
}

# ── npm packages (Codex, the ACP adapters) ────────────────────────────────────────────

lock_hash() { sha256sum "$here/$(pin "$1" lock)/package-lock.json" | cut -d' ' -f1; }

npm_intact() { # npm_intact <runtime> <dir>
  [[ -f "$2/.helena-installed" ]] &&
    grep -qF "\"lock\":\"$(lock_hash "$1")\"" "$2/.helena-installed" &&
    "$python" -I -c 'import json,os,sys; [sys.exit(1) for p in json.loads(sys.argv[2]).values() if not os.path.exists(os.path.join(sys.argv[1],p))]' "$2" "$(pin "$1" links)"
}

install_npm() {
  local name=$1 version lock dir staging omit
  version=$(pin "$name" version); lock="$here/$(pin "$name" lock)"
  [[ -f "$lock/package.json" && -f "$lock/package-lock.json" ]] || die "$name has no lockfile in $lock"
  dir="$prefix/$name/$version"
  if npm_intact "$name" "$dir"; then
    say "$name $version is installed"
  elif [[ -n "${dry_run:-}" ]]; then
    say "would install $name $version from the npm registry ($(grep -c '"resolved"' "$lock/package-lock.json") packages in the lockfile, checked against their sha512)"
    return
  else
    new_staging "$name"
    cp "$lock/package.json" "$lock/package-lock.json" "$staging/"
    omit=(--omit=dev)
    [[ "$(pin "$name" omitOptional)" == true ]] && omit+=(--omit=optional)
    say "installing $name $version from npm"
    (cd "$staging" && env HOME="$staging" npm_config_cache="$staging/.npm" npm_config_update_notifier=false \
      npm_config_fund=false npm_config_audit=false PATH="$(dirname "$node"):/usr/bin:/bin" \
      "$npm" ci --ignore-scripts --no-audit --no-fund "${omit[@]}" --loglevel=error)
    rm -rf -- "$staging/.npm"
    local program target
    while IFS=$'\t' read -r program target; do
      [[ -n "$program" ]] || continue
      [[ -f "$staging/$target" ]] || die "$name $version has no $target"
      chmod 0755 "$staging/$target"
      "$node" --check "$staging/$target" || die "$name $version: $target does not parse"
    done < <("$python" -I -c 'import json,sys; [print(k+"\t"+v) for k,v in json.loads(sys.argv[1]).items()]' "$(pin "$name" links)")
    if [[ "$name" == codex ]]; then
      local home; home=$(mktemp -d "$staging/home.XXXXXX")
      env -i HOME="$home" CODEX_HOME="$home" PATH="$(dirname "$node"):/usr/bin:/bin" \
        "$staging/node_modules/@openai/codex/bin/codex.js" --version | grep -qF "$version" ||
        die "codex $version does not start"
      rm -rf -- "$home"
    fi
    printf '{"version":"%s","lock":"%s","installedAt":"%s"}\n' "$version" "$(lock_hash "$name")" "$(date -u +%FT%TZ)" >"$staging/.helena-installed"
    finish_install "$name" "$version" "$staging"
    say "$name $version installed"
  fi
  [[ -n "${dry_run:-}" ]] || switch_to "$name" "$version"
}

install_one() {
  case "$(pin "$1" source)" in
    claude-release) install_claude ;;
    npm) install_npm "$1" ;;
    *) die "unknown runtime $1" ;;
  esac
}

# ── Commands ──────────────────────────────────────────────────────────────────────────

cmd_install() {
  local only="" with_acp=1
  while (( $# )); do
    case "$1" in
      --only) only=$2; shift 2 ;;
      --only=*) only=${1#--only=}; shift ;;
      --without-acp) with_acp=""; shift ;;
      --dry-run) dry_run=1; shift ;;
      *) die "unknown option $1" ;;
    esac
  done
  [[ -n "${dry_run:-}" ]] || need_root install
  command -v gpg >/dev/null || die "gpg is missing"
  [[ -x "$npm" && -x "$node" ]] || die "node and npm are missing ($node, $npm)"
  local name
  for name in $(runtimes); do
    if [[ -n "$only" ]]; then
      [[ ",$only," == *",$name,"* ]] || continue
    elif [[ -z "$with_acp" && "$(pin "$name" acp)" == true ]]; then
      continue
    fi
    install_one "$name"
  done
  [[ -n "${dry_run:-}" ]] || rmdir "$prefix/.staging" 2>/dev/null || true
}

cmd_plan() {
  local name
  say "platform $(platform), prefix $prefix, programs in $bindir"
  for name in $(runtimes); do
    case "$(pin "$name" source)" in
      claude-release)
        say "claude $(pin claude version): $(pin claude url)/$(pin claude version)/$(platform)/claude, $(pin claude "platforms.$(platform).size") bytes, SHA-256 $(pin claude "platforms.$(platform).sha256"), manifest signed by $(pin claude signingKeyFingerprint)" ;;
      npm)
        say "$name $(pin "$name" version): npm registry, $(grep -c '"resolved"' "$here/$(pin "$name" lock)/package-lock.json") packages pinned by sha512$([[ "$(pin "$name" omitOptional)" == true ]] && echo ', optional platform binaries left out')" ;;
    esac
  done
}

cmd_status() {
  local json="" name first=1
  [[ "${1:-}" == --json ]] && json=1
  [[ -n "$json" ]] && printf '{'
  for name in $(runtimes); do
    local pinned current previous ok=false
    pinned=$(pin "$name" version); current=$(installed_version "$name")
    previous=$([[ -L "$prefix/$name/previous" ]] && basename -- "$(readlink -- "$prefix/$name/previous")" || true)
    if [[ -n "$current" ]]; then
      if [[ "$(pin "$name" source)" == claude-release ]]; then
        claude_intact "$prefix/$name/$current" "$(pin claude "platforms.$(platform).sha256")" && ok=true || true
        [[ "$current" == "$pinned" ]] || ok=false
      else
        npm_intact "$name" "$prefix/$name/$current" && ok=true || true
      fi
    fi
    if [[ -n "$json" ]]; then
      [[ -n "$first" ]] || printf ','
      first=""
      printf '"%s":{"pinned":"%s","current":%s,"previous":%s,"intact":%s}' "$name" "$pinned" \
        "$([[ -n "$current" ]] && printf '"%s"' "$current" || echo null)" \
        "$([[ -n "$previous" ]] && printf '"%s"' "$previous" || echo null)" "$ok"
    else
      printf '%-18s pinned %-10s installed %-10s previous %-10s %s\n' "$name" "$pinned" \
        "${current:--}" "${previous:--}" "$([[ "$ok" == true ]] && echo ok || echo 'not installed or changed')"
    fi
  done
  [[ -n "$json" ]] && printf '}\n' || true
}

cmd_rollback() {
  local name=${1:?usage: rollback <runtime>} previous
  need_root rollback
  [[ -L "$prefix/$name/previous" ]] || die "$name has no previous version"
  previous=$(basename -- "$(readlink -- "$prefix/$name/previous")")
  [[ -d "$prefix/$name/$previous" ]] || die "$name $previous is gone"
  switch_to "$name" "$previous"
  say "$name is back on $previous"
}

cmd_verify() {
  local bad=0 name current
  for name in $(runtimes); do
    current=$(installed_version "$name")
    [[ -n "$current" ]] || continue
    if [[ "$(pin "$name" source)" == claude-release ]]; then
      claude_intact "$prefix/$name/$current" "$(pin claude "platforms.$(platform).sha256")" || { say "$name $current differs from its pin"; bad=1; }
    else
      npm_intact "$name" "$prefix/$name/$current" || { say "$name $current differs from its lockfile"; bad=1; }
      local omit=(--omit=dev)
      [[ "$(pin "$name" omitOptional)" == true ]] && omit+=(--omit=optional)
      (cd "$prefix/$name/$current" && "$npm" ls "${omit[@]}" --all >/dev/null 2>&1) || { say "$name $current: npm reports a missing or changed package"; bad=1; }
    fi
  done
  return $bad
}

command=${1:-}
shift || true
case "$command" in
  install) cmd_install "$@" ;;
  plan) cmd_plan ;;
  status) cmd_status "$@" ;;
  rollback) cmd_rollback "$@" ;;
  verify) cmd_verify ;;
  *) sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 64 ;;
esac
