#!/usr/bin/env bash
# Runs the Hermes runner for one project agent against the development API, with a copy
# of that agent's Hermes profile, the runner built from this worktree and Hermes from a
# source checkout of your choice. The live agent, its profile and its sessions are not
# touched. The copy is removed when the runner stops (Ctrl-C, or after MINUTES).
#
#   sudo deployment/volition-stack/native/dev/agent-runner.sh <project-slug> [hermes-source]
#
# The default Hermes source is /srv/volition/source/hermes-dev, the checkout Hermes
# changes are developed in.
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "agent-runner.sh: run with sudo" >&2; exit 1; }
[[ $# -ge 1 ]] || { echo "usage: agent-runner.sh <project-slug> [hermes-source]" >&2; exit 2; }

slug=$1
hermes_source=${2:-/srv/volition/source/hermes-dev}
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../../.." && pwd)
dev_user=$(stat -c %U "$root")
home=/var/lib/volition/hermes
# Hermes gives a home below profiles/ the provider login of the global home.
profile=$home/profiles/dev-$slug
work=$home/dev-runner-$slug
hermes_group=$(id -gn volition-hermes)
as_hermes() { runuser -u volition-hermes -- "$@"; }

[[ -d $home/profiles/$slug ]] || { echo "agent-runner.sh: no Hermes profile $slug" >&2; exit 1; }
cleanup() { as_hermes rm -rf "$profile" "$work"; }
trap cleanup EXIT

as_hermes rm -rf "$profile" "$work"
as_hermes mkdir -m 0700 "$work"
as_hermes cp -a "$home/profiles/$slug" "$profile"
as_hermes rm -f "$profile/run/itsaplan-policy-manifest.json"

bundle=$(runuser -u "$dev_user" -- mktemp --suffix=.js)
runuser -u "$dev_user" -- bash -c "cd '$root/packages/runner' && bun build src/cli.ts --target=node --outfile '$bundle' >/dev/null"
install -m 0600 -o volition-hermes -g "$hermes_group" "$bundle" "$work/cli.js"
rm -f "$bundle"

# The live runner configuration of this agent, pointed at the development API, the
# profile copy and a working directory of its own. It holds the agent's key, so it is
# written for the Hermes user only.
python3 - "$home/run/itsaplan-runner.json" "$work/runner.json" "$slug" "$profile" "$work" <<'EOF'
import json, os, sys
source, target, slug, profile, work = sys.argv[1:6]
live = json.load(open(source))
name = f'hermes-{slug}-coordinator'
agent = next((a for a in live['agents'] if a.get('name') == name), None)
if agent is None:
    raise SystemExit(f'agent-runner.sh: {name} is not in the live runner configuration')
agent = {**agent, 'name': f'dev-{slug}', 'url': 'http://127.0.0.1:3100', 'cwd': work,
         'env': {**agent.get('env', {}), 'HERMES_HOME': profile}}
config = {**{k: v for k, v in live.items() if k != 'agents'}, 'url': 'http://127.0.0.1:3100',
          'agents': [agent]}
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
os.write(fd, json.dumps(config).encode())
os.close(fd)
EOF
chown "volition-hermes:$hermes_group" "$work/runner.json"

echo "dev runner for $slug: Hermes from $hermes_source, profile copy $profile"
as_hermes env HOME="$home" HERMES_HOME="$profile" PYTHONPATH="$hermes_source" \
  PATH="$home/venv/bin:/usr/local/bin:/usr/bin:/bin" \
  timeout "${MINUTES:-30}m" /usr/bin/node "$work/cli.js" "$work/runner.json" || true
