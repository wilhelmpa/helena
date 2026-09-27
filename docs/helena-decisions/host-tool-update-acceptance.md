# Point 7b: installed helper and recovery acceptance

Prepared from `4ac4367a`, including release `c9abec15`, plus the scoped recovery
snapshot correction. Live acceptance and actual updates: NOT RUN in this task.
Root stages actual updates separately in the approved order. The Codex owner
terminal runtime follow-up belongs to its separate implementation task.

## After gated deployment, before any Apply

Run these read-only comparisons on Kingston. They must all exit zero:

```sh
sudo cmp /srv/volition/source/plan/deployment/volition-stack/native/updates/helena-update /usr/local/libexec/helena-update
sudo cmp /srv/volition/source/plan/deployment/volition-stack/native/updates/host_tools.py /usr/local/libexec/host_tools.py
sudo cmp /srv/volition/source/plan/deployment/volition-stack/native/hermes-update/helena-hermes-update /usr/local/libexec/helena-hermes-update
stat -c '%U %G %a %n' /usr/local/libexec/helena-update /usr/local/libexec/host_tools.py /usr/local/libexec/helena-hermes-update
```

Expected: root owns all three, no group/other write permission; helper modes 755
and module mode 644. `deploy.sh` invokes the existing `--refresh` paths only when
these installed helpers' source changed. Hermes refresh copies helper code only;
it preserves its configuration/release track, packages and services. Do not run
the broad installer to compensate for a failed comparison; diagnose deployment.

The following existing inventory action performs local package simulation and
version inspection, without downloading or applying a package:

```sh
sudo /usr/local/libexec/helena-update inventory | python3 -c \
  'import json,sys; r=json.load(sys.stdin); assert r["ok"],r.get("error"); x=r["result"]; print(json.dumps({"hostToolApply":x["hostToolApply"],"tools":x["tools"]}))'
```

Require `hostToolApply` to contain exactly Bun, Node, code-server, Wetty and
KasmVNC ids (`bun`, `node`, `code-server`, `wetty`, `kasmvnc`). The normal Owner
Update Center must expose Apply for an actually newer supported installed
component. A current version has no update to apply; absence of that button
does not imply a missing helper capability. An old helper must fail closed.
Use **Hermes → lokal aktualisieren** / the existing god-only
`POST /god/update-center/hermes/refresh-local` for the offline cached-ref check.
No online check or update is required to demonstrate this helper path.

## Authorized Apply record

Before Root applies one available update, record the exact installed/target
versions, official source/digest and the helper's affected active units. Require
zero pending/running agent runs and pending/streaming chats. The helper repeats
that check before switch while holding queue-table SHARE locks. Do not bypass
the helper, force a Node major migration or start stopped services.

| Tool | Service scope | Functional smoke after helper success |
| --- | --- | --- |
| code-server | `volition-code` | Open an existing project file |
| Bun | API and worker | API health and normal UI read |
| Node | web, provisioning, terminal, browser router | UI, terminal and existing project browser |
| Wetty | terminal router | Open a project PTY |
| KasmVNC | running project displays and their running paired Chromium units | Existing project tabs, stream and CDP |

Record job id, `from`/`to`, final state, `smoke`, exact restarted units, resolved
old/new executable, `rollbackArtifact` and its file hash. Every staged install
retains `.helena-installed.json`; inspect only source/version/integrity fields.
No successful Apply claim from an inventory result, offered version or code test.

## Defined recovery artifacts

Each activation saves a unique root-only `rollback-*.json` beside the versions
in `/opt/helena/host-tools/<tool>/` **before** changing any link or drop-in. It
flushes the file and parent directory. Failed snapshot persistence prevents the
switch. The snapshot contains exact original link targets (null means absent),
old executable, affected active units, and for Kasm the old drop-in's bytes as
base64 plus mode (or null for an absent file). Paths are helper-generated.

On ordinary switch/restart/smoke failure, the helper restores those original
links and Kasm bytes/mode, restarts only the same affected units and checks them.
A failed rollback smoke is an operator error, never success. The snapshot is
retained after success and failure. The usual `previous` or `legacy.json` remains
a convenience; if writing that shortcut fails after successful activation, the
result still identifies the already durable authoritative snapshot.

For an uncatchable interruption, Root first establishes a quiet queue, verifies
the snapshot is root-owned, and compares its fixed tool paths with the installed
helper's expected paths. Restore recorded links (remove only links explicitly
absent before this activation), restore Kasm drop-in bytes/mode or prior absence,
run daemon-reload for Kasm, restart only the recorded previously active units,
and repeat service/functional smoke. Preserve both versions and the snapshot.
There is no automatic startup replay and no generic JSON-executing rollback tool.
Do not infer recovery merely because `previous` exists.

## Offline regression commands

```sh
python3 -m unittest discover -s deployment/volition-stack/native/updates -p 'test_*.py'
python3 -m unittest discover -s deployment/volition-stack/native/hermes-update -p 'test_*.py'
```

35 update tests and 14 Hermes-helper tests pass. All four new recovery cases fail
against the original `4ac4367a` helper: missing durable Kasm snapshot, absent
fail-before-switch on flush error, Kasm mode loss, and misleading failure after
a successful switch when the convenience shortcut cannot be written. The private
API Update Center suite also passes; no live package was changed for these tests.
