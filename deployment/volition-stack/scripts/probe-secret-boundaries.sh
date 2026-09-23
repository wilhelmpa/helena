#!/usr/bin/env bash
set -euo pipefail

stack=/home/pw/services/volition-stack
backup=/home/pw/services/volition-backups/current
vault_container=volition-vault-vaultwarden-1
mastra_container=volition-mastra-studio-studio-1

python3 - "$vault_container" "$mastra_container" <<'PY'
import json
import subprocess
import sys

def inspect(name):
    return json.loads(subprocess.check_output(['docker', 'inspect', name], text=True))[0]

vault = inspect(sys.argv[1])
config = dict(item.split('=', 1) for item in vault['Config']['Env'] if '=' in item)
required = {
    'SIGNUPS_ALLOWED': 'false',
    'INVITATIONS_ALLOWED': 'false',
    'SENDS_ALLOWED': 'false',
    'EMERGENCY_ACCESS_ALLOWED': 'false',
    'DISABLE_ICON_DOWNLOAD': 'true',
}
assert all(config.get(key) == value for key, value in required.items())
assert vault['HostConfig']['ReadonlyRootfs'] is True
assert not vault['NetworkSettings']['Ports']
assert vault['State']['Health']['Status'] == 'healthy'
networks = list(vault['NetworkSettings']['Networks'])
assert len(networks) == 1
network = json.loads(subprocess.check_output(['docker', 'network', 'inspect', networks[0]], text=True))[0]
assert network['Internal'] is True

mastra = inspect(sys.argv[2])
assert not mastra['NetworkSettings']['Ports']
names = {item.split('=', 1)[0].upper() for item in mastra['Config']['Env'] if '=' in item}
for fragment in ('GMAIL', 'MAIL_PASSWORD', 'GIT_TOKEN', 'GITHUB_TOKEN', 'BROWSER_TOKEN', 'BROWSER_SECRET'):
    assert all(fragment not in name for name in names)
assert all(mount['Destination'] != '/home/pw/services/volition-stack/data/hermes' for mount in mastra['Mounts'])
print('runtime-boundaries: ok')
PY

if ! command -v hermes >/dev/null 2>&1; then
  echo "Hermes executable is unavailable" >&2
  exit 1
fi
echo "hermes-runtime: present"

python3 "$stack/backup/tests/restore-vault.py" \
  "$backup/vaultwarden-volumes.tar" \
  "$backup/vaultwarden-manifest.json" >/dev/null
echo 'vault-restore-artifact: ok'
