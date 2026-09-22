#!/bin/bash
set -euo pipefail

settings_dir="${HOME}/.local/share/code-server/User"
mkdir -p "${settings_dir}"
runtime_settings="/run/volition-code-settings/settings.json"
if [ ! -e "${runtime_settings}" ]; then
  if [ -f "${settings_dir}/settings.json" ] && [ ! -L "${settings_dir}/settings.json" ]; then
    install -m 0600 "${settings_dir}/settings.json" "${runtime_settings}"
  else
    install -m 0600 /etc/volition-workspace/settings.json "${runtime_settings}"
  fi
fi
chmod 0600 "${runtime_settings}"
if [ -f "${settings_dir}/settings.json" ] && [ ! -L "${settings_dir}/settings.json" ]; then
  mv -n "${settings_dir}/settings.json" "${settings_dir}/settings.json.before-theme-sync"
fi
ln -sfn "${runtime_settings}" "${settings_dir}/settings.json"

# Keep the shared checkout's HTTPS origin unchanged. This exact rewrite applies
# only to the one repository whose deploy key is mounted into this container.
git config --global --replace-all \
  url."git@github.com:wilhelmpa/v1-cart-suite.git".insteadOf \
  "https://github.com/wilhelmpa/v1-cart-suite.git"

declare -a child_pids=()

# ttyd passes only explicit `arg` query parameters to this fixed wrapper. The
# wrapper validates one lowercase slug, resolves it below /projects, and never
# evaluates the argument as shell code. This gives future provisioned projects
# a stable URL without adding ports or weakening an OpenClaw agent sandbox.
/usr/local/bin/ttyd \
  --interface 0.0.0.0 \
  --port 8082 \
  --cwd /projects \
  --base-path /focus/terminal-project \
  --auth-header X-Forwarded-User \
  --check-origin \
  --url-arg \
  --writable \
  --max-clients 16 \
  --client-option "titleFixed=Volition project terminal" \
  /usr/local/bin/volition-terminal-session &
child_pids+=("$!")

/usr/bin/code-server \
  --bind-addr 0.0.0.0:8080 \
  --auth none \
  --disable-proxy \
  --disable-telemetry \
  --disable-update-check \
  /projects &
child_pids+=("$!")

# Seed the supported managed Codex layout into the persistent user home.
# Remote Control cannot run from the npm-only installation. Authentication stays
# in the existing private home; image contents never contain credentials.
umask 077
codex_standalone="${HOME}/.codex/packages/standalone"
mkdir -p "$codex_standalone/releases" "${HOME}/.claude"
chmod 0700 "${HOME}/.codex" "${HOME}/.claude"
seed_release="$(basename "$(readlink /opt/codex-seed/packages/standalone/current)")"
if [[ ! -d "$codex_standalone/releases/$seed_release" ]]; then
  cp -R /opt/codex-seed/packages/standalone/releases/"$seed_release" "$codex_standalone/releases/"
fi
ln -sfn "$codex_standalone/releases/$seed_release" "$codex_standalone/current"

essential_pids=("${child_pids[@]}")
if [[ -f "${HOME}/.codex/remote-control.enabled" ]]; then
  /usr/local/bin/volition-codex-remote &
  child_pids+=("$!")
fi

terminate_children() {
  kill -TERM "${child_pids[@]}" 2>/dev/null || true
  wait "${child_pids[@]}" 2>/dev/null || true
}
trap terminate_children TERM INT EXIT

# A failed terminal listener must restart the container instead of leaving a
# healthy-looking code editor with a broken project resource.
wait -n "${essential_pids[@]}"
exit_status=$?
exit "${exit_status}"
