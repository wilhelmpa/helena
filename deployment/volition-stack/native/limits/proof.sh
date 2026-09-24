#!/bin/sh
# Proof of the plan limits on a live install, after the merge and deploy
# (docs/helena-decisions/provider-limits.md). Prints numbers only: providers, plans,
# windows, used shares, reset times, agents. Never a token, e-mail or account id: the
# snapshots carry only a hash of the account, and this script prints not even that.
# Usage: sudo ./proof.sh [--owner <user>]
set -eu
owner=wilhelmpa
[ "${1:-}" = "--owner" ] && owner=$2
plan=/srv/volition/source/plan
cli=$plan/packages/runner/dist/cli.js
hermes_home=/var/lib/volition/hermes
venv=$hermes_home/venv

summary() {
  python3 -c "$SUMMARY"
}
SUMMARY='
import json, sys
doc = json.load(sys.stdin)
for s in doc.get("snapshots", []):
    head = [s["provider"], "plan=%s" % (s.get("plan") or "-"), "source=%s" % s["source"],
            "login=%s" % (s.get("login") or "-"), "via=%s" % s["via"], "observed=%s" % s["observedAt"]]
    if s.get("unavailable"):
        head.append("unavailable=%s" % s["unavailable"])
    print("  " + "  ".join(head))
    for w in s.get("windows", []):
        print("    %-28s %-8s used=%s%%  window=%s min  resets=%s" % (
            w["id"], w["kind"], w.get("usedPercent"), w.get("windowMinutes"), w.get("resetsAt")))
if not doc.get("snapshots"):
    print("  (no snapshots)")
'

echo "1. Hermes (runner user, Hermes' own account_usage), provider openai-codex:"
sudo -u volition-hermes env HOME=$hermes_home HERMES_HOME=$hermes_home \
  PATH=$venv/bin:/usr/local/bin:/usr/bin:/bin HERMES_PYTHON=$venv/bin/python \
  /usr/local/bin/node "$cli" limits-probe --runtime hermes --home "$hermes_home" \
  --provider openai-codex 2>/dev/null | summary

owner_home=$(getent passwd "$owner" | cut -d: -f6)
echo "2. Owner reporter ($owner: Claude Code /usage and Codex app-server), to stdout:"
sudo -u "$owner" env HOME="$owner_home" PATH="$owner_home/.local/bin:/usr/local/bin:/usr/bin:/bin" \
  /usr/local/bin/node "$cli" limits-report 2>/dev/null | summary

echo "3. What Helena stored (helena_provider_limit):"
sudo -u postgres psql -d itsaplan -At -F ' | ' -c "
  SELECT l.provider, coalesce(l.plan, '-'), l.source, coalesce(l.login, '-'), l.via,
         to_char(l.observed_at, 'YYYY-MM-DD HH24:MI:SS'),
         (SELECT string_agg(w->>'id' || '=' || coalesce(w->>'usedPercent', '?') || '%', ', ')
            FROM jsonb_array_elements(l.windows) w),
         (SELECT count(*) FROM helena_provider_limit_agent a WHERE a.limit_id = l.id) || ' agents'
  FROM helena_provider_limit l ORDER BY l.provider, l.id"
echo "4. Timer and spool:"
systemctl is-active helena-owner-limits.timer 2>/dev/null || echo "  timer not installed"
ls -l /var/lib/helena-limits/reports 2>/dev/null || echo "  no spool"
