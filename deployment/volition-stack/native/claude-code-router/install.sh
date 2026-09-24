#!/usr/bin/env bash
# Helena's model router for the owner's own Claude Code (docs/helena-decisions/decisions.md
# §4.3): a UserPromptSubmit hook that asks Helena's decisions service whether a cheaper Claude
# tier can handle the prompt as a subagent, the /router skill, and two small hooks that
# remember each session's model. Runs as the owner (no sudo), in the owner terminal:
#
#   deployment/volition-stack/native/claude-code-router/install.sh install [--session-model opus] [--claude-md]
#   deployment/volition-stack/native/claude-code-router/install.sh status
#   deployment/volition-stack/native/claude-code-router/install.sh uninstall [--purge]
#
# It never switches the router on and never writes a key: the owner creates a Helena API key
# (Konto → API-Schlüssel) and puts it into ~/.claude/helena-router/key himself, then /router on.
# Only the prompt text goes to Helena; Helena answers with a short factual note or nothing.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
CLAUDE_DIR=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
DIR=$CLAUDE_DIR/helena-router
SKILL_DIR=$CLAUDE_DIR/skills/router
SETTINGS=$CLAUDE_DIR/settings.json
CLAUDE_MD=$CLAUDE_DIR/CLAUDE.md

log() { printf 'helena-router: %s\n' "$*"; }
die() { printf 'helena-router: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] || die "run as the owner, not as root"
command -v python3 >/dev/null || die "python3 is missing"

# Adds (or with "remove" takes out) the router's hook entries in settings.json, keeping
# everything else, with a backup first.
merge_settings() {
  local action=$1
  mkdir -p "$CLAUDE_DIR"
  [ -f "$SETTINGS" ] && cp -p "$SETTINGS" "$SETTINGS.bak-helena-router-$(date +%Y%m%d%H%M%S)"
  python3 - "$SETTINGS" "$DIR" "$action" <<'PY'
import json, os, sys
path, directory, action = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    with open(path, encoding="utf-8") as handle:
        settings = json.load(handle)
except FileNotFoundError:
    settings = {}
hooks = settings.setdefault("hooks", {})
ours = lambda handler: "helena-router/" in str(handler.get("command", ""))
for event in ("UserPromptSubmit", "SessionStart", "PostModelSwitch"):
    groups = [
        {**group, "hooks": [h for h in group.get("hooks", []) if not ours(h)]}
        for group in hooks.get(event, [])
    ]
    hooks[event] = [group for group in groups if group["hooks"]]
if action == "install":
    hooks["UserPromptSubmit"].append({"hooks": [{
        "type": "command",
        "command": f'python3 "{directory}/route.py" || true',
        "timeout": 8,
        "statusMessage": "Helena wählt das Modell …",
    }]})
    for event in ("SessionStart", "PostModelSwitch"):
        hooks[event].append({"hooks": [{
            "type": "command",
            "command": f'python3 "{directory}/session.py" || true',
            "timeout": 5,
        }]})
for event in list(hooks):
    if not hooks[event]:
        del hooks[event]
if not hooks:
    settings.pop("hooks", None)
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as handle:
    json.dump(settings, handle, indent=2, ensure_ascii=False)
    handle.write("\n")
os.replace(tmp, path)
PY
}

CLAUDE_RULE='<!-- helena-router -->
## Helena-Modellwahl
When a system reminder from "Helena model router" says a subagent with a cheaper model is
expected to handle the request well, delegate the request to a subagent with the Agent tool and
that `model`: give it a self-contained prompt (the paths, what to read, the expected result) and
relay its result instead of redoing the work. When it says the session model stays, handle the
request yourself. The note is advice: if the task clearly needs this conversation or more care,
handle it yourself.
<!-- /helena-router -->'

install_all() {
  local session_model=opus claude_md=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --session-model) session_model=$2; shift 2 ;;
      --claude-md) claude_md=1; shift ;;
      *) die "unknown option $1" ;;
    esac
  done
  install -d -m 0700 "$DIR" "$DIR/sessions"
  install -m 0700 "$here/route.py" "$here/router.py" "$here/session.py" "$DIR/"
  if [ ! -f "$DIR/config.json" ]; then
    printf '{\n  "helenaUrl": "http://127.0.0.1:3000",\n  "sessionModel": "%s",\n  "timeoutSeconds": 5,\n  "quiet": false,\n  "logPrompt": false\n}\n' "$session_model" >"$DIR/config.json"
    chmod 0600 "$DIR/config.json"
  fi
  install -d -m 0755 "$SKILL_DIR"
  install -m 0644 "$here/skill/SKILL.md" "$SKILL_DIR/SKILL.md"
  merge_settings install
  if [ "$claude_md" = 1 ] && ! grep -q '<!-- helena-router -->' "$CLAUDE_MD" 2>/dev/null; then
    printf '\n%s\n' "$CLAUDE_RULE" >>"$CLAUDE_MD"
    log "rule added to $CLAUDE_MD"
  fi
  log "installed (off). Next:"
  log "  1. Helena → Konto → API-Schlüssel: create a key, then: install -m 600 /dev/stdin $DIR/key  (paste, Ctrl-D)"
  log "  2. Helena → Einstellungen → Entscheidungen → Modellwahl: connection chosen, eval passed, on"
  log "  3. Restart Claude Code, then /router test Suche die Datei mit der Login-Route  and  /router on"
  [ "$claude_md" = 1 ] || log "  (optional) rerun with --claude-md to add the standing rule to $CLAUDE_MD"
}

status() {
  [ -d "$DIR" ] || { log "not installed"; return; }
  python3 "$DIR/router.py" status
}

uninstall() {
  merge_settings remove
  rm -rf "$SKILL_DIR"
  if [ -f "$CLAUDE_MD" ] && grep -q '<!-- helena-router -->' "$CLAUDE_MD"; then
    python3 - "$CLAUDE_MD" <<'PY'
import re, sys
path = sys.argv[1]
text = open(path, encoding="utf-8").read()
open(path, "w", encoding="utf-8").write(
    re.sub(r"\n?<!-- helena-router -->.*?<!-- /helena-router -->\n?", "\n", text, flags=re.S))
PY
  fi
  if [ "${1:-}" = "--purge" ]; then
    rm -rf "$DIR"
    log "removed, with key, config and log"
  else
    rm -f "$DIR/enabled"
    log "removed from Claude Code; $DIR (key, config, log) kept (--purge removes it)"
  fi
}

case "${1:-}" in
  install) shift; install_all "$@" ;;
  status) status ;;
  uninstall) shift; uninstall "${1:-}" ;;
  *) echo "usage: $0 install [--session-model opus] [--claude-md] | status | uninstall [--purge]" >&2; exit 2 ;;
esac
