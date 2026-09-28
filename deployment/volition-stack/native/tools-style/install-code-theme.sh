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
install -m 0644 "$source_dir/theme-sync.js" "$target/theme-sync.js"
install -m 0644 "$source_dir/themes/dark.json" "$target/themes/dark.json"
install -m 0644 "$source_dir/themes/light.json" "$target/themes/light.json"
install -m 0644 "$source_dir/icons/icons.json" "$target/icons/icons.json"
install -m 0644 "$source_dir/icons/file.svg" "$target/icons/file.svg"
install -m 0644 "$source_dir/icons/folder.svg" "$target/icons/folder.svg"
install -m 0644 "$source_dir/icons/folder-open.svg" "$target/icons/folder-open.svg"
echo "Installed Helena themes in $target"
