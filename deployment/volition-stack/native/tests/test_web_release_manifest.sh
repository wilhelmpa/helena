#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tool=$here/web-artifact.py
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
commit=0123456789abcdef0123456789abcdef01234567
other=fedcba9876543210fedcba9876543210fedcba98
lock=$(printf 'lock\n' | sha256sum | cut -d' ' -f1)
bad_lock=$(printf 'different\n' | sha256sum | cut -d' ' -f1)
mkdir -p "$tmp/web-${commit:0:12}/standalone/apps/web" "$tmp/web-${commit:0:12}/static"
printf 'server\n' >"$tmp/web-${commit:0:12}/standalone/apps/web/server.js"
python3 - "$tmp/web-${commit:0:12}" "$commit" "$lock" <<'PY'
import hashlib, json, pathlib, sys
root, commit, lock = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
file = root / 'standalone/apps/web/server.js'
digest = hashlib.sha256(file.read_bytes()).hexdigest()
(root / 'manifest.json').write_text(json.dumps({
    'format': 1, 'commit': commit, 'lockfileSha256': lock,
    'deploymentId': commit[:12], 'platform': 'linux-x64', 'links': {},
    'buildHost': 'fixture', 'node': 'v24', 'bun': '1.4.0',
    'files': {'standalone/apps/web/server.js': digest}
}))
(root / 'SHA256SUMS').write_text(digest + '  standalone/apps/web/server.js\n')
PY
tar -C "$tmp" -czf "$tmp/release.tar.gz" "web-${commit:0:12}"
python3 "$tool" archive "$tmp/release.tar.gz" --commit "$commit" --lockfile-sha256 "$lock" >/dev/null
if python3 "$tool" archive "$tmp/release.tar.gz" --commit "$other" --lockfile-sha256 "$lock" >/dev/null 2>&1; then
  echo 'wrong commit accepted' >&2; exit 1
fi
if python3 "$tool" archive "$tmp/release.tar.gz" --commit "$commit" --lockfile-sha256 "$bad_lock" >/dev/null 2>&1; then
  echo 'wrong lockfile hash accepted' >&2; exit 1
fi
printf 'tampered\n' >"$tmp/web-${commit:0:12}/standalone/apps/web/server.js"
tar -C "$tmp" -czf "$tmp/tampered.tar.gz" "web-${commit:0:12}"
if python3 "$tool" archive "$tmp/tampered.tar.gz" --commit "$commit" --lockfile-sha256 "$lock" >/dev/null 2>&1; then
  echo 'tampered file accepted' >&2; exit 1
fi
echo 'web release manifest checks passed'
