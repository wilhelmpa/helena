# Point 7: rejected-login acceptance

Prepared from `4ac4367a`, including release `4dbec615`. Live acceptance: NOT RUN.
No real login is revoked, read, copied or changed by this acceptance fixture.

The existing keeper probes unexpired access tokens, persists `invalid` after 401,
removes dead credentials from agent views, and preserves a newer token when an old
request returns late. 403, 429, redirects and server/network failures remain
retryable. `runtimeLoginCondition` gives `invalid` precedence over a separate
Codex CLI login, so that case also displays **Neu anmelden**.

## Executable offline chain

The fixture reuses `KeeperLogic` and its private fake pool. It sends a fake 401
through the real keeper, asserts a dead pool row and zero refresh calls, then
emits only the public status report. `HomeLogins.test.tsx` runs that fixture,
normalizes the result with the real SDK function and renders the real German
component. The displayed row must say **ChatGPT / Neu anmelden / 1 braucht dich**;
it must not say the login is active. This is an offline proof, not a live screenshot.

```sh
python3 -m unittest discover -s deployment/volition-stack/native/token-keeper -p test_helena_token_keeper.py
cd apps/web
bun run test src/features/home/components/home/HomeLogins.test.tsx src/features/home/utils/runtimeLogins.test.ts
```

For the stronger installed-Hermes variant, Root may run the same fixture as a
private test under the installed Hermes interpreter with `PYTHONPATH` pointing
at its source and a private network namespace. Set `HOME`, `HERMES_HOME` and
`TMPDIR` to the private test area before importing anything. Keep the real auth
stores inaccessible. The fixture's `--hermes` mode fails if Hermes cannot import;
it never silently falls back to the fake pool.

```sh
# Inside that private test environment; these paths are the existing installation.
PYTHONPATH=/srv/volition/source/hermes \
  /var/lib/volition/hermes/venv/bin/python \
  deployment/volition-stack/native/token-keeper/rejection_fixture.py --hermes \
  > "$TMPDIR/rejected-login-report.json"
cd apps/web
HELENA_KEEPER_REJECTION_REPORT="$TMPDIR/rejected-login-report.json" \
  bun run test src/features/home/components/home/HomeLogins.test.tsx
```

The report contains synthetic commands for temporary fixture paths. Never execute
those commands or publish the fixture as a production status file.

## Root's installed release checks

After normal gated deployment, compare only public program files:

```sh
sudo cmp /srv/volition/source/plan/deployment/volition-stack/native/token-keeper/helena_token_keeper.py \
  /usr/local/lib/helena-token-keeper/helena_token_keeper.py
systemctl show helena-token-keeper.timer -p ActiveState -p NextElapseUSecRealtime
systemctl show helena-token-keeper.service -p Result -p ExecMainStatus
```

Wait for a normal timer report; do not trigger a provider call for this audit.
In the existing Owner session, open Home → Dienste → Anmeldungen and read the
`logins` section of `GET /god/system-health`. Record only report source/time,
staleness, provider/store/state and whether **Neu anmelden** is visible for any
actually invalid row. Do not copy login labels, commands or token expiry details
unless needed for the specific Owner diagnosis. A fresh healthy live report
proves the deployed reader/timer path, but does not prove a live rejection.
Keep that distinction in the final evidence; no fabricated invalid production row.

Isolated Linux validation: 28 keeper tests, 10 web tests and the relevant login/API
tests passed; the web typecheck and scoped lint passed. Installed-Hermes execution
and actual live timer/UI checks remain separate Root evidence.
