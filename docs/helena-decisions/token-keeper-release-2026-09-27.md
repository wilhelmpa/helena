# Point 7 release and acceptance

Reassembled on 2026-09-27 from the reviewed point-7 donor only. Deployment and live acceptance remain pending.

## Release composition

Base: `de1df5d011d2284406bd023a5588dc70f7dfb9e1`.
Worktree: `plan-prepare-token-keeper-de1d`; branch: `codex/prepare-token-keeper-de1d`.
Immediate prepared donor: `de919b9cc72de5960ef55640fe8a13ccee488935` (base2601).
Earlier prepared donor: `7a2cff076eac16f8202e65b563396458c0b71797` (base55de).
Reviewed donor tip: `70a3cee4b2daf5e46b536c751c8c775121bd9bdf`.
Only the three point-7 commits below, already assembled in immediate donor7a2cff07,
and this release record were reapplied. Point6 is inherited only from the exact
de1df5d0 base, including its single blueprint-test fixture correction. No point7b
ancestry or other feature is added. The earlier2601 gate finished with the two
known blueprint fixture failures; Root prepares the corrected exact gate. Point6
deployment and live acceptance are NOT complete.
This preparation does not authorize advancing the deployment order.

| Donor commit | Reviewed queue commit | Original commit | Scope |
| --- | --- | --- | --- |
| `0273b4b04ade900200112a46888a4ba6b09103d5` | `09cdb0dc894ffd7c6eddd080791bc01ca3cd619d` | `74d32eb3754159ce4a622707cd8c03e8f0b0b652` | Keeper 401 detection and regression tests |
| `054a93e35363585ec50951b80fc9b6a7a3b6dd9f` | `3825dc92e3618beef50ec599b9693de020ec88e7` | `6916f3b4e1f218adbce43af2889cafabd1f47866` | Installed-Hermes regression tests and decision record |
| `6606cf2246f9cba7dde8d27ef7e14c76b5dea076` | `0ed030101498e364cf4463b6c5cb4749ed13440b` | `4e91f3d1de14a27447db0beddf5622c86150d00d` | Synthetic report through SDK and German Home login component |

The seven product/test/decision files match donor `70a3cee4` byte for byte; only
this release record is updated. Keeper SHA256:
`2126a3ef79feaa0833565067bd6585cbd08200cfe307b7147ff3d1ca9baea73b`.
The only production code change is `helena_token_keeper.py`. No migration,
dependency, model, skill, runtime-selection or policy changes are added. The SDK's
existing `invalid` precedence and the existing deploy-time keeper synchronization
are already in the base. This release excludes point 7b and later work.

## Evidence

Earlier independent preparation records:

- `token-keeper.md` records 48 passing Linux tests against installed Hermes, using
  fake credentials, temporary stores and a private network. These cover persisted
  rejection, token rotation races, recovery, views and provider-message suppression.
- `token-keeper-401-acceptance.md` records 28 passing Linux keeper tests, 10 web
  tests, relevant API/login tests, web typecheck and scoped lint. The cumulative
  handoff records independent R2 approval of the system acceptance changes.
- These historical checks are evidence for the unchanged files. They are not an
  exact full gate or live acceptance of this assembled candidate.

Mac checks on the byte-identical P7 donor assembled on2601:

- Full Python unit discovery:28 cases,26 passed and two Linux-only installer
  cases skipped. For the pre-existing unit-count case, only executable lookup
  (`shutil.which`) is mocked because macOS has no systemctl; its subprocess runner
  remains the existing fake. No assertions or product bytes were changed.
- Ten actual Web tests pass: `HomeLogins.test.tsx` and `runtimeLogins.test.ts`,
  including the synthetic Python keeper → real SDK normalizer → German Home
  component. The fixture uses only temporary fake stores; no live login data.
- Seven product/test/decision paths are byte-identical to earlier donor7a2cff07
  and original reviewed donor70a3cee4. The base-relative seven-file patch also
  matches the55de donor patch exactly. Only this release record differs.
- Web typecheck (no incremental cache), scoped Web ESLint, Prettier and
  `git diff --check` passed on that donor worktree. The newde1d base changes only
  `apps/api/src/scripts/project-blueprint.test.ts`; all seven P7 paths and their
  base-relative patches remain byte-identical. Fresh local reassembly checks
  validate that exact inverse, Python syntax and clean diff; no full gate repeated.
- Existing dependency-cache links were reused with workspace aliases pointing
  into this worktree. Nothing was downloaded or installed.
- Installed-Hermes tests, exact shared full gate, timer and live UI checks were
  not run. No server, live credential/auth file, refresh/revoke/login, deployment
  or push action occurred. Root acceptance below remains outstanding.

Reproducible local Web commands from `apps/web`:

```sh
bun --preserve-symlinks test --preload ./test/setup.ts --isolate src/features/home/components/home/HomeLogins.test.tsx src/features/home/utils/runtimeLogins.test.ts
NODE_OPTIONS='--preserve-symlinks --preserve-symlinks-main' node ../../node_modules/eslint/bin/eslint.js src/features/home/components/home/HomeLogins.test.tsx
```

## Ordered Root acceptance

1. Point5 is Root-live-proven; finish the point6 exact gate, deployment and live
   acceptance first. If point6 gains further commits,
   reapply this isolated point-7 scope onto its exact accepted head before gating the final candidate. Do not deploy
   the cumulative prepared queue. Run the shared exact-commit gate once and the
   documented affected-service/in-flight checks; preserve active work.
2. Deploy through the reviewed Root path, then verify source, deployed marker and
   dev head. Compare the public source keeper program to the installed program:

   ```sh
   sudo cmp /srv/volition/source/plan/deployment/volition-stack/native/token-keeper/helena_token_keeper.py /usr/local/lib/helena-token-keeper/helena_token_keeper.py
   systemctl show helena-token-keeper.timer -p ActiveState -p NextElapseUSecRealtime
   systemctl show helena-token-keeper.service -p Result -p ExecMainStatus
   ```

3. Wait for a normal timer report. Do not revoke a token, force renewal, execute
   a re-login command, or manually start the keeper for this audit. Its existing
   installed `sync` path updates public program files; the normal tick owns login
   validation. Avoid `install.sh status`, which prints the whole status report.
4. In the already authenticated owner session, inspect Home → Dienste → Anmeldungen
   and the login section of `/god/system-health` (the browser uses its configured
   backend prefix). Record only source, report time, staleness, provider/store/state
   and whether an actually invalid row says **Neu anmelden**. Do not export labels,
   re-login commands, token fields or authentication stores.
5. For the rejection chain, use the existing isolated installed-Hermes fixture
   procedure in `token-keeper-401-acceptance.md`: private HOME/HERMES_HOME/TMPDIR,
   no access to real stores, private network, `--hermes` required. Feed only its
   synthetic report to `HomeLogins.test.tsx`. Require **ChatGPT / Neu anmelden /
   1 braucht dich**, no active-login wording, and zero refresh calls. Never copy
   the synthetic report into a production status directory.
6. Record the exact release SHA, installed-program match, natural report timestamp,
   UI result and separate isolated test result. A fresh healthy live report proves
   timer/reader/UI delivery; it does not prove a real provider rejection. If there
   is no naturally invalid live row, keep that negative live branch explicitly
   unobserved. A real re-login remains an owner action.

Root updates the shared handoff and CLAUDE state and synchronizes them after the
actual step. This preparation does not mark point 7 complete or live.
