# Combined Home terminal and MFA acceptance

Candidate base: `2fbc1589`, on the live Browser/MFA base `68430b23`.
This release adds local terminal choices only. Root owns the shared gate,
deployment and live acceptance. Qwen3.8 runtime work is a separate follow-up.

## Combined-source correction and evidence

The release includes the existing shared device-policy correction `3c80842f`,
cherry-picked as `e847a691`. The common catalogue filter applies the CPU/GPU/NPU
switches to agent/chat selection, runner snapshots, helpers and local terminals.
The same metadata drives every path; there is no second terminal-only rule.
No stored model, class or device selection changes.

The private check initially failed the existing device-policy regression:
`gpu=false` returned HTTP 200 instead of 503. With the shared correction, final combined checks pass: **68 API tests / 485
assertions, 18 native tests, API TypeScript, scoped ESLint and Prettier**.
The private PostgreSQL was stopped by the trap after the successful check. The new regression enrolls synthetic TOTP,
renews the real grant through the API, refuses earlier inference capabilities,
and admits freshly bootstrapped ones, including after revoke and reissue of the
same grant row. It does not use an owner's factor or real model server.

Private source: `~/agent-work/home-local-final-acceptance/source`; PostgreSQL:
127.0.0.1:65508. Checks run through `~/agent-work/heavy.sh --class test`, with a
stop trap; logs are in that private parent directory. The dependencies are the
existing installed dependencies, with workspace links retargeted to this source.
No download, provider inference, live DB write or service action occurred.

## Immediate Qwen3.6 acceptance for Root

1. Run the shared gate on the exact integrated commit and deploy after the normal
   no-in-flight check. Record deployed marker, source/dev HEAD, service health and
   nginx check. Existing Shell, Claude and cloud Codex tabs must reconnect.
2. Open Home → Terminal → + → Qwen 3.6. Its availability requires current loaded
   health for `Qwen3.6-35B-A3B-MTP-GGUF`, the enabled local server/master/device,
   an interactive owner and the normal terminal access grant. A missing option
   is not permission to alter a model or bypass MFA. The owner supplies any TOTP,
   initial Codex trust choice or interactive approval requested by the CLI.
3. In an ordinary owner Shell tab create the following synthetic fixture. Record
   the resulting directory and nonce only; neither is secret. Do not run commands
   displaying credentials, capabilities, environment or Codex authentication files.

```bash
proof_dir=$(mktemp -d "$HOME/helena-local-terminal-proof.XXXXXX")
python3 - "$proof_dir" <<'PY'
import json, pathlib, secrets, sys
p = pathlib.Path(sys.argv[1])
fixture = {"nonce": secrets.token_hex(12), "amounts_cents": [125, 250, -40]}
(p / 'input.json').write_text(json.dumps(fixture) + '\n')
print(p)
PY
```

4. Send the following prompt to the local Qwen3.6 tab, substituting only the
   literal fixture directory. Do not include the nonce or computed total.

> Work only in DIRECTORY. Use your built-in terminal tool to read input.json.
> Use your built-in file editing tool to create result.json containing exactly
> the same nonce and total_cents equal to the sum of amounts_cents. Use your
> terminal tool to execute a Python assertion that the resulting file has those
> exact two fields and correct values. Do not install, access a network, use MCP,
> read other directories or change any other files. Report the actual tool calls
> and exit result. If a tool fails, report the failure; do not claim success.

5. Independently verify the result from the ordinary Shell tab:

```bash
python3 - "$proof_dir" <<'PY'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1])
source = json.loads((p / 'input.json').read_text())
result = json.loads((p / 'result.json').read_text())
assert result == {'nonce': source['nonce'], 'total_cents': sum(source['amounts_cents'])}
assert sorted(x.name for x in p.iterdir()) == ['input.json', 'result.json']
print('PASS: independent read/write/terminal proof')
PY
```

Record actual Codex model/provider, built-in read/edit/command events, exit
status, wall-clock duration and independent verification. Text announcing a tool
call, a manually submitted Responses request or a mock function is insufficient.
The 120-second limit applies per inference request, not to the entire task.

6. Reconnect the tab, then close with X and reopen: local history remains separate
   from cloud Codex. After grant renewal, close/reopen the local tab so its running
   CLI receives a fresh capability. Revoking the real grant must stop inference
   within the two-second recheck interval; restore through the normal owner MFA
   flow. Root should schedule this check with the owner because it affects his
   other terminal access. Do not automate trust or MFA.
7. Record capability file owner/mode with `stat` only (0700 directory / 0600 file).
   Confirm public native bootstrap/inference routes remain refused. Failure must
   stay local and must not invoke a configured cloud account. Keep the fixture
   as evidence; any later cleanup follows the owner's deletion policy.

A live option, successful startup and completed tool task are separate evidence.
Until step 5 is observed, report “deployed, tool acceptance open”. No global
model/default, class binding, preload pin, voice runtime or owner right changes.
