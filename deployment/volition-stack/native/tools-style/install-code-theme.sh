#!/usr/bin/env bash
set -euo pipefail

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/code-theme" && pwd)"
extension_dir="${1:-${HOME}/.local/share/code-server/extensions}"
target="${extension_dir}/helena.helena-themes-1.0.0"
mkdir -p "$extension_dir"
if [[ -L "$target" ]]; then
  echo "Refusing to replace a symlink: $target" >&2
  exit 1
fi
mkdir -p "$target/themes"
mkdir -p "$target/icons"
install -m 0644 "$source_dir/package.json" "$target/package.json"
install -m 0644 "$source_dir/themes/dark.json" "$target/themes/dark.json"
install -m 0644 "$source_dir/themes/light.json" "$target/themes/light.json"
install -m 0644 "$source_dir/icons/icons.json" "$target/icons/icons.json"
install -m 0644 "$source_dir/icons/file.svg" "$target/icons/file.svg"
install -m 0644 "$source_dir/icons/folder.svg" "$target/icons/folder.svg"
install -m 0644 "$source_dir/icons/folder-open.svg" "$target/icons/folder-open.svg"
echo "Installed Helena themes in $target"

settings_dir="${HOME}/.local/share/code-server/User"
settings="${settings_dir}/settings.json"
if [[ -L "$settings" ]]; then
  echo "Kept linked settings unchanged: $settings"
  exit 0
fi
mkdir -p "$settings_dir"
python3 - "$settings" <<'PY'
import os
import re
import sys
import tempfile

path = sys.argv[1]
if os.path.exists(path):
    with open(path, encoding='utf-8') as handle:
        source = handle.read()
    mode = os.stat(path).st_mode & 0o777
else:
    source = '{}\n'
    mode = 0o600

if re.search(r'"(?:workbench\.colorTheme|window\.autoDetectColorScheme)"\s*:', source):
    sys.exit(0)
if not source.lstrip().startswith('{') or not source.rstrip().endswith('}'):
    raise SystemExit('Refusing to edit settings that are not a JSON object')

start = source.index('{') + 1
has_keys = re.search(r'"[^"\n]+"\s*:', source[start:]) is not None
insertion = '\n  "window.autoDetectColorScheme": true' + (',\n' if has_keys else '\n')
updated = source[:start] + insertion + source[start:]
fd, temporary = tempfile.mkstemp(prefix='.settings-', dir=os.path.dirname(path))
try:
    os.fchmod(fd, mode)
    with os.fdopen(fd, 'w', encoding='utf-8') as handle:
        handle.write(updated)
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
PY
