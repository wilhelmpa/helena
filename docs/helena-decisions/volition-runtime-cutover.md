# Native runtime cutover: blocked integration candidate

Task 113 prepares `hub/zentrale-laufzeit-4` from Release 11 and the incoming
`hub/zentrale-laufzeit-3`. Keep `HELENA_NATIVE_RUNTIME` off until the missing behavior,
acceptance tests and UI work below are complete. This branch is not a release approval.

## Missing behavior

| Requirement | Current implementation | Work before acceptance |
| --- | --- | --- |
| Finished Release 11 fixes | `hub/rel-11-fix` still points at `c32d9f7c5` during task 113; task 112 has uncommitted corrections and an unfinished repeated API run | Integrate the committed result of task 112 before the complete test and acceptance run |
| Learned skills | `packages/runner/src/helena-runtime.ts` rejects skill actions; `packages/agent-runtime/src/tools/builtin.ts` only loads supplied skills | Native creation, revision, pin/discard and policy handling; preserve script/reference files; prove learning and reuse |
| Readable native sessions | `apps/api/src/modules/agents/runtime-views/index.ts` asks runtime readers; `packages/runner/src/readers/index.ts` registers only Hermes, Claude and Codex | Read native sessions and transcripts with existing project/chat-owner access checks; expose imported histories without requiring Hermes |
| Persistent agent instructions | `instructionsOf()` in the native adapter selects only `SOUL.md` | Apply the configured `AGENTS.md` and relevant instruction contributions without duplicating generated context |
| Profile migration | No Hermes-to-native importer exists | Dry-run by default; explicit profile-to-agent mapping; source snapshots unchanged; idempotence, concurrent-import protection, collision handling and access-preserving session links |
| Cloud fallback | `KEY_PROVIDERS` has API-key providers; `modelChain()` skips unknown providers, including `openai-codex`; subscription escalation uses a separate follow-up agent | Explicitly map subscription fallbacks to authorized Claude/Codex agents, retain context and cancellation, prove refusal/unavailability inside the sandbox |
| Bulk runtime selection | Per-agent runtime policy exists | Authorized bulk operation preserving unrelated settings, active-run behavior and a saved per-agent rollback mapping |
| Model catalog without Hermes | `volition-hermes-catalog.py` imports Hermes modules even for native model catalog construction | Native catalog/provisioning path that works after Hermes removal |

## Remaining Hermes dependencies

The task evidence `113-hermes-references.txt` lists all files matching `hermes`
case-insensitively in runner, API, web, SDK, database source and the deployment stack,
excluding dedicated test directories and test files; it is a textual inventory, not proof
that dynamically constructed or externally installed references have been discovered.

| Area | Main paths | Removal step | Rollback |
| --- | --- | --- | --- |
| Runner and profiles | `packages/runner/src/{adapters,presets,runtimes,hermes-profile,hermes-settings,local-ai,learning}.ts`, `readers/hermes*`, `limits/hermes.ts` | Retire adapter/profile/readers only after native parity and migration acceptance | Retained Hermes package and unchanged profiles; restore saved agent runtime policies |
| Catalog and bootstrap | `deployment/volition-stack/integration/scripts/volition-hermes-{catalog.py,bootstrap,runner}` | Separate native catalog and provisioning from Hermes imports | Restore previous scripts and catalog generation |
| Token keeper | `deployment/volition-stack/native/token-keeper/` | Remove only Hermes views/refresh paths after independent Claude/Codex credentials work | Restore Hermes views from the retained keeper configuration |
| Updates | `apps/api/src/modules/updates/sources/hermes.ts`, `apps/api/src/modules/runtime-admin/{index,hermes-update}.ts`, `deployment/volition-stack/native/hermes-update/` | Remove Hermes registration/routes/update unit after final retirement | Restore previous registry/routes/unit definitions |
| Units | `deployment/volition-stack/{integration,native}/systemd/volition-hermes-runner.service`, integration bootstrap service/timer | Replace provisioning and runner units; retire Hermes bootstrap last | Restore old unit definitions and prior runtime descriptors |
| Isolation | `deployment/volition-stack/isolation/launcher.json`, launcher/configuration code | Retain native/Claude/Codex bindings and priority sockets; remove Hermes runtime/auth binds only after sandbox proof | Restore previous launcher configuration and retained Hermes profile binds |
| API defaults and capabilities | `apps/api/src/modules/agents/`, `runtime-admin/`, `updates/`, `packages/sdk/src/` | Native default, explicit transition runtime, capability-based operations | Restore each agent's saved runtime/model/policy, not a global forced default |
| UI and translations | `apps/web/src/components/helena/RuntimePicker.tsx`, agent/runtime/settings features, `apps/web/messages/` | Claude supplies design-system controls and native feature views, then removes transition texts | Previous UI bundle while the compatibility API remains available |

## Order for Claude after the blockers are resolved

1. Commit and integrate the finished task-112 fixes, reconcile any later migration collision,
   and pass the requested suites on a private Postgres through `heavy.sh`.
2. Complete native learning, session views, instructions, bulk selection, migration and
   fallback; test import twice, conflicting/newer native data, partial failures, file
   preservation and cross-user/project access with synthetic profiles.
3. Run coding 12, browser 20, German text and class evaluations sequentially under
   `flock ~/agent-work/halogen-bench.lock`, through the priority proxy as `background`,
   with the same Hermes/Flash fixtures; record per-turn input tokens, first answer latency
   and tool failures; stop immediately on a Halogen failure.
4. Finish the design-system UI and screenshot acceptance for skills, MEMORY/USER, SOUL,
   AGENTS.md, learning/dreaming, session histories and bulk runtime selection.
5. Schedule a cutover window, drain active work, save the database and each agent's full
   runtime/model/policy mapping, and retain consistent Hermes profile snapshots and the
   previous release; run the completed importer in dry-run mode and resolve every conflict.
6. Through the normal release procedure, apply the reconciled migration and release the API,
   engine, runner bundle, catalog/provisioner and isolation definitions together, with native
   runtime still disabled; apply the approved import and verify its second pass is unchanged.
7. Enable native runtime for selected canary agents on
   `helena-halogen/halogen-qwen3.8-flash-next`; prove chat, tools, learning, resume, approvals,
   compression, costs, claims/budgets, persistent orders, Telegram and cloud fallback before
   the remaining agents move; keep Claude/Codex escalation agents on their own runtimes.
8. After owner acceptance of that state, remove the Hermes dependencies in the table and
   archive the originals; on failure before retirement, drain native work and restore the
   saved per-agent settings plus the previous runtime stack, retaining native histories
   separately because no reverse history migration has been implemented.

No step in this sequence has been executed on the live system by task 113.

## Validation at handover

The private database migration passed, as did 51 runtime/runner tests, the native runtime
package typecheck and formatting. Full Web lint finished with no errors and five warnings.
The first API run had 16 passes and nine failures because the hardening suite did not enable
`HELENA_NATIVE_RUNTIME`; its setup now enables and restores that flag, but the repeated API
run is still pending. The workspace typecheck first stopped on the new fetch test double's
missing Bun `preconnect` property; that issue is fixed and the package typecheck passes, but
the remaining workspace checks are pending. Waiting repetitions were cancelled when task
112 occupied the sole heavy test slot with another full API run. No model eval was started.
