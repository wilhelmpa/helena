# Local Codex function-tool contract

The Qwen terminal profiles set `features.multi_agent=false`. Codex 0.157.1 otherwise
advertises a `namespace` tool named `multi_agent_v1`, which the owner-local Responses
endpoint rejects with `local_terminal_tools_invalid`. The endpoint continues to
accept only client-side `function` and `custom` tools. Its authorization, fixed model
IDs, loopback upstream, remote-media checks and capability expiry are unchanged.

The installed CLI advertises `exec_command`, `write_stdin`, `request_user_input`,
`view_image`, `get_goal`, `create_goal` and `update_goal` for these local models.
Its fallback model metadata does not advertise a separate `apply_patch` tool.
`exec_command` provides the verified local file read/write path. No model catalog,
model defaults or cloud profiles are changed.

## Verification

The opt-in `test_owner_local_codex_contract.py` runs the installed
`/usr/local/bin/codex` with the production launcher arguments for both Qwen model
IDs. Only the API address is replaced by an ephemeral synthetic loopback server.
The test uses fresh HOME/CODEX_HOME directories, a literal synthetic token and an
isolated network namespace containing only loopback. It requires no model server,
provider key, login, download or inference.

For each model the synthetic server returns an `exec_command` call. The actual CLI
reads a random marker from `input.txt`, copies it to `output.txt`, returns the marker
as a function result in its second request, consumes the final Responses event and
exits successfully. Both requests contain only supported tool types and retain the
exact model ID, `store=false` and streaming.

Run inside a private checkout and the documented heavy test slot:

```sh
unshare -Urn sh -c 'ip link set lo up && HELENA_CODEX_CONTRACT_TEST=1 python3 deployment/volition-stack/native/owner-terminal/test_owner_local_codex_contract.py'
```

Verified on Kingston with Codex 0.157.1:

- Real CLI contract: both model profiles pass, including actual file effects and the
  function-result round trip. Re-enabling multi-agent in a separate fixture causes
  both cases to fail at the forbidden tool-type assertion.
- Owner-terminal API suite: 28 tests, 224 assertions, no failures. Negative cases
  cover web search, web search preview, file search, code interpreter, MCP and the
  actual `multi_agent_v1` namespace. Rejected requests make no model-server call.
- Native launcher/router: 19 tests pass. Managed CLI/tmux fixtures: 3 tests pass.
- API TypeScript check, changed-test ESLint, Prettier and `git diff --check`: pass.
- The private PostgreSQL instance on port 65508 is stopped after testing.

Tidy and code review found no further required changes. The root orchestrator owns
independent review, the shared integration gate, deployment and actual owner-UI
acceptance. Existing running local CLI sessions need to be closed and reopened to
pick up the profile argument. Synthetic transport and file-tool verification does
not establish real model inference or completion of the owner's live fixture.
