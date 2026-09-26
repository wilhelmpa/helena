# Local tool agents in the Home terminal

The Home terminal adds Qwen 3.6 and Qwen 3.8 through the installed Codex CLI's
Responses custom provider. Each local tab runs as the existing owner Unix user,
with Codex's normal built-in terminal/file tools and a separate local conversation
history. Claude, cloud Codex, project terminals, agent defaults and human ticket
assignments retain their current behavior. No packages, models or runtimes are installed.

## Access and lifecycle

The existing interactive-owner check and terminal grant are authoritative. The
native router exchanges its 60-second signed proof for an inference-only token
bound to the original browser session, exact local kind and original grant ID,
creation time and expiration time. Renewal of the same grant row invalidates its
earlier capabilities. The
API rechecks the active owner, session, grant or signed LAN access and current LAN
policy on every inference and every two seconds during streaming. Revoked grants
cannot be revived by issuing another grant. A new token never extends the original
12-hour limit. Personal API keys, agent keys, cookies and browser-origin requests
do not authenticate this native route. Forwarding headers from the public reverse
proxy are refused as well, and nginx blocks the public bootstrap/inference paths; the native client calls the loopback API directly.

Only the API and owner-terminal systemd units can read the existing terminal HMAC
key (the `helena-terminal-key` hardening group). The runtime capability is stored
under the owner's `/run/volition-owner-terminal/local-models`, directory 0700 and
file 0600, with no-follow file reads. The launcher passes it only through the local
Codex child's environment. No model key reaches the launcher, browser, command
arguments or logs. Local capabilities authorize inference only; they cannot use
normal Helena API/MCP routes. Closing the terminal removes its runtime file and
kills its tmux program; any copied capability still expires at the original grant
limit and can be invalidated immediately by revoking that grant/session.

The local CLI reads its own `CODEX_HOME` under
`~/.local/state/helena-owner-terminal/<kind>-<name>/codex`. It does not inherit the
cloud Codex login, saved trust choices, configured MCP servers or custom skills.
Built-in tools are the initial scope. Normal first-use trust/approval prompts must
be handled in the terminal; no automatic trust or wider sandbox flag is set.
Reopening after expiration starts from the saved local history; use the tab's X
and reopen it when the old running CLI still holds an expired capability.

## Runtime and request limits

The existing local-AI master/device/model policy applies. Only the configured
`local` Lemonade server at `127.0.0.1:13305` and the two literal model IDs are usable.
Options query protected runtime health, rather than depending on an administrator
refreshing cached status. A downloaded file or an unrelated private benchmark
server is insufficient: the exact model must be loaded in production Lemonade.
Each inference checks health again; no explicit download or load endpoint is called.
Lemonade may auto-load on Responses if another operator unloads a model after this
check, so acceptance must exclude concurrent loads/unloads; this preflight is not
an atomic loaded-only guarantee.
No cloud fallback or automatic retry occurs. Hosted web/MCP tools, remote media,
background jobs and previous-response reuse are refused; Codex executes its own
function/custom tools under the existing owner Unix account.

Uploads are bounded to 2 MiB and five seconds. Inference/streaming is bounded to
120 seconds and 16 MiB. Cancellation and grant/policy revocation stop the stream.
Provider failure bodies are discarded. Only fixed local error codes are returned.

## Native deployment

The owner-terminal unit starts the router from the live checkout and names the
shell in that same directory. Both new `.mjs` helpers are read from there after
the root fast-forward; no install-time copy or generated bundle is needed.
`deploy.sh` invokes the existing setup for any owner-terminal path change and
queues a restart of `volition-owner-terminal.service`. The separate
`helena-owner-tmux.service` is neither restarted nor reconfigured. Running cloud
and local CLI processes persist; the router reconnects their browser views.

## Evidence and Root acceptance

Installed Codex 0.156.1 exposes the custom-provider flags. Pinned Lemonade
v2026.39.1 (`6ce82052b69c5ffd9157ed102b739d180cdc24a5`) explicitly launches Codex with
`wire_api='responses'` in `src/cpp/cli/agent_launcher.cpp`; its llama.cpp backend
forwards both normal and streaming `/v1/responses` with tool schemas. This is source
compatibility evidence, not a successful live tool-agent result.

Primary sources:
- [Codex provider configuration](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Lemonade Codex launcher](https://github.com/lemonade-sdk/lemonade/blob/6ce82052b69c5ffd9157ed102b739d180cdc24a5/src/cpp/cli/agent_launcher.cpp)
- [Lemonade Responses forwarding](https://github.com/lemonade-sdk/lemonade/blob/6ce82052b69c5ffd9157ed102b739d180cdc24a5/src/cpp/server/backends/llamacpp/llamacpp_server.cpp)

Root performs acceptance after the shared gate and deployment, serially with GPU
benchmarks and loads. No agent working on this patch performs live inference.

1. Verify current owner-terminal service UID and existing narrow signing-key group;
   no permission change is required. Check nginx config, then existing Shell,
   Claude and cloud Codex tabs reconnect with their original histories.
2. With Qwen 3.6 loaded and local policy enabled, Home → Terminal → + offers
   Qwen 3.6. Confirm the displayed Codex model/provider and any first-use trust
   prompt. Read a synthetic fixture, execute a harmless local command and edit
   that fixture through Codex tools; verify the file outside the model response.
   Do not use mail, credentials or real project documents as test data.
3. Reconnect the tab and reopen after X; verify its own conversation resumes and
   cloud Codex history is unchanged. Check capability mode/owner using `stat` only,
   never print its contents or process environment.
4. Revoke the actual grant (or enable step-up for a LAN-only lease). Inference must
   stop, while the UI retains saved conversations. Restore access through the
   existing normal owner flow, close/reopen the local tab and retest.
5. Qwen 3.8 stays unavailable until its production Lemonade runtime and Responses
   tool execution have been separately proven. A private ROCm load, benchmark or
   file verification does not complete this acceptance. Check first loaded health,
   then repeat the same synthetic read/command/edit proof before reporting it ready.
6. Stop model service or disable its local policy: new requests fail with a fixed
   message and no fallback to a paid model. Restore the previous runtime/policy.

Private validation on the isolated `f7567831` feature tree: 23 API tests, 155
assertions, zero failures; 18 native router/launcher tests; API and web typechecks,
scoped ESLint, Prettier and shell syntax checks passed. The fake model provider
checks the synthetic stored key only in its Authorization header; no real inference
or provider call was made. Tests cover cross-kind/forged/expired capabilities,
owner/session/LAN changes, original-grant replacement and renewal of the same row,
model policy, runtime readiness, body size/timeout/cancellation and stream revocation.

The separate MFA renewal fix `f0268089` is not an ancestor of this feature tree.
The same-row renewal regression modifies the original grant creation/expiry values
and proves its earlier capability fails before model access. Root's combined release
must retain the MFA upsert and these grant-version checks together. If cherry-picking
conflicts at `owner-terminal/service.ts`, preserve both `session` and `twoFactor`
imports, the MFA verification/upsert and the local-terminal authorization functions.
Live acceptance remains Root's responsibility.
