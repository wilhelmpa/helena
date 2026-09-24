#!/usr/bin/env bash
set -euo pipefail
umask 077

PLAN_ROOT="${PLAN_ROOT:-/home/pw/services/itsaplan}"
STACK_ROOT="${STACK_ROOT:-/home/pw/services/volition-stack}"
HERMES_ROOT="${HERMES_ROOT:-/home/pw/services/hermes-agent}"
HERMES_HOME="${HERMES_HOME:-$STACK_ROOT/data/hermes}"
UNIT_ROOT="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
HERMES_REMOTE="https://github.com/NousResearch/hermes-agent.git"
HERMES_COMMIT="836b5f8253d27fee79b4f833bc43624f06a890b3"
UV_VERSION="0.12.17"
TIRITH_VERSION="0.4.2"
AGENT_BROWSER_VERSION="0.26.0"
AGENT_BROWSER_SHA512="a5da927e3c1b152a7eaa7c256f6836ddef705ef78839f322d7dc693c0f716546f3100529e96e180598fa61b8fccf833b5a471b1830d873ea032070edf51dc40d"
DRY_RUN=false

usage() {
  cat <<'EOF'
Usage: deployment/volition-stack/install.sh [--dry-run]

Installs the pinned Hermes runtime, validates the pinned Tirith scanner, builds
the Plan runner, starts the configured Compose bundles, and enables the Hermes
first-owner bootstrap timer. It never creates provider credentials. Existing
private .env, .secrets, and gateway configuration must be present first.
EOF
}

while (($#)); do
  case "$1" in
    --dry-run) DRY_RUN=true ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

run() {
  if "$DRY_RUN"; then
    printf '+ '
    printf '%q ' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "Required deployment file is missing: $1" >&2
    exit 1
  fi
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command is unavailable: $1" >&2
    exit 1
  fi
}

for command in docker git curl tar sha256sum sha512sum systemctl loginctl node npm; do
  require_command "$command"
done

for path in \
  "$PLAN_ROOT/package.json" \
  "$PLAN_ROOT/bun.lock" \
  "$PLAN_ROOT/deployment/volition-stack/compose.hub.yml" \
  "$PLAN_ROOT/deployment/volition-stack/integration/scripts/volition-hermes-bootstrap" \
  "$PLAN_ROOT/deployment/volition-stack/integration/systemd/volition-hermes-bootstrap.service" \
  "$PLAN_ROOT/deployment/volition-stack/integration/systemd/volition-hermes-bootstrap.timer" \
  "$PLAN_ROOT/deployment/volition-stack/integration/systemd/volition-provisioning.service" \
  "$PLAN_ROOT/.env" \
  "$STACK_ROOT/.env" \
  "$STACK_ROOT/config/gateway.json"; do
  require_file "$path"
done

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is unavailable." >&2
  exit 1
fi

install_uv() {
  local arch target checksum archive stage binary
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64)
      target="x86_64-unknown-linux-gnu"
      checksum="fa82fd8dde8e8eefdecada6aa0889666556cfceb690d06e0c3bca49eb3070a63"
      ;;
    aarch64|arm64)
      target="aarch64-unknown-linux-gnu"
      checksum="d636d1b678e9e7f367ecb22b46bd1cabbed234d6bc3b4d96365d2b507f72f86c"
      ;;
    *)
      echo "uv $UV_VERSION has no pinned Linux binary for architecture: $arch" >&2
      exit 1
      ;;
  esac
  UV_BIN="$STACK_ROOT/tools/uv-$UV_VERSION/uv"
  if [[ -x "$UV_BIN" ]] && "$UV_BIN" --version | grep -Eq "^uv ${UV_VERSION//./\\.}([[:space:]]|$)"; then
    return 0
  fi
  if "$DRY_RUN"; then
    run install -d -m 700 "$(dirname "$UV_BIN")"
    run curl --fail --location --proto '=https' --tlsv1.2 --retry 3 --output '<uv-archive>' \
      "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${target}.tar.gz"
    run sha256sum --check --status '<uv-sha256-manifest>'
    return 0
  fi
  run install -d -m 700 "$(dirname "$UV_BIN")"
  stage="$(mktemp -d "$STACK_ROOT/.uv-install.XXXXXX")"
  trap "rm -rf -- '$stage'" EXIT
  archive="$stage/uv.tar.gz"
  run curl --fail --location --proto '=https' --tlsv1.2 --retry 3 --output "$archive" \
    "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${target}.tar.gz"
  if ! "$DRY_RUN"; then
    printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --status
  fi
  run tar --extract --gzip --file "$archive" --directory "$stage"
  if ! "$DRY_RUN"; then
    binary="$(find "$stage" -type f -name uv -print -quit)"
    if [[ -z "$binary" ]]; then
      echo "Pinned uv archive contains no executable." >&2
      exit 1
    fi
    install -m 700 "$binary" "$UV_BIN"
    "$UV_BIN" --version | grep -Eq "^uv ${UV_VERSION//./\\.}([[:space:]]|$)"
  fi
  trap - EXIT
  rm -rf "$stage"
}

install_hermes() {
  local parent stage head origin
  parent="$(dirname "$HERMES_ROOT")"
  if [[ -e "$HERMES_ROOT" ]]; then
    if [[ ! -d "$HERMES_ROOT/.git" ]]; then
      echo "Hermes path exists but is not a Git checkout: $HERMES_ROOT" >&2
      exit 1
    fi
    if [[ -n "$(git -C "$HERMES_ROOT" status --porcelain)" ]]; then
      echo "Hermes checkout is dirty: $HERMES_ROOT" >&2
      exit 1
    fi
    origin="$(git -C "$HERMES_ROOT" remote get-url origin)"
    if [[ "$origin" != "$HERMES_REMOTE" ]]; then
      echo "Hermes origin differs from the pinned upstream." >&2
      exit 1
    fi
    run git -C "$HERMES_ROOT" fetch --depth 1 origin "$HERMES_COMMIT"
    run git -C "$HERMES_ROOT" checkout --detach "$HERMES_COMMIT"
  else
    run install -d -m 700 "$parent"
    if "$DRY_RUN"; then
      stage="$parent/.hermes-agent-install.dry-run"
    else
      stage="$(mktemp -d "$parent/.hermes-agent-install.XXXXXX")"
    fi
    trap "rm -rf -- '$stage'" EXIT
    run git clone --no-checkout --filter=blob:none "$HERMES_REMOTE" "$stage/repo"
    run git -C "$stage/repo" fetch --depth 1 origin "$HERMES_COMMIT"
    run git -C "$stage/repo" checkout --detach "$HERMES_COMMIT"
    if ! "$DRY_RUN"; then
      mv "$stage/repo" "$HERMES_ROOT"
    fi
    trap - EXIT
    if ! "$DRY_RUN"; then rm -rf "$stage"; fi
  fi
  if ! "$DRY_RUN"; then
    head="$(git -C "$HERMES_ROOT" rev-parse HEAD)"
    if [[ "$head" != "$HERMES_COMMIT" ]]; then
      echo "Pinned Hermes checkout verification failed." >&2
      exit 1
    fi
  fi

  if [[ ! -x "$HERMES_ROOT/venv/bin/python" ]]; then
    run env UV_PROJECT_ENVIRONMENT="$HERMES_ROOT/venv" "$UV_BIN" venv --python 3.13 "$HERMES_ROOT/venv"
  fi
  run env UV_PROJECT_ENVIRONMENT="$HERMES_ROOT/venv" "$UV_BIN" sync --frozen --extra all --project "$HERMES_ROOT"
  run "$HERMES_ROOT/venv/bin/hermes" --version
}

install_tirith() {
  local arch target checksum archive stage binary destination
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64)
      target="x86_64-unknown-linux-gnu"
      checksum="efa6bf414a83dba385d4f13137e8677f850ced9102fe74ebb14c72f31df0dc77"
      ;;
    aarch64|arm64)
      target="aarch64-unknown-linux-gnu"
      checksum="c550b1bfb0c8c872ab3421cd6ef756f260f7cf4981a18cedd49f141fa2d77569"
      ;;
    *)
      echo "Tirith $TIRITH_VERSION has no pinned Linux binary for architecture: $arch" >&2
      exit 1
      ;;
  esac
  destination="$HERMES_HOME/bin/tirith"
  if [[ -x "$destination" ]] && "$destination" --version 2>/dev/null | grep -Fxq "tirith $TIRITH_VERSION"; then
    return 0
  fi
  if "$DRY_RUN"; then
    run install -d -m 700 "$HERMES_HOME/bin"
    run curl --fail --location --proto '=https' --tlsv1.2 --retry 3 --output '<tirith-archive>' \
      "https://github.com/sheeki03/tirith/releases/download/v${TIRITH_VERSION}/tirith-${target}.tar.gz"
    run sha256sum --check --status '<tirith-sha256-manifest>'
    return 0
  fi
  run install -d -m 700 "$HERMES_HOME/bin"
  stage="$(mktemp -d "$HERMES_HOME/.tirith-install.XXXXXX")"
  trap "rm -rf -- '$stage'" EXIT
  archive="$stage/tirith.tar.gz"
  run curl --fail --location --proto '=https' --tlsv1.2 --retry 3 --output "$archive" \
    "https://github.com/sheeki03/tirith/releases/download/v${TIRITH_VERSION}/tirith-${target}.tar.gz"
  if ! "$DRY_RUN"; then
    printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --status
  fi
  run tar --extract --gzip --file "$archive" --directory "$stage"
  if ! "$DRY_RUN"; then
    binary="$(find "$stage" -type f -name tirith -print -quit)"
    if [[ -z "$binary" ]]; then
      echo "Pinned Tirith archive contains no executable." >&2
      exit 1
    fi
    install -m 700 "$binary" "$destination"
    "$destination" --version | grep -Fxq "tirith $TIRITH_VERSION"
  fi
  trap - EXIT
  rm -rf "$stage"
}

install_agent_browser() {
  local node_root destination link stage archive binary
  node_root="$HERMES_HOME/node"
  destination="$node_root/agent-browser-$AGENT_BROWSER_VERSION"
  link="$node_root/agent-browser"
  binary="$destination/node_modules/.bin/agent-browser"
  if [[ -x "$binary" ]] && "$binary" --version | grep -Fxq "agent-browser $AGENT_BROWSER_VERSION"; then
    if [[ -L "$link" ]] && [[ "$(readlink "$link")" == "$binary" ]]; then
      return 0
    fi
    if [[ -e "$link" || -L "$link" ]]; then
      echo "Hermes agent-browser path conflicts with the pinned runtime." >&2
      exit 1
    fi
    run ln -s "$binary" "$link"
    return 0
  fi
  if [[ -e "$destination" || -L "$destination" ]]; then
    echo "Pinned Hermes agent-browser runtime exists but failed verification." >&2
    exit 1
  fi
  if [[ -e "$link" || -L "$link" ]]; then
    echo "Hermes agent-browser path conflicts with the pinned runtime." >&2
    exit 1
  fi
  if "$DRY_RUN"; then
    run install -d -m 700 "$node_root"
    run npm pack "agent-browser@$AGENT_BROWSER_VERSION" --ignore-scripts --silent --pack-destination '<agent-browser-stage>'
    run sha512sum --check --status '<agent-browser-sha512-manifest>'
    run npm install --prefix '<agent-browser-runtime>' --ignore-scripts --no-audit --no-fund --no-save '<agent-browser-archive>'
    run ln -s "$binary" "$link"
    return 0
  fi
  run install -d -m 700 "$node_root"
  stage="$(mktemp -d "$node_root/.agent-browser-install.XXXXXX")"
  trap "rm -rf -- '$stage'" EXIT
  archive="$stage/agent-browser-$AGENT_BROWSER_VERSION.tgz"
  (cd /tmp && npm pack "agent-browser@$AGENT_BROWSER_VERSION" --ignore-scripts --silent --pack-destination "$stage" >/dev/null)
  printf '%s  %s\n' "$AGENT_BROWSER_SHA512" "$archive" | sha512sum --check --status
  npm install --prefix "$stage/runtime" --ignore-scripts --no-audit --no-fund --no-save "$archive" >/dev/null
  "$stage/runtime/node_modules/.bin/agent-browser" --version | grep -Fxq "agent-browser $AGENT_BROWSER_VERSION"
  if [[ ! -e "$destination" ]]; then
    mv "$stage/runtime" "$destination"
  fi
  ln -s "$binary" "$link"
  trap - EXIT
  rm -rf "$stage"
}

install_runner_assets() {
  local source_root="$PLAN_ROOT/deployment/volition-stack/integration"
  run install -d -m 700 "$STACK_ROOT/integration/scripts" "$STACK_ROOT/integration/hermes-runner" "$UNIT_ROOT"
  run install -m 700 "$source_root/scripts/volition-hermes-bootstrap" "$STACK_ROOT/integration/scripts/volition-hermes-bootstrap"
  run install -m 700 "$source_root/scripts/volition-hermes-runner" "$STACK_ROOT/integration/scripts/volition-hermes-runner"
  run install -m 700 "$source_root/scripts/volition-hermes-catalog.py" "$STACK_ROOT/integration/scripts/volition-hermes-catalog.py"
  run install -m 700 "$source_root/scripts/volition-hermes-browser-smoke.py" "$STACK_ROOT/integration/scripts/volition-hermes-browser-smoke.py"
  run install -m 600 "$source_root/hermes-runner/itsaplan-runner.json" "$STACK_ROOT/integration/hermes-runner/itsaplan-runner.json"
  run install -m 600 "$source_root/systemd/volition-hermes-bootstrap.service" "$UNIT_ROOT/volition-hermes-bootstrap.service"
  run install -m 600 "$source_root/systemd/volition-hermes-bootstrap.timer" "$UNIT_ROOT/volition-hermes-bootstrap.timer"
  run install -m 600 "$source_root/systemd/volition-hermes-runner.service" "$UNIT_ROOT/volition-hermes-runner.service"
  run install -m 600 "$source_root/systemd/volition-provisioning.service" "$UNIT_ROOT/volition-provisioning.service"
}

ensure_foundations() {
  local network
  if "$DRY_RUN"; then
    run docker network inspect volition_control
    run docker network create --internal --subnet 172.30.254.0/29 --gateway 172.30.254.1 volition_control
    run docker volume inspect itsaplan_web-cache
    run docker volume create itsaplan_web-cache
    return 0
  fi

  if docker network inspect volition_control >/dev/null 2>&1; then
    network="$(docker network inspect --format '{{.Internal}} {{range .IPAM.Config}}{{.Subnet}} {{.Gateway}}{{end}}' volition_control)"
    if [[ "$network" != 'true 172.30.254.0/29 172.30.254.1' ]]; then
      echo "Existing volition_control network has an incompatible security configuration." >&2
      exit 1
    fi
  else
    run docker network create --internal --subnet 172.30.254.0/29 --gateway 172.30.254.1 volition_control
  fi

  local volume
  for volume in itsaplan_web-cache volition-nextcloud-db-alpine-20260921-v2 volition-nextcloud-redis-alpine-20260921-v2; do
    if ! docker volume inspect "$volume" >/dev/null 2>&1; then
      run docker volume create "$volume"
    fi
  done
}

build_runner() {
  local image
  if "$DRY_RUN"; then
    run docker run --rm -v "$PLAN_ROOT:/repo" -w /repo '<plan-api-image>' install --frozen-lockfile
    run docker run --rm -v "$PLAN_ROOT:/repo" -w /repo '<plan-api-image>' build packages/runner/src/cli.ts --target=node --outfile=packages/runner/dist/cli.js
    return 0
  fi
  image="$(docker inspect --format '{{.Config.Image}}' itsaplan-api-1)"
  run docker run --rm -v "$PLAN_ROOT:/repo" -w /repo --entrypoint /usr/local/bin/bun "$image" install --frozen-lockfile
  run docker run --rm -v "$PLAN_ROOT:/repo" -w /repo --entrypoint /usr/local/bin/bun "$image" \
    build packages/runner/src/cli.ts --target=node --outfile=packages/runner/dist/cli.js
}

install_uv
install_hermes
run install -d -m 700 "$HERMES_HOME"
install_tirith
install_agent_browser
install_runner_assets
ensure_foundations

run docker compose --env-file "$PLAN_ROOT/.env" -f "$PLAN_ROOT/docker-compose.yml" -f "$PLAN_ROOT/deployment/volition-stack/compose.hub.yml" config --quiet
run docker compose --env-file "$STACK_ROOT/.env" -f "$STACK_ROOT/compose.apps.yml" config --quiet
run docker compose --env-file "$STACK_ROOT/.env" -f "$STACK_ROOT/compose.vault.yml" config --quiet
run docker compose --env-file "$STACK_ROOT/.env" -f "$STACK_ROOT/compose.gateway.yml" config --quiet

run docker compose --env-file "$PLAN_ROOT/.env" -f "$PLAN_ROOT/docker-compose.yml" -f "$PLAN_ROOT/deployment/volition-stack/compose.hub.yml" up -d --wait
build_runner
run docker compose --env-file "$STACK_ROOT/.env" -f "$STACK_ROOT/compose.apps.yml" up -d --wait
run docker compose --env-file "$STACK_ROOT/.env" -f "$STACK_ROOT/compose.vault.yml" up -d --wait
run docker compose --env-file "$STACK_ROOT/.env" -f "$STACK_ROOT/compose.gateway.yml" up -d --wait
run loginctl enable-linger "$USER"
run systemctl --user daemon-reload
run systemctl --user enable --now volition-provisioning.service
run systemctl --user enable --now volition-hermes-bootstrap.timer
run systemctl --user start volition-hermes-bootstrap.service

echo "Volition deploy completed. Hermes=$HERMES_COMMIT Tirith=$TIRITH_VERSION"
