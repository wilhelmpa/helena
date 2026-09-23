#!/usr/bin/env bash
set -euo pipefail

version=1.5.0
archive=kasmvncserver_trixie_${version}_amd64.deb
url=https://github.com/kasmtech/KasmVNC/releases/download/v${version}/${archive}
digest=80b241de7dfe53bba2b7e1cc5ac8c5246d72271efa16be2d4f76607f30fab1c4
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT

curl --fail --location --retry 3 --output "$temporary/$archive" "$url"
printf '%s  %s\n' "$digest" "$temporary/$archive" | sha256sum --check --strict
sudo apt-get install -y "$temporary/$archive"
sudo install -m 0644 native/systemd/volition-project-browser-kasm@.service /etc/systemd/system/
sudo install -m 0644 native/systemd/volition-project-browser-chromium@.service /etc/systemd/system/
sudo install -m 0644 native/systemd/volition-project-browser@.target /etc/systemd/system/
sudo systemctl daemon-reload
