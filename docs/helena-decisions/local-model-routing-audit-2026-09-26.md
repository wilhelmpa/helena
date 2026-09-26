# Additive local models: catalogue and routing audit

Source baseline: `c731203f`, 2026-09-26. This audit changes no model, default,
class binding, device switch, preload pin or live service. Live metadata and the
independent model/benchmark research are recorded separately from source facts.

## Existing registration path

1. `deployment/volition-stack/native/local-ai/models.tsv` pins each artifact by
   repository commit, exact filename, bytes and SHA256. The existing Qwen3.8-27B
   Q4 entry already contains its F16 vision projector; it does not need replacing.
2. `install.sh models pull <name>` places those exact files in Lemonade's offline
   Hugging Face cache. Only `user.*` entries call Lemonade's registration `/pull`;
   built-in names rely on the installed Lemonade registry. A loaded service is
   not automatically restarted by this path; it reports that the cached model
   list needs a later restart. An empty service can restart automatically.
3. `lemonadeServer.models()` reads `/models?show_all=true` plus `/health`.
   `lemonadeModel()` normalizes downloaded/loaded state, capabilities, device,
   context, checkpoint and size. `checkServer()` stores these metadata in
   `helena_model_server`; it does not assign models to agents or classes.
4. The existing administrator check endpoint refreshes that list. With Local AI
   and the server enabled, downloaded chat models become `helena-<slug>/<id>`
   entries through `localCatalogModels()`. The runner snapshot includes the same
   server models; its content hash changes automatically when that list changes.
5. The current Helena local-AI page lists models and offers class selection and
   evaluation. It has no individual model download/load/unload action. The native
   installer has `models load`, but no `models unload` command. Do not claim such
   UI controls already exist.

The existing `models load` uses the catalogue's context and backend and sends
`save_options: true`. It adds `pinned: true` only for the separate preload path.
Loading a comparison model is therefore a deliberate runtime action, not merely
registration. A first benchmark must use the agreed bounded context and must
not rewrite defaults, clear old pins or run the broad installer as a shortcut.

## Model selection and fallback

| Path | Current selection | Fallback / boundary |
| --- | --- | --- |
| Agent main model | `ai_agent.model`, or the configured runtime default | A catalogue addition changes neither field. |
| Run | Run model/reasoning, otherwise agent model/reasoning | `chooseModelNow()` resolves availability before claim. |
| Run work class | `classModelNow()` may prefer local for summaries, routines, initial coordinator planning and short reflections | The agent model remains fallback; resumed cloud sessions stay cloud. Existing explicit local run choices stay explicit. |
| Chat | Thread override; otherwise configured spoken model or agent model | Explicit thread choice bypasses the model router. A local refusal restores the configured non-local model/default. |
| Local classes | `routeFor()` uses the class's explicit model, otherwise an eligible loaded/downloaded model | Master/class/device/server/eval gates apply. An automatic class binding can resolve differently when the loaded set changes. |
| Hermes helpers | Class route for compression; a suitable vision model for image description | Explicit agent compression configuration wins; the main model is fallback. |
| Runtime failure | Configured cloud agent model is first in the local fallback chain | Existing owner fallback entries remain behind it, without duplicates. |

Main source locations: `packages/db/src/domains/local-ai.ts`,
`apps/api/src/modules/local-ai/service.ts`,
`apps/api/src/modules/agents/runner/service.ts`,
`apps/api/src/modules/agents/chat/service.ts`, and
`packages/runner/src/local-ai.ts`.

## Device-policy finding

Class routing already chooses the actual normalized model unit (GPU/NPU/CPU),
falling back to the class's declared unit only when the server supplies none.
It rejects a disabled unit. The class label alone therefore does not describe
where a concrete model runs: the transcription class's historical NPU label can
route to the GPU Whisper server when that is explicitly selected.

At the source baseline, direct agent/chat paths are less strict:
`runtimeLocalAi()` and `localCatalogModels()` filter chat/download state and
master/server enablement, while `effectiveModel()` checks existence and
master/server enablement. None of those direct paths checks the model's unit
against `policy.units`. An explicit NPU model could consequently remain offered
and callable with NPU disabled. This is independent of which new model is chosen.
The correction shares downloaded chat-model/device eligibility between the picker,
runner snapshot and direct request path, including the auxiliary vision choice.
It changes no settings or persisted agent/class assignments. Servers with unknown
hardware retain their existing compatibility while any device is enabled; with
all devices off they are unavailable too. A name never invents a device assignment.

## Required evidence before any additive load

- Read only selected live metadata: master/device flags, class modes/model IDs,
  server/model availability, newest eval outcomes, agent model/reasoning and
  routing flags. Never export complete settings, credentials or runtime profiles.
- Record the original explicit and automatic class choices, main agent models,
  device flags and preload pins. Confirm them unchanged after registration and
  after the isolated comparison. In particular, adding a newly loaded candidate
  must not silently become a new default through an automatic class selection.
- Match the existing pinned files to the installed backend's supported registry.
  Use the separate research and synthetic acceptance matrix for context, device,
  model capabilities and fair performance comparisons.
- Keep download, registration, a bounded load and a model assignment as distinct
  operations. A successful benchmark alone does not authorize broad assignment.


## Fresh live metadata supplied by Root

Read-only projection at **2026-09-26 20:59**; historical NPU-off notes are superseded
by this observation, not an instruction to restore them:

- Master enabled; CPU, GPU and NPU **all enabled**; preset `eigene`.
- All three servers enabled/reachable, configured context 65,536.
- `local`: Qwen3.6-35B-A3B-MTP and Qwen3-Embedding-0.6B loaded on GPU/llamacpp;
  Whisper-v3-turbo-FLM also loaded on NPU/FastFlowLM.
- `stt`: Whisper loaded on GPU; `tts`: Qwen3-TTS loaded on GPU.
- Qwen3.8-27B-GGUF is listed but neither downloaded nor loaded.
- `gpt-oss-120b-mxfp-GGUF` is downloaded, not loaded. The separate alias
  `gpt-oss-120b-GGUF` is not downloaded; do not confuse those IDs.
- qwen3.5-2b-FLM is downloaded, not loaded. Mistral Small 4 is not downloaded.

| Class | Mode | Existing explicit model |
| --- | --- | --- |
| speech | prefer | helena-tts/qwen3-tts |
| transcription | prefer | helena-stt/whisper |
| embeddings | prefer | helena-local/Qwen3-Embedding-0.6B-GGUF |
| decisions, summaries, voice-reply, hermes-helpers | prefer | helena-local/Qwen3.6-35B-A3B-MTP-GGUF |
| triage | off | helena-local/qwen3.5-2b-FLM |
| routines, reflection, coordinator-triage | off | helena-local/Qwen3.6-35B-A3B-MTP-GGUF |

Root's historical eval metadata are not a comparative benchmark: prompts, case
counts, class versions and model states differ. In particular the failed recent
Qwen2b runs with zero cases establish no measured model accuracy. A successful
older coordinator eval is not permission to enable that class. Per-agent model
recommendations remain in the separate research/task matrix until their concrete
configuration and fair acceptance results are reviewed.

The supplied projection does not include individual agent model/reasoning
overrides or their current model-router flags. The source routing table above is
verified; a complete live per-agent assignment inventory remains a separate
read-only projection. This patch makes no inference about those stored values.

## Smallest additive Qwen3.8 rollout

The independent R2 source review matched the existing entry to Lemonade
[v2026.39.1's registry](https://github.com/lemonade-sdk/lemonade/blob/v2026.39.1/src/cpp/resources/server_models.json)
and the pinned repository commit `4ca720788d1e01f1bff70c033e0d0028fd02e502`:

| File | Bytes | SHA256 |
| --- | ---: | --- |
| Qwen3.8-27B-UD-Q4_K_XL.gguf | 17559178144 | 3f227079003add2511437e5b1e94812e363385225bf6a9b47b0054a72bc8b01e |
| mmproj-F16.gguf | 927607488 | cbb841a9ee0636b2ec172f5bb8df2ea8dfeb01e90fe7c6126581d662a0b4e43e |

Total 18,486,785,632 bytes (17.217 GiB). **No catalogue rewrite is needed.** MTP and
higher precision variants are separate optional candidates, not implicit parts
of this two-file operation.

1. Root records the current loaded set, preload pins, device flags, class bindings
   and agent model choices, then enters the explicitly authorized quiet window.
2. Review the existing native installer's dry-run for **only**
   `models pull Qwen3.8-27B-GGUF`. Perform the authorized pinned download and verify
   its two hashes. Do not run `install`, clear/set the preload list, remove models
   or alter the original TSV line.
3. If Lemonade's cached downloaded state needs a restart, plan it separately and
   restore the original loaded/pinned set. Refresh Helena through the existing
   server check. Confirm Qwen3.8 now appears as downloaded without changing any
   default, class model or agent model.
4. A load is a separate Root action using the research's bounded context and
   supported backend. Keep original pins. The existing native `models load`
   persists catalogue context 131,072, so it is not an appropriate unreviewed
   shortcut for a smaller benchmark context.
5. Run only the agreed synthetic acceptance, then return to the recorded loaded
   state. Persist new role assignments only after reviewing comparative results.
   This patch does not add model-management UI or make such assignments.

## Focused verification

- Existing Local-AI unit and integration suites: **40 passed, 0 failed, 265
  assertions** on private PostgreSQL port 55568. Requests used only the synthetic
  loopback Lemonade fixture; no real model or external provider was called.
- Replacing only the service with baseline `c731203f` makes five new device
  regression cases fail: each hardware switch, all devices off, queued explicit
  chat fallback, fixed agent assignment fallback and auxiliary vision selection.
  Restoring the candidate passes all 40 tests again.
- API TypeScript, changed-file ESLint and Prettier checks pass. Independent
  read-only review found no remaining blocker. The private PostgreSQL instance
  was stopped after the final run.
- The exact merged Mail/Decision files from `c731203f` were also checked before
  this patch: 63 API tests and 21 related web tests passed, including the Local-AI
  disabled case without filtering it out.
- Live enforcement after Root deployment and any additive model load are not
  asserted by these private tests. Stored configuration, loaded models, pins and
  class/agent assignments remain unchanged by this code preparation.
