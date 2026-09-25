#!/usr/bin/env bash
# Helena's local decision server: Laya, browser-tuned (docs/helena-decisions/browser-task.md §3.8).
# The browser's fast path (browser_task) asks it "which operation, which element" in TypeSafe's
# System One format; page content stays on this machine. Owner OK for the install and the
# downloads (~1.5 GB: PyTorch CPU wheel, Laya, the cklxx/laya-browser v10s checkpoint): 2026-09-24.
#
#   sudo deployment/volition-stack/native/laya/install.sh install     # or: status, rotate-key,
#                                                                     #     uninstall [--purge]
#   sudo deployment/volition-stack/native/laya/install.sh install --rocm
#
# --rocm: Laya on the GPU. No second PyTorch: the venv reaches the ROCm 10.0.0 tree of
# native/local-ai/install.sh (/opt/helena-ai/rocm-10.0.0: ROCm and torch 2.13.0+rocm10.0.0,
# hash-pinned) through a .pth line, and the service gets /dev/kfd and the render node
# (docs/helena-decisions/local-ai-platform.md §4.6). Without it: PyTorch CPU, as before.
#
# What it does (install): a system user helena-laya; a venv in /opt/helena/laya with pinned
# PyTorch (CPU) and Laya; the checkpoint at a pinned revision in /var/lib/helena-laya/models
# (safetensors only, checked against its SHA-256); a generated key in /etc/helena/laya.key
# (root:volition-plan 0640: the API reads it, the service gets it through systemd's credentials);
# helena-laya.service on 127.0.0.1:8791 with CPU and memory limits; a health check and one probe.
# In Helena: Zugänge → Hinzufügen → Entscheidungsmodell (Jev) → "Laya (lokal auf diesem Server)".
set -euo pipefail

LAYA_VERSION=0.3.20
TORCH_VERSION=${HELENA_LAYA_TORCH_VERSION:-2.14.0}
TORCH_INDEX=https://download.pytorch.org/whl/cpu
MODEL_REPO=cklxx/laya-browser
MODEL_REVISION=4219958196e2c566c141688c773e08da10c1ff3b
SUBFOLDER=v10s
# SHA-256 of v10s/model.safetensors at MODEL_REVISION (Hugging Face LFS oid).
MODEL_SHA256=${HELENA_LAYA_MODEL_SHA256:-b11217df18bf79cfcd4ab639caf1ae8652b91c9c44fcb9457fbe480237332335}

SERVICE_USER=helena-laya
PREFIX=/opt/helena/laya
STATE=/var/lib/helena-laya
KEY_DIR=/etc/helena
KEY_FILE=$KEY_DIR/laya.key
API_GROUP=${HELENA_API_GROUP:-volition-plan}
UNIT=/etc/systemd/system/helena-laya.service
ROCM_DROPIN=/etc/systemd/system/helena-laya.service.d/rocm.conf
ROCM_VENV=/opt/helena-ai/rocm-10.0.0
PORT=8791
here=$(cd "$(dirname "$0")" && pwd)

log() { printf 'helena-laya: %s\n' "$*"; }
die() { printf 'helena-laya: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo)"
command -v uv >/dev/null || die "uv is missing (/usr/local/bin/uv)"
command -v python3.13 >/dev/null || die "python3.13 is missing"

probe() {
  local key
  key=$(cat "$KEY_FILE")
  curl -sf -m 60 -H "Authorization: Bearer $key" -H 'content-type: application/json' \
    -d '{"model":"laya-browser","state":{"page":{"url":"https://example.org/","title":"Example","text":"Example Domain. More information..."}},"questions":{"operation":{"type":"choice","instructions":{"goal":"Open the more information link"},"criteria":{"CLICK":"Click an element","DONE":"Every requirement is visibly satisfied."}}}}' \
    "http://127.0.0.1:$PORT/v1/systemone"
}

install_all() {
  local rocm=0
  [ "${1:-}" = "--rocm" ] && rocm=1
  if [ "$rocm" = 1 ]; then
    [ -x "$ROCM_VENV/bin/python" ] || die "no ROCm tree: run native/local-ai/install.sh install first"
    [ -c /dev/kfd ] || die "no /dev/kfd: boot kernel 7.1.8 first (native/local-ai/kernel.sh)"
  fi
  id "$SERVICE_USER" >/dev/null 2>&1 ||
    useradd --system --home-dir "$STATE" --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  getent group "$API_GROUP" >/dev/null || die "group $API_GROUP (the API's) does not exist"
  install -d -o root -g root -m 0755 /opt/helena "$PREFIX"
  install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0750 "$STATE" "$STATE/models" "$STATE/hf"
  install -d -o root -g root -m 0755 /var/cache/helena-laya

  export UV_CACHE_DIR=/var/cache/helena-laya/uv
  [ -x "$PREFIX/venv/bin/python" ] || uv venv -q -p python3.13 "$PREFIX/venv"
  local sp
  sp=$("$PREFIX/venv/bin/python" -c 'import sysconfig; print(sysconfig.get_path("purelib"))')
  if [ "$rocm" = 1 ]; then
    log "venv with Laya $LAYA_VERSION; PyTorch and ROCm from $ROCM_VENV"
    # A CPU torch of an earlier install would shadow the shared one.
    uv pip uninstall -q --python "$PREFIX/venv/bin/python" torch 2>/dev/null || true
    # The shared tree's packages sit behind Laya's own; the override keeps torch out of
    # Laya's resolution, so nothing downloads a second PyTorch.
    echo "$ROCM_VENV/lib/python3.13/site-packages" > "$sp/helena-rocm.pth"
    printf 'torch; sys_platform == "never"\n' > /var/cache/helena-laya/no-torch.txt
    uv pip install -q --python "$PREFIX/venv/bin/python" --override /var/cache/helena-laya/no-torch.txt \
      "laya==$LAYA_VERSION" "huggingface_hub>=0.20"
  else
    log "venv with PyTorch $TORCH_VERSION (CPU) and Laya $LAYA_VERSION"
    rm -f "$sp/helena-rocm.pth"
    uv pip install -q --python "$PREFIX/venv/bin/python" --index-url "$TORCH_INDEX" "torch==$TORCH_VERSION"
    uv pip install -q --python "$PREFIX/venv/bin/python" "laya==$LAYA_VERSION" "huggingface_hub>=0.20"
  fi
  install -o root -g root -m 0644 "$here/helena_laya_serve.py" "$PREFIX/helena_laya_serve.py"

  log "checkpoint $MODEL_REPO@$MODEL_REVISION ($SUBFOLDER)"
  sudo -u "$SERVICE_USER" HF_HOME="$STATE/hf" "$PREFIX/venv/bin/python" - <<PY
from huggingface_hub import snapshot_download
snapshot_download("$MODEL_REPO", revision="$MODEL_REVISION", allow_patterns=["$SUBFOLDER/*"],
                  local_dir="$STATE/models/laya-browser")
PY
  local weights="$STATE/models/laya-browser/$SUBFOLDER/model.safetensors"
  [ -f "$weights" ] || die "the checkpoint did not download"
  if [ -n "$MODEL_SHA256" ]; then
    echo "$MODEL_SHA256  $weights" | sha256sum -c --quiet - || die "checkpoint checksum mismatch"
  else
    log "checkpoint sha256: $(sha256sum "$weights" | cut -d' ' -f1) (pin it in MODEL_SHA256)"
  fi

  install -d -o root -g root -m 0755 "$KEY_DIR"
  if [ ! -s "$KEY_FILE" ]; then
    log "generating the key $KEY_FILE"
    (umask 077; head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | head -c 48 >"$KEY_FILE")
  fi
  chown "root:$API_GROUP" "$KEY_FILE"
  chmod 0640 "$KEY_FILE"

  install -o root -g root -m 0644 "$here/helena-laya.service" "$UNIT"
  if [ "$rocm" = 1 ]; then
    install -d -o root -g root -m 0755 "$(dirname "$ROCM_DROPIN")"
    # The GPU for this service only: the KFD and the render node, nothing else of /dev. ROCm's
    # libraries are mapped into the process (charged to its memory), hence the higher ceiling.
    cat >"$ROCM_DROPIN" <<EOF
[Service]
Environment=HELENA_LAYA_DEVICE=cuda
PrivateDevices=no
DevicePolicy=closed
DeviceAllow=/dev/kfd rw
DeviceAllow=/dev/dri/renderD128 rw
SupplementaryGroups=render video
MemoryHigh=6G
MemoryMax=8G
EOF
    chmod 0644 "$ROCM_DROPIN"
  else
    rm -f "$ROCM_DROPIN"
  fi
  systemctl daemon-reload
  systemctl enable --now helena-laya.service
  systemctl restart helena-laya.service
  log "waiting for the model to load"
  for _ in $(seq 1 90); do
    curl -sf -m 2 "http://127.0.0.1:$PORT/health" >/dev/null && break
    sleep 2
  done
  curl -sf -m 2 "http://127.0.0.1:$PORT/health" >/dev/null || die "the service does not answer (journalctl -u helena-laya)"
  probe >/dev/null || die "the probe failed (journalctl -u helena-laya)"
  log "ready on http://127.0.0.1:$PORT — in Helena: Zugänge → Entscheidungsmodell (Jev) → Laya (lokal auf diesem Server)"
}

status() {
  systemctl --no-pager --lines=5 status helena-laya.service || true
  curl -s -m 2 "http://127.0.0.1:$PORT/health" && echo
  [ -f "$KEY_FILE" ] && stat -c 'key: %U:%G %a %n' "$KEY_FILE"
  "$PREFIX/venv/bin/python" -c 'import torch, laya; print("torch", torch.__version__, "hip", torch.version.hip, "laya", laya.__version__)' 2>/dev/null || true
  [ -f "$ROCM_DROPIN" ] && log "on the GPU (ROCm, $ROCM_DROPIN); the log says where the model loaded" || true
}

rotate_key() {
  (umask 077; head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | head -c 48 >"$KEY_FILE.new")
  chown "root:$API_GROUP" "$KEY_FILE.new"
  chmod 0640 "$KEY_FILE.new"
  mv "$KEY_FILE.new" "$KEY_FILE"
  systemctl restart helena-laya.service
  log "key rotated; Helena reads it on the next call"
}

uninstall() {
  systemctl disable --now helena-laya.service 2>/dev/null || true
  rm -f "$UNIT" "$ROCM_DROPIN"
  rmdir "$(dirname "$ROCM_DROPIN")" 2>/dev/null || true
  systemctl daemon-reload
  if [ "${1:-}" = "--purge" ]; then
    rm -rf "$PREFIX" "$STATE" /var/cache/helena-laya "$KEY_FILE"
    userdel "$SERVICE_USER" 2>/dev/null || true
    log "removed with venv, checkpoint and key"
  else
    log "service removed; venv, checkpoint and key kept (--purge removes them)"
  fi
}

case "${1:-}" in
  install) install_all "${2:-}" ;;
  status) status ;;
  rotate-key) rotate_key ;;
  uninstall) uninstall "${2:-}" ;;
  *) echo "usage: $0 install [--rocm]|status|rotate-key|uninstall [--purge]" >&2; exit 2 ;;
esac
