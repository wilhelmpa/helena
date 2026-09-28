#!/usr/bin/env bash
# The suites the gate used to miss (code audit 2026-09-28: ~1,800 tests outside full-test.sh,
# among them a red runner drain). full-test.sh runs this after the app suites; it can also run
# on its own from the repo root:
#
#   scripts/helena-gate-extra.sh            every suite below, exit 1 if any failed
#   scripts/helena-gate-extra.sh --list     print the suites without running them
#
# Needs: `bun install` done, .env.test pointing at a migrated test database (full-test.sh
# starts its own Postgres), python3, node, nft/unshare/nginx for the shell selftests (all
# present on the server; the selftests run unprivileged in their own namespaces).
#
# Not run, on purpose (compose era, replaced by the native install; removed in the rename):
#   deployment/volition-stack/gateway            its npm dependencies (jose, http-proxy) are not
#                                                part of the workspace and never installed
#   deployment/volition-stack/workspace-bridge   the Nextcloud bridge; Nextcloud is gone
#   deployment/volition-stack/backup/tests/restore-*.sh
#                                                restore drills against the compose services'
#                                                folders, not tests
# Already run by full-test.sh: apps/api, apps/web, apps/worker, packages/runner,
# deployment/volition-stack/{integration,browser}, native/syncthing.
set -uo pipefail
cd "$(dirname "$0")/.."
export TMPDIR=${TMPDIR:-$HOME/agent-work/tmp}
mkdir -p "$TMPDIR"
env_file=$PWD/.env.test
[[ -f $env_file ]] || { echo "helena-gate-extra: $env_file is missing" >&2; exit 2; }

list=0
[[ ${1:-} == --list ]] && list=1
failed=()
total=0

# run <name> <timeout seconds> <dir> <command...>: the command's own summary lines go to stdout,
# its first failures too; the whole output is kept in $TMPDIR/helena-gate-extra/<name>.log.
logdir=$TMPDIR/helena-gate-extra
mkdir -p "$logdir"
run() {
  local name=$1 limit=$2 dir=$3; shift 3
  total=$((total + 1))
  if ((list)); then printf '%s\t(in %s) %s\n' "$name" "$dir" "$*"; return; fi
  local log="$logdir/${name//\//_}.log" status=0
  (cd "$dir" && timeout "$limit" "$@") >"$log" 2>&1 || status=$?
  local summary
  summary=$(grep -E '^ *[0-9]+ (pass|fail|skip)$|^ℹ (pass|fail|skipped) |^Ran [0-9]+ test|^(OK|FAILED)( |$)|^PASS |selftest: all checks passed' "$log" \
    | grep -vE '^PASS ' | tr -s ' ' | paste -sd' ')
  [[ -z $summary ]] && summary=$(grep -cE '^PASS ' "$log" | sed 's/$/ checks passed/')
  if ((status == 0)); then
    printf '%-58s ok    %s\n' "$name" "$summary"
  else
    failed+=("$name")
    printf '%-58s FAIL  exit %s  %s  (log: %s)\n' "$name" "$status" "$summary" "$log"
    grep -E '^\(fail\)|^(FAIL|ERROR): |^not ok |^FAIL |✖ ' "$log" | head -10 | sed 's/^/    /'
  fi
}

echo "== packages"
for dir in packages/*/; do
  p=$(basename "$dir")
  [[ $p == runner ]] && continue   # full-test.sh
  git ls-files "$dir" | grep -qE '\.test\.tsx?$' || continue
  run "packages/$p" 900 "$dir" bun test --env-file="$env_file"
done

echo "== repo guards and apps/bot"
run scripts 300 . bun test ./scripts/
run apps/bot 300 apps/bot bun test --env-file="$env_file"
run deployment/volition-stack/test 300 deployment/volition-stack/test bun test .

echo "== node tests of the install"
while IFS= read -r file; do
  run "$file" 300 . node --test "$file"
done < <(git ls-files 'deployment/*.test.mjs' | grep -vE '^deployment/volition-stack/(integration|browser|gateway|workspace-bridge)/|/syncthing/|^deployment/volition-stack/test/')

echo "== python tests of the install"
while IFS= read -r dir; do
  run "$dir" 900 "$dir" python3 -m unittest discover -p 'test*.py'
done < <(git ls-files | grep -E '(^|/)test_[^/]*\.py$|_test\.py$' | grep -vE '^deployment/volition-stack/workspace-bridge/' | sed 's|/[^/]*$||' | sort -u)

echo "== shell selftests"
while IFS= read -r file; do
  run "$file" 600 . bash "$file"
done < <(git ls-files | grep -E 'selftest\.sh$')

((list)) && exit 0
if ((${#failed[@]})); then
  echo "helena-gate-extra: ${#failed[@]} of $total suites FAILED: ${failed[*]}"
  exit 1
fi
echo "helena-gate-extra: all $total suites passed"
