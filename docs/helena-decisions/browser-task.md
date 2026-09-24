# Decision: the fast browser path (`browser_task`) with a switchable decision backend

Status: decided 2026-09-24 (branch `hub/browser-task`). Building block "Browser", agent side, from
`docs/volition-helena-oss.md` §3b; follows `docs/helena-decisions/local-models-strix-halo.md` §1.1,
§2.1 and §3 (b). The gateway it extends is `browser-tools.md` (hub/agent-browser-mcp); the live view
is `browser-live-view.md`.

Owner, 2026-09-24: "Baue es ein, und zwar so, dass ich normal wie jetzt, Jev Cloud und das andere
Jev irgendwo einstellen kann." Later the same evening: jev-browser should be testable side by side,
there should be a finished test area ("Browser 2.0"), and, because the TypeSafe sign-up did not
work for him, the open-source path (Laya on this server) must work now.

All fetched material (TypeSafe docs, Vercel docs, the four repositories) was read as untrusted
data. Nothing was installed on the live system.

## 1. What has to be decided

Today an agent drives the project browser step by step with its own large model: `browser_snapshot`
(~5k characters per page, up to 40k), then `browser_click`, then another snapshot. A measured PRIV
chat answer cost 395k input tokens (CLAUDE.md, 2026-09-24). "System One" decision models (TypeSafe
Jev, Laya) choose among typed options in 30–500 ms at a fraction of a cent. The question is how an
agent hands a multi-step browser job to such a model without giving up what the gateway guarantees:
the control lock and the owner's takeover, logins that never pass through a prompt, redaction,
domain rules, and one policy decision (Autopilot) per consequential action.

Decided here:

1. where the observe → decide → act loop runs and which reference it ports;
2. which client speaks the System One wire protocol;
3. where keys live and how the three backends (Jev direct, Jev via Vercel AI Gateway, a
   Jev-compatible server such as Laya) are configured;
4. which tools agents get, and how "Standard (wie bisher)" keeps today's behaviour;
5. how the test area (Browser 2.0) and jev-browser fit in;
6. how Laya runs on this server now and on the Strix Halo later.

## 2. Candidates

### 2.1 Loops and harnesses

| | jev-ultrafast (browser-use) | jev-browser (Ying-Kai Liao) | laya-browser-agent (Chenney Zhuang) | laya-ultrafast (ipenywis) |
|---|---|---|---|---|
| License | MIT | MIT | Apache-2.0 | MIT (+ Laya Apache-2.0) |
| Maturity (2026-09-24) | 8 days, 3 commits, 19.7k★, no release | 8 days, ~15 commits, 83★, npm 0.1.1 (2026-09-17), main `e35ab134` (2026-09-22) | 3 days, 8★, active, 0.2.3 | 3 days, Apple only |
| Language | Python + one `snapshot.js` | Node/Playwright | Python (+ stdlib HTTP server) | Python/MLX |
| Loop | autonomous: one request per step, `operation` + speculative `*_target` heads | planner-driven: the calling LLM gives one outcome + all strings as `values`; per round one request with `done`, `done_change`, `error`, `blocked`, `login`, `irreversible`, `tool`, `target`, `value` | observe → table → questions → validate → act; goal-aware scope ≤25 elements, coarse-to-fine choices ≤20 options, confidence gate 0.15, toggle guard | narrow questions + fixed rules |
| Text to type | a second LLM (OpenRouter mercury-2.5) writes it | only from caller `values`; never generated | none | an LLM plans once |
| Page model | viewport-only element table, code-owned node ids in `window.__jevFast` (page world), freshness markers, hit-test before input | whole page incl. frames + shadow DOM, labels, `near` text, `covered`, dialogs/overlays, diffs, counts; writes `data-jev-i` into the DOM | element table from a driver | – |
| Results | Google Flights 7.1 s (3 runs, "not a reliability benchmark") | 40/42 live tasks, 0 false "done", ~300 ms/call, 2–4 calls/step, 5× less page content to the LLM | 4/5 live sites; vs hosted Jev: 4/12 vs 8/12 strict element hits | 5/5 Flights on M1 |
| Browser | its own CDP tab via Browser Harness | launches its own Playwright Chromium (or a passed-in one) | Playwright or CDP | – |
| Fit for Helena | the loop shape and the freshness/occlusion guards | the contract (values, honest statuses, irreversible pause, check/choose), the page model and the lessons in NOTES.md | the only working **local** recipe: browser-tuned checkpoint, v3 layout, chunking, scope | idea only |

None of them can be used as-is inside the gateway: each opens its own browser connection (the
gateway design forbids a second CDP client competing with the lock and the live view), runs in the
page's main world or writes into the DOM (visible to the page, design §7), and reads the values of
password fields into what it sends to the model (jev-browser lists `input[type=password]` with its
value; jev-ultrafast only skips it by type). So: **port** the loop into the gateway (TypeScript,
attribution in `packages/browser-gateway/NOTICE`), keep our session, lock, redaction and policy.

### 2.2 The System One client

| | `@typesafe-ai/sdk` 0.6.0 | AI SDK `experimental_evaluate` + `@ai-sdk/typesafe-ai` | plain `fetch` |
|---|---|---|---|
| License / deps | MIT, 0 deps, 209 KB | Apache-2.0, `ai` is already Helena's AI standard | – |
| Wire | exactly `/v1/systemone` (`noul`/`choice`/`score`), answers passed through | own neutral shape (`boolean` for `noul`), strict validation (distributions must sum to 1 within declared rounding) | exact |
| Base URL, fetch injection, retries | yes (`baseURL`, `fetch`, 429/529 with `retry-after`) | yes | own |
| Status | 12 days old, official | **experimental** ("may change in patch releases") | – |

Decision: **`@typesafe-ai/sdk`, pinned to 0.6.0, in the API only.** It speaks the wire the gateway
builds and that jev-browser sends through the proxy (§3.4) without translation, and one `baseURL`
covers all three backends (TypeSafe `https://api.typesafe.ai`, Vercel
`https://ai-gateway.vercel.sh/typesafe`, a Laya server `http://127.0.0.1:8791`). Its `fetch` option
takes Helena's SSRF-guarded `pinnedFetch`. The AI SDK evaluation API is the right home later for
LLM-as-evaluator backends (a local Lemonade model, OpenAI): the backend interface in §3.3 is shaped so
an AI SDK evaluation model can be added as another backend kind once the API is stable. Rejected
now: it is experimental, renames `noul`, and would reject Laya answers whose probabilities are
rounded differently.

### 2.3 Local decision servers

| | `laya-serve` (Laya 0.3.20) | `localdecide serve` (laya-browser-agent 0.2.3) | own server |
|---|---|---|---|
| Checkpoints | only `english`, `multilingual`, `typed-decisions` — base checkpoints pick a page element at chance level (top-1 0.10) | the browser-tuned `cklxx/laya-browser` (v10s, 322M) through `laya.load` | – |
| `/v1/systemone`, `/v1/models`, health | yes, no `/v1/models` | yes, all three | – |
| Auth, limits | `LAYA_API_KEY` Bearer, body caps, one inference worker | **none**, `Access-Control-Allow-Origin: *`, unbounded threads | – |
| Wide choices | – | coarse-to-fine chunking (≤20 options per question) | – |

Decision: a **thin wrapper** (`deployment/volition-stack/native/laya/helena_laya_serve.py`, ~150
lines) that reuses laya-browser-agent's `Decider` (chunking, answer validation) over `laya.load` of
the pinned browser checkpoint, and adds what `localdecide serve` lacks: a constant-time Bearer check,
no CORS header (the project browsers run on the same machine; a page must not be able to call it),
body and question caps, one inference thread, 127.0.0.1 only. The stock `laya-serve` is rejected
because it cannot load the browser checkpoint. Installer and unit: §3.8.

## 3. Decisions

### 3.1 The loop runs in the gateway, in two policies

`packages/browser-gateway/src/task/` holds the port:

- **Page model** (`page-script.ts`): one fixed function evaluated in patchright's **isolated world**
  per frame (verified 2026-09-24: its globals persist between calls, the page cannot see them, a
  navigation clears them; nothing is written into the DOM). It merges jev-browser's element listing
  (frames, open shadow roots, `cursor:pointer` controls, labels from `<label>`/`aria-*`/adjacent
  text, `near` text, `covered`, dialogs and unmarked overlays, sort markers, counts of repeated
  elements) with jev-ultrafast's code-owned identities and freshness keys. Viewport text is capped
  at 2,500 characters. Password and one-time-code fields are listed as such, **their values are
  never read**, and no operation other than a click targets them (logins stay `browser_login`).
- **Policy "Jev"** (`policy-jev.ts`, the default for TypeSafe and Vercel): one request per round
  with jev-ultrafast's `operation` (CLICK, TYPE_TEXT, SELECT, PRESS_ENTER, SCROLL_DOWN, SCROLL_UP,
  WAIT, DONE, BLOCKED) and speculative target heads, plus jev-browser's `done`, `done_change`,
  `error`, `login`, `irreversible` nouls, the `value` choice over the caller's values, the stricter
  confirmation question when `done` is 0.5–0.85 but an action is proposed, `last_change` (page diff),
  and a two-stage group → element selection above 240 elements. Text is never generated: TYPE_TEXT
  types one of the `values` the calling agent passed; without values it is a click (jev-browser rule
  9) or, if the field needs text, the task comes back as `needs_agent`.
- **Policy "Laya"** (`policy-laya.ts`, the default for a Jev-compatible server): the recipe that
  works for the browser-tuned Laya checkpoint (laya-browser-agent, cklxx/laya-browser): goal-aware
  scope of at most 25 elements (lexical overlap with the goal and values; an element whose label
  overlaps the goal is never dropped; other-script distractors removed for non-Latin goals), page
  text ≤1,200 characters, elements as the option descriptions, one `operation` question and the
  target heads, a `done` noul, confidence gate 0.15, toggle guard (a click on a control already in
  the requested state is refused).
- **Guards** (both policies): freshness (the page key and the target's guard are compared right
  before input; a stale decision is thrown away and the page observed again), occlusion (the element
  must be what `elementFromPoint` hits at its centre), loop detection (same action on an unchanged
  page 3×, a repeated 2–3 action block 3×, one action 8×), a step budget (default 20, at most 60) and
  a decision budget (2 × steps).
- **Every action is decided by Helena's policy exactly like the single-step tool** it stands for: a
  click `write`, a click that submits a form or Enter in a form field `send`, typing `write`,
  scrolling and waiting `read`. "Freigabe nötig" stops the task with status `needs_approval` and the
  card number; a denial stops it with `denied`. In mode `read` only non-submitting clicks, scrolling
  and waiting are offered. jev-browser's `irreversible` noul (≥ 0.6 on a click or Enter) pauses the
  task with `needs_confirmation` unless the agent passed `allowIrreversible: true` — on top of, never
  instead of, the policy.
- **Lock and takeover**: the task acts as the calling agent and holds its lock for the whole run; the
  moment the owner presses "Übernehmen" (or the lock goes to anyone else) the task stops before its
  next action with status `owner_took_over`. A dialog the page opens stops it with `needs_agent`
  (browser_handle_dialog); a sign-in wall with `needs_login` (browser_login, browser_handover); a
  CAPTCHA or access-denied page with `blocked`.
- **Result**: status, a one-line summary, final URL and title, the steps (operation, element label,
  value key, probability, confidence, milliseconds, category), backend and model, tokens, duration;
  for every status other than `done` also the top candidates, a short page-text excerpt and the
  current `browser_snapshot` (refs, capped at 12,000 characters) so the agent continues with the
  step tools without another call. Everything that leaves the gateway passes the session's
  `SecretGuard`, and the state sent to the backend is redacted the same way before it leaves.

### 3.2 Tools

- `browser_task {goal, values?, startUrl?, maxSteps≤60, mode: read|act, allowIrreversible?}` — the
  loop above. Category `write` for the pre-call guard (the Hermes approval guard classifies before the
  call reaches the gateway); the gateway decides each inner action on its own.
- `browser_check {question}` → probability that the answer is yes (jev-browser's `check`), `read`.
- `browser_choose {question, options}` → the chosen option and the distribution, `read`.

jev-browser's other tools are already covered by the Playwright-MCP-standard step tools
(`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_take_screenshot`); a separate
`browser_do` would duplicate `browser_task` (same contract), so it is not added. The descriptions and
the MCP server instructions say when to use which: `browser_task` for multi-step navigation and form
flows with known values, one observable outcome per call works best; the step tools for anything the
task hands back, for logins, uploads, downloads and dialogs.

**"Standard (wie bisher)"** is today's behaviour: the three tools are not listed at all. The shim
asks the gateway for the tool list of its agent (new `{"list": true}` request on the same socket);
the gateway answers from the project's setting, and an older gateway or no answer means the step tools
only. The gateway refuses the three tools for a project in Standard mode anyway.

The runtime SOUL of an agent with the gateway gets a "## Browser: browser_task" section when one of
its projects has a decision backend (runtime-policy/service.ts).

### 3.3 Backends and where keys live

A backend is a **connection in Zugänge**, credential kind `decision_model` ("Entscheidungsmodell
(Jev)"), stored like every other credential (encrypted, team or project scope, audit):

| Field | TypeSafe (Jev Cloud) | Vercel AI Gateway (Jev) | Jev-kompatibler Server |
|---|---|---|---|
| `provider` | `typesafe` | `vercel` | `compatible` |
| `baseUrl` | `https://api.typesafe.ai` | `https://ai-gateway.vercel.sh/typesafe` | e.g. `http://127.0.0.1:8791` (Laya on this server) or `http://strix.local:8791` |
| `model` | `jev-latest` | `typesafe-ai/jev` | `laya-browser-v10s` (informational for Laya) |
| key (secret) | from console.typesafe.ai/keys | an AI Gateway API key | optional; preset "Laya (lokal)" reads the installer's key file instead |
| `allowPrivateAddress` | – | – | the owner's explicit allowance for this one host (LAN/loopback) |

"Verbindung testen" calls `GET {base}/v1/models` (TypeSafe, Vercel, laya-browser-agent) and falls
back to a one-question `noul` probe; the result is shown in German and stored as the credential's
status. Keys never leave the API: the gateway sends its questions to
`/internal/browser-gateway/systemone` and the API makes the call with the key, through
`@repo/net`'s `pinnedFetch` (https only, private addresses refused). The owner's allowance extends
the guard for that one host only (new per-call `allowHosts` in `@repo/net`, still pinned against DNS
rebinding); `SSRF_ALLOWED_HOSTS` stays untouched.

The **setting** "Browser-Steuerung" lives in Projekt → Einstellungen → Browser: "Wie in den
Voreinstellungen", "Standard (wie bisher)" or "Entscheidungsmodell" with the connection, the policy
(Automatisch / Jev / Laya) and the confidence threshold. The **instance default** lives in
Administrator → Agenten-Laufzeit next to the other runtime defaults (a connection of a team applies
to that team's projects; elsewhere the default falls back to Standard).

### 3.4 Usage, cost, provenance

- Each task is a row in the new table `browser_task_run` (agent, project, source `agent` or `lab`,
  goal, mode, backend snapshot without secrets, status, steps, tokens, cost, duration, run or chat
  message). The live view's activity keeps its per-action `browser_gateway_event` rows (tool
  `browser_task`, the element and value key, never a value).
- Tokens go into the ledger `agent_usage` with the new kind `tool` (runtime `browser-gateway`,
  `gen_ai.provider.name` `typesafe` / `vercel` / `local`, `gen_ai.response.model` as the backend
  answered, e.g. `jev-1.13.0`), under the agent's run or chat answer. Cost is priced when read, like
  every other row; Jev's price ($0.042 per million input tokens, output free) is added to the shipped
  price snapshot under provider `typesafe`, a local model costs nothing. Vercel's own
  `provider_metadata.gateway.cost` is kept on the task row when present.
- Provenance like `model_check`: the task row stores the configured model and the one the backend
  reports; a mismatch is shown in Browser 2.0.

### 3.5 Browser 2.0 (the test area)

Home → Browser → "Browser 2.0" and Projekt → Browser 2.0: a task form (goal, values, start address,
mode, steps, "Ausführen als" agent, backend), the project's live view next to it (the existing
`WorkspaceBrowserLive`, so "Übernehmen" works as everywhere), the steps as they happen, the result
with time, tokens and cost, "Nochmal mit anderem Backend", and a comparison table of past runs. Runs
are `browser_task_run` rows (source `lab`), so the comparison persists.

- **Decision backends** run through the gateway exactly like an agent's `browser_task`, as the chosen
  agent (its Autopilot level, its approvals, its lock name in the live view). The API starts them on
  the router over loopback with the gateway's service token.
- **Standard (wie bisher)** sends the goal as a chat message to the chosen agent, which then works
  with the step tools as always; the run shows the answer, the browser actions it took, its time and
  its tokens and cost from `agent_usage`.
- **jev-browser** (owner OK 2026-09-24; npm/GitHub, MIT, pinned to `e35ab134`) runs unchanged as a
  comparison, but **never on a project browser**: it launches its own Chromium, reads password
  values, writes `data-jev-i` into pages and evaluates in the main world. The router starts it in a
  child process against a throwaway headless Chromium with an empty temporary profile (Chromium's
  own sandbox on, local and private addresses blocked, the project's domain rules applied); its
  TypeSafe calls go to Helena's proxy with a one-time run token instead of a key
  (`JEV_API_URL`/`TYPESAFE_API_KEY`), so it works against every backend including Laya and its
  tokens are counted. The owner sees a picture per step instead of the live view.

### 3.6 Security notes

- Page content goes to the chosen backend. For TypeSafe and Vercel that is a cloud service with
  unknown retention (local-models doc §1.1); the Zugänge form says so. Laya keeps it on the machine.
- The state sent to a backend never contains a password or code field's value, and passes the
  session's `SecretGuard`.
- The proxy's run token is random (32 bytes), stored hashed, bound to one run and expires with it.
- The Laya service answers only on 127.0.0.1 with a key; a project browser page cannot reach it
  without the key and gets no CORS header.

### 3.7 What the numbers say, and what they do not

See §5; the eval harness (`packages/browser-gateway/eval/`) re-runs them. The Standard path cannot
be measured without an LLM key and is measured through Browser 2.0 after deploy.

### 3.8 Laya on this server, later on the Strix Halo

Kingston itself is the Strix Halo box (AMD Ryzen AI MAX+ 395, 32 threads). The installer
`deployment/volition-stack/native/laya/install.sh` (run by the orchestrator, owner OK 2026-09-24):

- system user `helena-laya`, venv `/opt/helena/laya` (uv, Python 3.13), PyTorch **CPU** wheel,
  `laya==0.3.20`, `laya-browser-agent==0.2.3` — all pinned;
- checkpoint `cklxx/laya-browser` subfolder `v10s` at a pinned revision, downloaded once with
  `huggingface_hub.snapshot_download` into `/var/lib/helena-laya/models`, then `HF_HUB_OFFLINE=1`;
  safetensors only, no `trust_remote_code`;
- key `/etc/helena/laya.key` (root:volition-plan 0640), read by the API only (`HELENA_LAYA_KEY_FILE`
  in the API unit's drop-in);
- `helena-laya.service`: `127.0.0.1:8791`, `LAYA_THREADS`, `MemoryMax=4G`, `CPUQuota=800%`,
  `Nice=10`, `ProtectSystem=strict`, `PrivateTmp`, no network after the download
  (`IPAddressDeny=any` + `IPAddressAllow=localhost`);
- `install.sh status|uninstall`; the Zugänge preset "Laya (lokal auf diesem Server)".

Moving to the Strix Halo (or any other machine) is a new `compatible` connection with that machine's
address, "Lokale Adresse erlauben" on, and the key of that installation.

## 4. Rejected

- **Running jev-ultrafast or jev-browser as the agent's tool on the project browser**: a second CDP
  client beside the gateway, main-world evaluation and DOM attributes (visible to pages), password
  values in the state, no lock, approvals or domain rules.
- **A text LLM for TYPE_TEXT** (jev-ultrafast): a third model, a key, and a place where personal data
  could be invented. The calling agent already knows the values; it passes them.
- **Keys in the router process**: the gateway would hold every project's backend key in the process
  that also holds every project browser. The API proxy costs ~2 ms per decision on loopback.
- **`laya-serve`** (base checkpoints only) and **`localdecide serve` as is** (no auth, CORS `*`).
- **A new credential store for backends**: Zugänge already has encryption, scopes, audit and status.

## 5. Measurements

Filled in by the eval harness run on Kingston, see the report of hub/browser-task (and
`packages/browser-gateway/eval/RESULTS.md`).

## 6. Sources

- https://docs.typesafe.ai/llms.txt, /api.md, /models.md, /confidence.md, /sdk/javascript.md,
  /model-jaggedness/jev-1.13.md; npm `@typesafe-ai/sdk` 0.6.0 and its `src/client.ts`
- https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe (base URL, `typesafe-ai/jev`,
  `GET /typesafe/v1/models`, `provider_metadata.gateway.cost`)
- https://ai-sdk.dev/docs/ai-sdk-core/evaluation, https://ai-sdk.dev/providers/ai-sdk-providers/typesafe-ai
- https://github.com/browser-use/jev-ultrafast (README, docs/design.md, jev_ultrafast/{agent,browser,model,questions}.py, snapshot.js)
- https://github.com/Ying-Kai-Liao/jev-browser (README, NOTES.md, RESULTS.md, src/*.mjs, bench/tasks.mjs), npm `jev-browser` 0.1.1
- https://github.com/ChenneyZhuang/laya-browser-agent (README, localdecide/{serve,decider,backends/base,cli}.py, pyproject.toml)
- https://github.com/NandhaKishorM/laya (laya/serve.py, laya/router.py, pyproject.toml 0.3.20)
- `docs/helena-decisions/local-models-strix-halo.md` (Laya, laya-browser checkpoints, latencies)
