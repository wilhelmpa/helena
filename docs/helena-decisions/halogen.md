# Decision: Halogen as a fixed local AI service, and what Helena needs around it

Status: implemented on `hub/halogen-integration` (Phase 1 of `docs/plan-lokal-halogen.md`, plus
the preparation of Phase 2). Nothing here is live until the orchestrator runs the steps in the
runbook (`deployment/volition-stack/native/halogen/README.md`). Date: 2026-09-28.
Supersedes the "Halogen: ausgeschlossen" line of `lokale-modelle-cloud-ersatz.md`: the owner
decided otherwise after the measurements of 28 Sept (BIOS UMA 512 MB, GTT up to 120 GiB).

## 0. Kurzfassung (für den Owner)

- **Halogen läuft fest:** Dienst `helena-halogen` (podman), Image per Digest gepinnt, Start beim
  Booten, Neustart bei Absturz, sauberes Stoppen, erst „aktiv“, wenn das Modell antwortet. Nur
  `127.0.0.1:8731` (und `:8733`, dieselbe API für Züge ohne Denken).
- **Keine ausgehenden Verbindungen:** eigenes Container-Netz ohne DNS; eine Firewall-Tabelle
  verwirft jede Verbindung, die der Container beginnt. Halogen hat keinen Schlüssel, deshalb
  dürfen nur Helenas Benutzer (API, Runner, Owner, Weiterleiter der isolierten Agenten, root)
  den Port erreichen.
- **In Helena:** eigene Server-Art „Halogen“: Zustand, Version, Plätze, Tempo (Token/s),
  KV-Cache, Speicher, GPU-Last. Fähigkeiten (Werkzeuge, Denken, Bild) liest Helena aus Halogens
  `/health`; bei jedem OpenAI-kompatiblen Server kann der Administrator sie selbst festlegen.
- **Entscheider ohne Test-Proxy:** `logit_bias` per Token-ID aus Halogens Tokenizer. Gemessen
  direkt auf :8731: Router 98 %, Mail 92 %, Belege 100 %, Allgemein 100 % (wie mit Proxy).
- **Embeddings allein weiter:** `helena-embed` (llama-server, nur Qwen3-Embedding-0.6B, ~1 GB),
  unter dem Namen, den Lemonade benutzte: die vorhandenen Vektoren bleiben gültig.
- **Deutsch-Texte:** Bewerter einstellbar (Lauf auf einem Abo-Modell, Endpunkt, aus).
  Gemessen mit Opus 5.5 als Richter: Flash **82,5 %** (Schwelle 80 %), bestanden.
- **Phase 2 vorbereitet, nicht live:** Skript stellt Hintergrundklassen und Entscheider auf
  Halogen (mit Cloud-Rückfall), sobald ihre Evals bestanden sind. Eskalationsregeln als
  Einstellung (Datenmodell, API, UI als „Entwurf“), noch ohne Wirkung.

## 1. Why a container and a hand-written unit

Halogen ships only as an OCI image (`ghcr.io/peonist-ai/halogen-flash-server`); the licence
allows use, including commercial, and the vendor states no telemetry. podman is on Debian 13.
Quadlet would be the podman-native way; the unit that already ran on Kingston was a plain
`podman run` unit and worked, so the installer renders that unit from a template
(`systemd/helena-halogen.service.in`) and changes only what was missing:

| Live unit (28 Sept) | Installer's unit | Why |
|---|---|---|
| image by digest | same, `--pull=never` | an image arrives only through the installer |
| default podman network | `--network helena-halogen` (10.89.73.0/29, no DNS, isolated) | the firewall can name it |
| one port | `8731` and `8733` → the same `8731` | turns without thinking need their own address (§5) |
| settings in the unit | `EnvironmentFile=/etc/helena/halogen.conf` | the owner tunes slots/context without the installer |
| container outside the unit's cgroup | `--cgroups=split`, `Delegate=yes` | the unit's memory is Halogen's (status shows it) |
| active when the process runs | `ExecStartPost=wait-healthy` | active only once `/health` says the engine answers |
| `stop -t 30`, `TimeoutStopSec=60` | `stop -t 60`, `TimeoutStopSec=90`, `KillMode=mixed` | the engine gets time to finish a request |
| starts without a firewall | `ExecStartPre=nft list table inet helena_halogen` | refuses to start without it |

Rejected: Docker (not installed, a second daemon), running the engine outside a container (the
vendor ships none), Quadlet for now (a second way to the same unit; can come with the Docker
packaging).

## 2. Pins

`files.tsv`: the MTP head and the tokenizer from `peonist-ai/halogen-qwen3.8-flash-next` at
revision `aea24edb…`, the GGUF checkpoint (`unsloth/Qwen3.8-Flash-Next-GGUF` UD-IQ4_XS at
`38bb39ee…`, 94 GB, in Lemonade's Hugging Face cache layout), each with its SHA-256 (computed from
the files on Kingston; the MTP head and `tokenizer.json` equal Hugging Face's LFS hashes). The
image is pinned by digest (`sha256:f3f99aa4…` = 0.14.2). `install.sh verify` reads everything in
full; `weights check` compares names and sizes cheaply; `weights pull` downloads what is missing
(only with the owner's OK).

The repack cache (`/var/lib/helena-halogen/cache`, ~71 GB) is Halogen's own conversion of the
GGUF, made at the first start and reused while the shards are unchanged: `cache status` compares
the shards recorded in its sidecar with the files; `cache clear` only while Halogen is stopped.

## 3. Tunables

`/etc/helena/halogen.conf` (copied once, never overwritten; `status` names what the owner changed):
2 slots over a 262,144-position KV pool and `HALOGEN_MAX_TOK=16384`, as ran live. The vendor's
default thinking is `xhigh`; Helena's own calls say how much they think, agent turns through
Hermes only switch thinking on or off. `HALOGEN_REASONING_EFFORT=medium` is the default for
requests that do not specify an effort. An existing `/etc/helena/halogen.conf` is not overwritten.

## 4. Firewall

`helena-halogen.nft` (table `inet helena_halogen`, loaded from `/etc/nftables.d/`):

- forward and input: `ip saddr 10.89.73.0/29 ct state new drop` — the container may answer, never
  start a connection (internet, LAN or this machine);
- output at priority −150 (before netavark's DNAT turns `127.0.0.1:8731` into the container's
  address): only the uids of root, the forwarder `helena-halogen-fwd`, the API user, the runner
  user and the owner reach ports 8731/8733; anyone else gets a TCP reset. Halogen has no key.

The test proxy `helena-halogen-biasproxy2` (a DynamicUser) is not in that list: it is blocked, on
purpose (§6 makes it unnecessary).

## 5. Helena: server type, capabilities, status

- Server type `halogen` (`apps/api/src/modules/local-ai/server-types.ts`): models from `/v1/models`
  (unit GPU, context from Halogen), capabilities from `/health` (`tool_calls` → tools,
  `chat_template.thinking_control` → reasoning, `vision.enabled` → vision), status from `/health`
  (version, slots, in flight, queued) and `/metrics` (average answer and prompt speed since start,
  KV cache in use), memory from the unit's cgroup (null below 1 GB: a unit without
  `--cgroups=split`), GPU busy from amdgpu. `defaultKeySource: 'none'`.
- `noThinkingBaseUrl`: `:8731` → `:8733`. Hermes finds a provider's `extra_body` by its address
  (local-ai-platform.md §6.7), so the provider for turns without thinking needs a second address;
  Lemonade has `/api/v1` and `/v1`, Halogen gets a second published port.
- Configurable capabilities (`ModelServerType.capabilitiesConfigurable`, stored in
  `helena_model_server.options`, migration 0209): for `openai-compatible` and `halogen`, the
  Administrator sets tools/reasoning/vision for the server's chat models; null = derived.
  `withConfiguredCapabilities()` applies them at every check, also to the models kept while the
  server is down.
- The server dialog can now edit a server (name, address, key, context, capabilities).
- Isolated agents: `launcher.json` forwards `halogen` (8731) and `halogenquiet` (8733) through
  `helena-halogen-proxy@<port>.socket` (optional sockets: a machine without Halogen starts its
  agents as before). The proxy unit permits the Podman subnet as well as localhost because
  Podman DNAT sends loopback connections into that subnet. `isolation.sh sync` after the install.

## 6. Decisions: `logit_bias` by token id

Halogen, like OpenAI's API, takes `logit_bias` keys as token ids only; llama.cpp and Lemonade
take text. `@helena/decisions` gets `OpenAiCompatibleServer.tokenIds` (looked up once per server
object; a failed lookup is not kept; a letter that is not one token refuses the question rather
than biasing the wrong token). The `halogen` type implements `tokenIds` from the tokenizer's
`vocab.json` (default `/var/lib/helena-halogen/models/tokenizer/vocab.json`, overridable per server;
only `.json` below `/var/lib`), the decisions' local-AI resolver passes it through. Measured directly
on :8731, one request at a time: router 98 % (prec 100 %, cov 89 %), mail 92 %, receipts 100 %,
general 100 % — the same as through the test proxy.

## 7. The judge

Deutsch-Texte needs a second model. `GET/PUT /god/local-ai/judge` (setting `localAi.judge`):
`run` (default: `gpt-6-sol`, medium) queues a text-only run like the update summaries (trigger
`digest`, work class `judge` with its own system prompt, never a local model) and waits for its
answer; `endpoint` uses an OpenAI-compatible endpoint with a key stored in Helena; `off`. The
command-line eval can use the owner's own Claude Code or Codex CLI (`--judge-cli claude
--judge-model opus`). Measured with Opus 5.5: Flash **82.5 / 100** (threshold 80): nine texts
74–92, one 38 (`support-4`: invented menu items for the 2FA recovery).

## 8. Phase 2, prepared

- `apps/api/src/scripts/local-ai-phase2.ts`: the classes of step 1 (triage, routines, summaries,
  reflection, decisions, coordinator-triage, hermes-helpers, voice-reply) with their eval on the
  Halogen model; `--evaluate` runs the missing ones one after the other, `--apply` puts the passed
  ones in `prefer` on that model (cloud fallback), `--enable` turns the master switch on. Tried on a
  private database against the real Halogen: decisions 100 % → `prefer`. Mail triage and task
  assignment use `triage` through the decisions service when their connection uses local AI;
  each decision class can use its configured cloud fallback.
- Escalation rules (`apps/api/src/modules/escalation`, setting `helena.escalation`, `GET/PUT
  /god/escalation`, UI section marked „Entwurf“): kinds of work to a strong model (coding →
  gpt-6-sol; architecture, security, legal, external texts → Opus), unsure decisions below a
  threshold, failures (tests red, loop, timeout) after N local tries, fixed choices per agent,
  project or task (narrowest wins). `escalate()` is pure and tested; nothing calls it yet. What
  Phase 2 still has to build: classify a task's kind (the model router's questions), hand the
  history over on a failure, and the weekly numbers (success, escalation rate, subscription use).

## 9. Practice test "Flash als Home"

`apps/api/src/scripts/flash-home/`: a small tool loop (chat completions + MCP tools, the shape of
Phase 3's own runtime) drives Flash as the Home agent through Helena's MCP, in-process against a
private test database. The owner's written spec asks for a project, two agents, two goals, three delegated
tasks, a routine, a look at the runs, one routine fire and a status report; 13 checks, tool errors,
repeats, time, tokens; the test project and agents are removed through the API afterwards. Of
Helena's 213 MCP tools (~680 KB of schemas) it offers 27. Results: runbook and report.
Owner and Home can preview or apply bundled project blueprints through MCP tools; apply is a
workspace write.

## 10. Open

- The owner's local terminals (`owner-terminal/local-model.ts`) know only Lemonade's models.
- `helena-lan6`/hardening unaffected; the hardening audit does not check the Halogen table yet.
- Quadlet and the Docker packaging (Phase 7).
