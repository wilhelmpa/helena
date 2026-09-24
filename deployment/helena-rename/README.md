# helena-rename: moving a live install to the Helena names

The live half of the one-step rename (package G). The plan, the downtime estimate and the
runbook are in [`docs/helena-oss-packaging.md` §3](../../docs/helena-oss-packaging.md).
This folder is private: after the migration it moves to `helena-ops/runbooks/`.

| File | What |
|---|---|
| `rename-map.json` | The single map: roots and inner paths, database and role, users and groups, units, env keys, headers, content tokens, the Hermes profile entries, left-over scan, rollback SQL |
| `migrate_live.py` | `plan`, `preflight`, `apply`, `verify`, `rollback`, `finalize`, `status`. Python 3 stdlib, run as root |
| `test/` | 13 tests: the rewrite rules, and end to end against a sandbox root with stub commands and a private Postgres |
| `private.gitleaks.toml` | Private-data scan rules for the public cut (§4 of the plan) |

## Use

```bash
# read-only: what would change (safe on the live system)
sudo python3 migrate_live.py plan

# the checks apply runs first
sudo python3 migrate_live.py preflight --target-ref helena/rename --rollback-ref helena/rename-rollback

# the maintenance window
sudo python3 migrate_live.py apply --target-ref helena/rename --rollback-ref helena/rename-rollback \
  --backup-dir /var/backups/helena-rename/<date>
sudo python3 migrate_live.py verify --backup-dir /var/backups/helena-rename/<date>

# back, if needed (restores every file byte for byte and deploys the rollback ref)
sudo python3 migrate_live.py rollback --rollback-ref helena/rename-rollback \
  --rollback-deploy-cmd "/srv/volition/source/plan/deployment/volition-stack/native/deploy.sh helena/rename-rollback" \
  --backup-dir /var/backups/helena-rename/<date>

# after the burn-in: remove the compatibility symlinks /srv/volition -> helena, ...
sudo python3 migrate_live.py finalize --backup-dir /var/backups/helena-rename/<date>
```

`apply` is resumable: after a failure, fix the cause and run it again. The journal
(`<backup-dir>/journal.jsonl`) skips every action that already happened. `--dry-run` prints
every action and changes nothing.

## Tests

```bash
python3 -m unittest discover -s deployment/helena-rename/test          # rule tests only
HELENA_RENAME_TEST_PG="-h 127.0.0.1 -p 55495 -U wilhelmpa" \
  python3 -m unittest discover -s deployment/helena-rename/test -v    # plus end to end
```

The end-to-end tests refuse port 5432 and create their own databases and role
(`itsaplan_rt`, `helena_rt`), which they drop again.
