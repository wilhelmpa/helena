# Eval-Matrix 2026-09-30

Dry-run: no schema writes. Scores for decisions are precision at the class threshold; coverage must also pass the source eval. Browser: all 20 fixtures, strict page/status checks and no false done. Costs are USD API token costs; local energy costs and subscription judges are not included. Unknown metrics remain blank.

Run: `bun apps/api/src/scripts/eval-matrix.ts --run --backends flash --roles home --judge-cli codex`; 27B requires `--profile local-27b-npu`. `--import-combo` replays existing synthetic decision rows against current labels. The default reads stored results and writes the report plus `~/agent-work/eval-matrix/schema-dry-run.json`; only `--apply-schema` writes database placements through the existing matrix validator.

Window markers: `need-qwen3.5-2b`, `need-qwen3.5-4b`, `need-gemma4-it-e2b`, `need-gemma4-it-e4b`, `need-27b` under `~/agent-work/eval-matrix/`. Claude provides a newer matching `ready-*` file, optionally with JSON `{"base":"http://127.0.0.1:52625/v1","model":"qwen3.5:2b"}`; the runner writes `done-*` after the window. Missing windows remain open. A ready marker must match the loaded model. Jev runs use only `combo-eval/with-jev-key.ts`; the browser variants use the existing `combo-eval/bg` harness. NPU schema writes retain the existing requirement for a passed FLM database eval; raw files alone do not bypass that gate.

| Role | Suite | Backend | Status | Score | p50 ms | p95 ms | tok/s | Tool errors | USD | Source / open reason |
|---|---|---|---|---|---|---|---|---|---|---|
| home | triage | flash | open | – | – | – | – | – | – | 148 Backend worker exited 143; see private local run log |
| home | triage | 27b | open | – | – | – | – | – | – | 148 Not measured |
| home | triage | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| home | triage | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| home | triage | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| home | triage | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| home | triage | jev | open | – | – | – | – | – | – | 148 Not measured |
| home | triage | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| home | triage | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| home | triage | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| home | triage | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| home | triage | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| home | triage | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| home | triage | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| home | triage | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| home | triage | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| home | coordinator-triage | flash | open | – | – | – | – | – | – | 148 Not measured |
| home | coordinator-triage | 27b | open | – | – | – | – | – | – | 148 Not measured |
| home | coordinator-triage | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| home | coordinator-triage | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| home | coordinator-triage | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| home | coordinator-triage | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| home | coordinator-triage | jev | open | – | – | – | – | – | – | 148 Not measured |
| home | coordinator-triage | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| home | coordinator-triage | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| home | coordinator-triage | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| home | coordinator-triage | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| home | coordinator-triage | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| home | coordinator-triage | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| home | coordinator-triage | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| home | coordinator-triage | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| home | coordinator-triage | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| home | routines | flash | open | – | – | – | – | – | – | 148 Not measured |
| home | routines | 27b | open | – | – | – | – | – | – | 148 Not measured |
| home | routines | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| home | routines | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| home | routines | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| home | routines | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| home | routines | jev | open | – | – | – | – | – | – | 148 Not measured |
| home | routines | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| home | routines | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| home | routines | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| home | routines | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| home | routines | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| home | routines | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| home | routines | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| home | routines | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| home | routines | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| home | tool-selection | flash | open | – | – | – | – | – | – | 148 Not measured |
| home | tool-selection | 27b | open | – | – | – | – | – | – | 148 Not measured |
| home | tool-selection | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| home | tool-selection | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| home | tool-selection | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| home | tool-selection | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| home | tool-selection | jev | open | – | – | – | – | – | – | 148 Not measured |
| home | tool-selection | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| home | tool-selection | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| home | tool-selection | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| home | tool-selection | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| home | tool-selection | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| home | tool-selection | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| home | tool-selection | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| home | tool-selection | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| home | tool-selection | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| home | agent-routing | flash | measured/passed | 0.9 | 1752 | 1984 | 9.209 | 0 | 0 | combo-eval/dec-flash-json.json (historical replay)  |
| home | agent-routing | 27b | open | – | – | – | – | – | – | 148 Not measured |
| home | agent-routing | qwen3.5:2b | measured/failed | 0.1 | 1094 | 1115 | 11.849 | 0 | 0 | combo-eval/dec-npu2b-json.json (historical replay)  |
| home | agent-routing | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| home | agent-routing | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| home | agent-routing | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| home | agent-routing | jev | measured/passed | 1 | 228 | 263 | 253.11 | 0 | 0.001 | combo-eval/dec-jev.json (historical replay)  |
| home | agent-routing | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| home | agent-routing | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| home | agent-routing | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| home | agent-routing | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| home | agent-routing | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| home | agent-routing | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| home | agent-routing | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| home | agent-routing | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| home | agent-routing | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | triage | flash | open | – | – | – | – | – | – | 148 Backend worker exited 143; see private local run log |
| coordinator | triage | 27b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | triage | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | triage | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | triage | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | triage | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | triage | jev | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | triage | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | triage | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | triage | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | triage | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | triage | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | triage | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | triage | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | triage | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | triage | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | coordinator-triage | flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | coordinator-triage | 27b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | coordinator-triage | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | coordinator-triage | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | coordinator-triage | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | coordinator-triage | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | coordinator-triage | jev | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | coordinator-triage | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | coordinator-triage | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | coordinator-triage | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | coordinator-triage | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | coordinator-triage | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | coordinator-triage | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | coordinator-triage | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | coordinator-triage | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | coordinator-triage | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | routines | flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | routines | 27b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | routines | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | routines | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | routines | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | routines | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | routines | jev | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | routines | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | routines | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | routines | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | routines | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | routines | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | routines | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | routines | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | routines | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | routines | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | tool-selection | flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | tool-selection | 27b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | tool-selection | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | tool-selection | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | tool-selection | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | tool-selection | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | tool-selection | jev | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | tool-selection | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | tool-selection | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | tool-selection | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | tool-selection | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | tool-selection | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | tool-selection | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | tool-selection | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | tool-selection | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | tool-selection | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | agent-routing | flash | measured/passed | 0.9 | 1752 | 1984 | 9.209 | 0 | 0 | combo-eval/dec-flash-json.json (historical replay)  |
| coordinator | agent-routing | 27b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | agent-routing | qwen3.5:2b | measured/failed | 0.1 | 1094 | 1115 | 11.849 | 0 | 0 | combo-eval/dec-npu2b-json.json (historical replay)  |
| coordinator | agent-routing | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | agent-routing | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | agent-routing | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | agent-routing | jev | measured/passed | 1 | 228 | 263 | 253.11 | 0 | 0.001 | combo-eval/dec-jev.json (historical replay)  |
| coordinator | agent-routing | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | agent-routing | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | agent-routing | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | agent-routing | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | agent-routing | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | agent-routing | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | agent-routing | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | agent-routing | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| coordinator | agent-routing | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coder | agentic-coding | flash | open | – | – | – | – | – | – | 148 Not measured |
| coder | agentic-coding | 27b | open | – | – | – | – | – | – | 148 Not measured |
| coder | agentic-coding | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| coder | agentic-coding | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| coder | agentic-coding | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| coder | agentic-coding | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| coder | agentic-coding | jev | open | – | – | – | – | – | – | 148 Not measured |
| coder | agentic-coding | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| coder | agentic-coding | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| coder | agentic-coding | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coder | agentic-coding | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| coder | agentic-coding | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coder | agentic-coding | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| coder | agentic-coding | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coder | agentic-coding | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| coder | agentic-coding | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coder | routines | flash | open | – | – | – | – | – | – | 148 Not measured |
| coder | routines | 27b | open | – | – | – | – | – | – | 148 Not measured |
| coder | routines | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| coder | routines | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| coder | routines | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| coder | routines | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| coder | routines | jev | open | – | – | – | – | – | – | 148 Not measured |
| coder | routines | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| coder | routines | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| coder | routines | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coder | routines | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| coder | routines | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coder | routines | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| coder | routines | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coder | routines | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| coder | routines | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coder | tool-selection | flash | open | – | – | – | – | – | – | 148 Not measured |
| coder | tool-selection | 27b | open | – | – | – | – | – | – | 148 Not measured |
| coder | tool-selection | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| coder | tool-selection | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| coder | tool-selection | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| coder | tool-selection | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| coder | tool-selection | jev | open | – | – | – | – | – | – | 148 Not measured |
| coder | tool-selection | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| coder | tool-selection | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| coder | tool-selection | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coder | tool-selection | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| coder | tool-selection | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coder | tool-selection | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| coder | tool-selection | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| coder | tool-selection | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| coder | tool-selection | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | agentic-coding | flash | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | agentic-coding | 27b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | agentic-coding | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | agentic-coding | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | agentic-coding | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | agentic-coding | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | agentic-coding | jev | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | agentic-coding | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | agentic-coding | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | agentic-coding | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | agentic-coding | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | agentic-coding | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | agentic-coding | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | agentic-coding | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | agentic-coding | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | agentic-coding | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | routines | flash | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | routines | 27b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | routines | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | routines | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | routines | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | routines | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | routines | jev | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | routines | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | routines | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | routines | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | routines | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | routines | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | routines | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | routines | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | routines | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | routines | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | tool-selection | flash | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | tool-selection | 27b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | tool-selection | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | tool-selection | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | tool-selection | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | tool-selection | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | tool-selection | jev | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | tool-selection | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | tool-selection | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | tool-selection | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | tool-selection | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | tool-selection | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | tool-selection | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | tool-selection | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | tool-selection | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| reviewer | tool-selection | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| planning | summaries | flash | open | – | – | – | – | – | – | 148 Not measured |
| planning | summaries | 27b | open | – | – | – | – | – | – | 148 Not measured |
| planning | summaries | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| planning | summaries | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| planning | summaries | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| planning | summaries | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| planning | summaries | jev | open | – | – | – | – | – | – | 148 Not measured |
| planning | summaries | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| planning | summaries | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| planning | summaries | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| planning | summaries | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| planning | summaries | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| planning | summaries | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| planning | summaries | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| planning | summaries | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| planning | summaries | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| planning | reflection | flash | open | – | – | – | – | – | – | 148 Not measured |
| planning | reflection | 27b | open | – | – | – | – | – | – | 148 Not measured |
| planning | reflection | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| planning | reflection | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| planning | reflection | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| planning | reflection | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| planning | reflection | jev | open | – | – | – | – | – | – | 148 Not measured |
| planning | reflection | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| planning | reflection | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| planning | reflection | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| planning | reflection | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| planning | reflection | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| planning | reflection | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| planning | reflection | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| planning | reflection | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| planning | reflection | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| research | summaries | flash | open | – | – | – | – | – | – | 148 Not measured |
| research | summaries | 27b | open | – | – | – | – | – | – | 148 Not measured |
| research | summaries | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| research | summaries | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| research | summaries | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| research | summaries | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| research | summaries | jev | open | – | – | – | – | – | – | 148 Not measured |
| research | summaries | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| research | summaries | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| research | summaries | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| research | summaries | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| research | summaries | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| research | summaries | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| research | summaries | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| research | summaries | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| research | summaries | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| research | reflection | flash | open | – | – | – | – | – | – | 148 Not measured |
| research | reflection | 27b | open | – | – | – | – | – | – | 148 Not measured |
| research | reflection | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| research | reflection | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| research | reflection | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| research | reflection | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| research | reflection | jev | open | – | – | – | – | – | – | 148 Not measured |
| research | reflection | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| research | reflection | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| research | reflection | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| research | reflection | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| research | reflection | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| research | reflection | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| research | reflection | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| research | reflection | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| research | reflection | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| content | deutsch-texte | flash | open | – | – | – | – | – | – | 148 Not measured |
| content | deutsch-texte | 27b | open | – | – | – | – | – | – | 148 Not measured |
| content | deutsch-texte | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| content | deutsch-texte | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| content | deutsch-texte | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| content | deutsch-texte | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| content | deutsch-texte | jev | open | – | – | – | – | – | – | 148 Not measured |
| content | deutsch-texte | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| content | deutsch-texte | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| content | deutsch-texte | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| content | deutsch-texte | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| content | deutsch-texte | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| content | deutsch-texte | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| content | deutsch-texte | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| content | deutsch-texte | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| content | deutsch-texte | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| content | voice-reply | flash | open | – | – | – | – | – | – | 148 Backend worker exited 143; see private local run log |
| content | voice-reply | 27b | open | – | – | – | – | – | – | 148 Not measured |
| content | voice-reply | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| content | voice-reply | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| content | voice-reply | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| content | voice-reply | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| content | voice-reply | jev | open | – | – | – | – | – | – | 148 Not measured |
| content | voice-reply | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| content | voice-reply | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| content | voice-reply | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| content | voice-reply | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| content | voice-reply | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| content | voice-reply | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| content | voice-reply | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| content | voice-reply | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| content | voice-reply | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| assistant | deutsch-texte | flash | open | – | – | – | – | – | – | 148 Not measured |
| assistant | deutsch-texte | 27b | open | – | – | – | – | – | – | 148 Not measured |
| assistant | deutsch-texte | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| assistant | deutsch-texte | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| assistant | deutsch-texte | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| assistant | deutsch-texte | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| assistant | deutsch-texte | jev | open | – | – | – | – | – | – | 148 Not measured |
| assistant | deutsch-texte | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| assistant | deutsch-texte | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| assistant | deutsch-texte | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| assistant | deutsch-texte | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| assistant | deutsch-texte | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| assistant | deutsch-texte | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| assistant | deutsch-texte | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| assistant | deutsch-texte | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| assistant | deutsch-texte | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| assistant | voice-reply | flash | open | – | – | – | – | – | – | 148 Backend worker exited 143; see private local run log |
| assistant | voice-reply | 27b | open | – | – | – | – | – | – | 148 Not measured |
| assistant | voice-reply | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| assistant | voice-reply | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| assistant | voice-reply | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| assistant | voice-reply | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| assistant | voice-reply | jev | open | – | – | – | – | – | – | 148 Not measured |
| assistant | voice-reply | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| assistant | voice-reply | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| assistant | voice-reply | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| assistant | voice-reply | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| assistant | voice-reply | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| assistant | voice-reply | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| assistant | voice-reply | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| assistant | voice-reply | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| assistant | voice-reply | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | mail | flash | measured/passed | 0.913 | 13543 | 15038 | 8.354 | 0 | 0 | combo-eval/dec-flash-json.json (historical replay)  |
| finance | mail | 27b | open | – | – | – | – | – | – | 148 Not measured |
| finance | mail | qwen3.5:2b | measured/failed | 0.652 | 8174 | 9365 | 9.563 | 1 | 0 | combo-eval/dec-npu2b-json.json (historical replay)  |
| finance | mail | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| finance | mail | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| finance | mail | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| finance | mail | jev | measured/passed | 0.926 | 246 | 376 | 1135.41 | 0 | 0.003 | combo-eval/dec-jev.json (historical replay)  |
| finance | mail | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | mail | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| finance | mail | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | mail | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| finance | mail | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | mail | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| finance | mail | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | mail | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| finance | mail | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | receipts | flash | measured/passed | 1 | 2566 | 3379 | 7.43 | 0 | 0 | combo-eval/dec-flash-json.json (historical replay)  |
| finance | receipts | 27b | open | – | – | – | – | – | – | 148 Not measured |
| finance | receipts | qwen3.5:2b | measured/failed | 0.857 | 1747 | 1870 | 9.786 | 2 | 0 | combo-eval/dec-npu2b-json.json (historical replay)  |
| finance | receipts | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| finance | receipts | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| finance | receipts | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| finance | receipts | jev | measured/passed | 1 | 252 | 312 | 238.571 | 0 | 0.001 | combo-eval/dec-jev.json (historical replay)  |
| finance | receipts | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | receipts | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| finance | receipts | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | receipts | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| finance | receipts | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | receipts | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| finance | receipts | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | receipts | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| finance | receipts | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-rules | flash | measured/passed | 0.917 | 1779 | 2090 | 9.535 | 0 | 0 | combo-eval/dec-flash-json.json (historical replay)  |
| finance | trading-rules | 27b | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-rules | qwen3.5:2b | measured/failed | 0.5 | 1187 | 1417 | 10.461 | 0 | 0 | combo-eval/dec-npu2b-json-trading.json (historical replay)  |
| finance | trading-rules | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-rules | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-rules | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-rules | jev | measured/passed | 1 | 230 | 247 | 91.803 | 0 | 0 | combo-eval/dec-jev-trading.json (historical replay)  |
| finance | trading-rules | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-rules | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-rules | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-rules | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-rules | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-rules | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-rules | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-rules | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-rules | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-routing | flash | measured/passed | 1 | 2094 | 2766 | 8.289 | 0 | 0 | combo-eval/dec-flash-json.json (historical replay)  |
| finance | trading-routing | 27b | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-routing | qwen3.5:2b | measured/failed | 0.833 | 1336 | 1407 | 10.156 | 0 | 0 | combo-eval/dec-npu2b-json-trading.json (historical replay)  |
| finance | trading-routing | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-routing | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-routing | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-routing | jev | measured/passed | 1 | 236 | 255 | 394.522 | 0 | 0.001 | combo-eval/dec-jev-trading.json (historical replay)  |
| finance | trading-routing | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-routing | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-routing | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-routing | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-routing | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-routing | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-routing | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-routing | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| finance | trading-routing | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | privat | flash | measured/passed | 0.963 | 1898 | 3717 | 8.744 | 0 | 0 | combo-eval/dec-flash-json.json (historical replay)  |
| finance | privat | 27b | open | – | – | – | – | – | – | 148 Not measured |
| finance | privat | qwen3.5:2b | measured/failed | 0.654 | 1302 | 2631 | 8.897 | 1 | 0 | combo-eval/dec-npu2b-json.json (historical replay)  |
| finance | privat | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| finance | privat | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| finance | privat | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| finance | privat | jev | measured/passed | 1 | 233 | 280 | 193.864 | 0 | 0 | combo-eval/dec-jev.json (historical replay)  |
| finance | privat | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | privat | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| finance | privat | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | privat | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| finance | privat | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | privat | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| finance | privat | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | privat | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| finance | privat | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | paper-precheck | flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | paper-precheck | 27b | open | – | – | – | – | – | – | 148 Not measured |
| finance | paper-precheck | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| finance | paper-precheck | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| finance | paper-precheck | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| finance | paper-precheck | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| finance | paper-precheck | jev | open | – | – | – | – | – | – | 148 Not measured |
| finance | paper-precheck | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | paper-precheck | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| finance | paper-precheck | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | paper-precheck | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| finance | paper-precheck | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | paper-precheck | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| finance | paper-precheck | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| finance | paper-precheck | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| finance | paper-precheck | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | mail | flash | measured/passed | 0.913 | 13543 | 15038 | 8.354 | 0 | 0 | combo-eval/dec-flash-json.json (historical replay)  |
| trading | mail | 27b | open | – | – | – | – | – | – | 148 Not measured |
| trading | mail | qwen3.5:2b | measured/failed | 0.652 | 8174 | 9365 | 9.563 | 1 | 0 | combo-eval/dec-npu2b-json.json (historical replay)  |
| trading | mail | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| trading | mail | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| trading | mail | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| trading | mail | jev | measured/passed | 0.926 | 246 | 376 | 1135.41 | 0 | 0.003 | combo-eval/dec-jev.json (historical replay)  |
| trading | mail | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | mail | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| trading | mail | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | mail | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| trading | mail | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | mail | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| trading | mail | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | mail | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| trading | mail | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | receipts | flash | measured/passed | 1 | 2566 | 3379 | 7.43 | 0 | 0 | combo-eval/dec-flash-json.json (historical replay)  |
| trading | receipts | 27b | open | – | – | – | – | – | – | 148 Not measured |
| trading | receipts | qwen3.5:2b | measured/failed | 0.857 | 1747 | 1870 | 9.786 | 2 | 0 | combo-eval/dec-npu2b-json.json (historical replay)  |
| trading | receipts | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| trading | receipts | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| trading | receipts | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| trading | receipts | jev | measured/passed | 1 | 252 | 312 | 238.571 | 0 | 0.001 | combo-eval/dec-jev.json (historical replay)  |
| trading | receipts | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | receipts | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| trading | receipts | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | receipts | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| trading | receipts | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | receipts | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| trading | receipts | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | receipts | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| trading | receipts | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-rules | flash | measured/passed | 0.917 | 1779 | 2090 | 9.535 | 0 | 0 | combo-eval/dec-flash-json.json (historical replay)  |
| trading | trading-rules | 27b | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-rules | qwen3.5:2b | measured/failed | 0.5 | 1187 | 1417 | 10.461 | 0 | 0 | combo-eval/dec-npu2b-json-trading.json (historical replay)  |
| trading | trading-rules | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-rules | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-rules | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-rules | jev | measured/passed | 1 | 230 | 247 | 91.803 | 0 | 0 | combo-eval/dec-jev-trading.json (historical replay)  |
| trading | trading-rules | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-rules | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-rules | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-rules | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-rules | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-rules | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-rules | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-rules | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-rules | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-routing | flash | measured/passed | 1 | 2094 | 2766 | 8.289 | 0 | 0 | combo-eval/dec-flash-json.json (historical replay)  |
| trading | trading-routing | 27b | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-routing | qwen3.5:2b | measured/failed | 0.833 | 1336 | 1407 | 10.156 | 0 | 0 | combo-eval/dec-npu2b-json-trading.json (historical replay)  |
| trading | trading-routing | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-routing | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-routing | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-routing | jev | measured/passed | 1 | 236 | 255 | 394.522 | 0 | 0.001 | combo-eval/dec-jev-trading.json (historical replay)  |
| trading | trading-routing | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-routing | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-routing | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-routing | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-routing | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-routing | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-routing | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-routing | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| trading | trading-routing | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | privat | flash | measured/passed | 0.963 | 1898 | 3717 | 8.744 | 0 | 0 | combo-eval/dec-flash-json.json (historical replay)  |
| trading | privat | 27b | open | – | – | – | – | – | – | 148 Not measured |
| trading | privat | qwen3.5:2b | measured/failed | 0.654 | 1302 | 2631 | 8.897 | 1 | 0 | combo-eval/dec-npu2b-json.json (historical replay)  |
| trading | privat | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| trading | privat | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| trading | privat | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| trading | privat | jev | measured/passed | 1 | 233 | 280 | 193.864 | 0 | 0 | combo-eval/dec-jev.json (historical replay)  |
| trading | privat | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | privat | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| trading | privat | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | privat | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| trading | privat | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | privat | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| trading | privat | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | privat | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| trading | privat | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | paper-precheck | flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | paper-precheck | 27b | open | – | – | – | – | – | – | 148 Not measured |
| trading | paper-precheck | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| trading | paper-precheck | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| trading | paper-precheck | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| trading | paper-precheck | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| trading | paper-precheck | jev | open | – | – | – | – | – | – | 148 Not measured |
| trading | paper-precheck | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | paper-precheck | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| trading | paper-precheck | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | paper-precheck | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| trading | paper-precheck | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | paper-precheck | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| trading | paper-precheck | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| trading | paper-precheck | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| trading | paper-precheck | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-direct | flash | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-direct | 27b | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-direct | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-direct | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-direct | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-direct | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-direct | jev | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-direct | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-direct | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-direct | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-direct | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-direct | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-direct | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-direct | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-direct | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-direct | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-jev | flash | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-jev | 27b | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-jev | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-jev | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-jev | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-jev | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-jev | jev | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-jev | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-jev | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-jev | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-jev | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-jev | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-jev | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-jev | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-jev | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| browser | browser-jev | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| support | deutsch-texte | flash | open | – | – | – | – | – | – | 148 Not measured |
| support | deutsch-texte | 27b | open | – | – | – | – | – | – | 148 Not measured |
| support | deutsch-texte | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| support | deutsch-texte | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| support | deutsch-texte | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| support | deutsch-texte | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| support | deutsch-texte | jev | open | – | – | – | – | – | – | 148 Not measured |
| support | deutsch-texte | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| support | deutsch-texte | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| support | deutsch-texte | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| support | deutsch-texte | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| support | deutsch-texte | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| support | deutsch-texte | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| support | deutsch-texte | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| support | deutsch-texte | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| support | deutsch-texte | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| support | voice-reply | flash | open | – | – | – | – | – | – | 148 Backend worker exited 143; see private local run log |
| support | voice-reply | 27b | open | – | – | – | – | – | – | 148 Not measured |
| support | voice-reply | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| support | voice-reply | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| support | voice-reply | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| support | voice-reply | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| support | voice-reply | jev | open | – | – | – | – | – | – | 148 Not measured |
| support | voice-reply | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| support | voice-reply | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| support | voice-reply | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| support | voice-reply | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| support | voice-reply | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| support | voice-reply | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| support | voice-reply | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| support | voice-reply | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| support | voice-reply | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| devops | agentic-coding | flash | open | – | – | – | – | – | – | 148 Not measured |
| devops | agentic-coding | 27b | open | – | – | – | – | – | – | 148 Not measured |
| devops | agentic-coding | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| devops | agentic-coding | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| devops | agentic-coding | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| devops | agentic-coding | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| devops | agentic-coding | jev | open | – | – | – | – | – | – | 148 Not measured |
| devops | agentic-coding | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| devops | agentic-coding | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| devops | agentic-coding | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| devops | agentic-coding | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| devops | agentic-coding | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| devops | agentic-coding | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| devops | agentic-coding | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| devops | agentic-coding | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| devops | agentic-coding | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| devops | routines | flash | open | – | – | – | – | – | – | 148 Not measured |
| devops | routines | 27b | open | – | – | – | – | – | – | 148 Not measured |
| devops | routines | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| devops | routines | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| devops | routines | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| devops | routines | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| devops | routines | jev | open | – | – | – | – | – | – | 148 Not measured |
| devops | routines | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| devops | routines | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| devops | routines | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| devops | routines | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| devops | routines | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| devops | routines | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| devops | routines | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| devops | routines | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| devops | routines | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| devops | tool-selection | flash | open | – | – | – | – | – | – | 148 Not measured |
| devops | tool-selection | 27b | open | – | – | – | – | – | – | 148 Not measured |
| devops | tool-selection | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| devops | tool-selection | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| devops | tool-selection | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| devops | tool-selection | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| devops | tool-selection | jev | open | – | – | – | – | – | – | 148 Not measured |
| devops | tool-selection | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| devops | tool-selection | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| devops | tool-selection | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| devops | tool-selection | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| devops | tool-selection | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| devops | tool-selection | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| devops | tool-selection | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| devops | tool-selection | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| devops | tool-selection | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | triage | flash | open | – | – | – | – | – | – | 148 Backend worker exited 143; see private local run log |
| general | triage | 27b | open | – | – | – | – | – | – | 148 Not measured |
| general | triage | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| general | triage | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| general | triage | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| general | triage | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| general | triage | jev | open | – | – | – | – | – | – | 148 Not measured |
| general | triage | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | triage | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| general | triage | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | triage | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| general | triage | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | triage | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| general | triage | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | triage | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| general | triage | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | routines | flash | open | – | – | – | – | – | – | 148 Not measured |
| general | routines | 27b | open | – | – | – | – | – | – | 148 Not measured |
| general | routines | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| general | routines | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| general | routines | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| general | routines | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| general | routines | jev | open | – | – | – | – | – | – | 148 Not measured |
| general | routines | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | routines | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| general | routines | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | routines | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| general | routines | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | routines | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| general | routines | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | routines | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| general | routines | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | hermes-helpers | flash | open | – | – | – | – | – | – | 148 Not measured |
| general | hermes-helpers | 27b | open | – | – | – | – | – | – | 148 Not measured |
| general | hermes-helpers | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| general | hermes-helpers | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| general | hermes-helpers | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| general | hermes-helpers | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| general | hermes-helpers | jev | open | – | – | – | – | – | – | 148 Not measured |
| general | hermes-helpers | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | hermes-helpers | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| general | hermes-helpers | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | hermes-helpers | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| general | hermes-helpers | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | hermes-helpers | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| general | hermes-helpers | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | hermes-helpers | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| general | hermes-helpers | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | summaries | flash | open | – | – | – | – | – | – | 148 Not measured |
| general | summaries | 27b | open | – | – | – | – | – | – | 148 Not measured |
| general | summaries | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| general | summaries | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| general | summaries | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| general | summaries | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| general | summaries | jev | open | – | – | – | – | – | – | 148 Not measured |
| general | summaries | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | summaries | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| general | summaries | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | summaries | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| general | summaries | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | summaries | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| general | summaries | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | summaries | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| general | summaries | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | reflection | flash | open | – | – | – | – | – | – | 148 Not measured |
| general | reflection | 27b | open | – | – | – | – | – | – | 148 Not measured |
| general | reflection | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| general | reflection | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| general | reflection | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| general | reflection | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| general | reflection | jev | open | – | – | – | – | – | – | 148 Not measured |
| general | reflection | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | reflection | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| general | reflection | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | reflection | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| general | reflection | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | reflection | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| general | reflection | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | reflection | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| general | reflection | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | voice-reply | flash | open | – | – | – | – | – | – | 148 Backend worker exited 143; see private local run log |
| general | voice-reply | 27b | open | – | – | – | – | – | – | 148 Not measured |
| general | voice-reply | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| general | voice-reply | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| general | voice-reply | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| general | voice-reply | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| general | voice-reply | jev | open | – | – | – | – | – | – | 148 Not measured |
| general | voice-reply | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | voice-reply | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| general | voice-reply | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | voice-reply | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| general | voice-reply | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | voice-reply | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| general | voice-reply | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | voice-reply | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| general | voice-reply | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | coordinator-triage | flash | open | – | – | – | – | – | – | 148 Not measured |
| general | coordinator-triage | 27b | open | – | – | – | – | – | – | 148 Not measured |
| general | coordinator-triage | qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| general | coordinator-triage | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| general | coordinator-triage | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| general | coordinator-triage | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| general | coordinator-triage | jev | open | – | – | – | – | – | – | 148 Not measured |
| general | coordinator-triage | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | coordinator-triage | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| general | coordinator-triage | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | coordinator-triage | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| general | coordinator-triage | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | coordinator-triage | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| general | coordinator-triage | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | coordinator-triage | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| general | coordinator-triage | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | general | flash | measured/passed | 0.963 | 1898 | 3717 | 8.744 | 0 | 0 | combo-eval/dec-flash-json.json (historical replay)  |
| general | general | 27b | open | – | – | – | – | – | – | 148 Not measured |
| general | general | qwen3.5:2b | measured/failed | 0.654 | 1302 | 2631 | 8.897 | 1 | 0 | combo-eval/dec-npu2b-json.json (historical replay)  |
| general | general | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| general | general | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| general | general | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| general | general | jev | measured/passed | 1 | 233 | 280 | 193.864 | 0 | 0 | combo-eval/dec-jev.json (historical replay)  |
| general | general | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | general | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| general | general | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | general | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| general | general | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | general | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| general | general | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | general | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| general | general | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | router | flash | measured/passed | 0.963 | 4077 | 4763 | 9.356 | 0 | 0 | combo-eval/dec-flash-json.json (historical replay)  |
| general | router | 27b | open | – | – | – | – | – | – | 148 Window missing: ready-27b |
| general | router | qwen3.5:2b | measured/failed | 0.63 | 2709 | 2855 | 9.652 | 0 | 0 | combo-eval/dec-npu2b-json.json (historical replay)  |
| general | router | qwen3.5:4b | open | – | – | – | – | – | – | 148 Window missing: ready-qwen3.5-4b |
| general | router | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Window missing: ready-gemma4-it-e2b |
| general | router | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Window missing: ready-gemma4-it-e4b |
| general | router | jev | measured/passed | 1 | 234 | 284 | 299.156 | 0 | 0.001 | combo-eval/dec-jev.json (historical replay)  |
| general | router | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | router | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| general | router | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | router | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| general | router | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | router | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| general | router | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | router | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| general | router | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | routine-gate | flash | measured/passed | 0.867 | 2013 | 2107 | 10.627 | 0 | 0 | combo-eval/dec-flash-json.json (historical replay)  |
| general | routine-gate | 27b | open | – | – | – | – | – | – | 148 Not measured |
| general | routine-gate | qwen3.5:2b | measured/failed | 0.621 | 1067 | 1104 | 11.291 | 0 | 0 | combo-eval/dec-npu2b-json.json (historical replay)  |
| general | routine-gate | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| general | routine-gate | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| general | routine-gate | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| general | routine-gate | jev | measured/passed | 0.882 | 231 | 284 | 130.912 | 0 | 0 | combo-eval/dec-jev.json (historical replay)  |
| general | routine-gate | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | routine-gate | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| general | routine-gate | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | routine-gate | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| general | routine-gate | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | routine-gate | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| general | routine-gate | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | routine-gate | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| general | routine-gate | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | heartbeat-precheck | flash | measured/failed | 0.7 | 1735 | 2073 | 9.414 | 0 | 0 | combo-eval/dec-flash-json.json (historical replay)  |
| general | heartbeat-precheck | 27b | open | – | – | – | – | – | – | 148 Not measured |
| general | heartbeat-precheck | qwen3.5:2b | measured/failed | 0.488 | 1106 | 1318 | 11.359 | 0 | 0 | combo-eval/dec-npu2b-json.json (historical replay)  |
| general | heartbeat-precheck | qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| general | heartbeat-precheck | gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| general | heartbeat-precheck | gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| general | heartbeat-precheck | jev | measured/failed | – | 227 | 280 | 85.849 | 0 | 0.001 | combo-eval/dec-jev.json (historical replay)  |
| general | heartbeat-precheck | jev-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | heartbeat-precheck | jev-qwen3.5:2b | open | – | – | – | – | – | – | 148 Not measured |
| general | heartbeat-precheck | qwen3.5:2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | heartbeat-precheck | jev-qwen3.5:4b | open | – | – | – | – | – | – | 148 Not measured |
| general | heartbeat-precheck | qwen3.5:4b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | heartbeat-precheck | jev-gemma4-it:e2b | open | – | – | – | – | – | – | 148 Not measured |
| general | heartbeat-precheck | gemma4-it:e2b-flash | open | – | – | – | – | – | – | 148 Not measured |
| general | heartbeat-precheck | jev-gemma4-it:e4b | open | – | – | – | – | – | – | 148 Not measured |
| general | heartbeat-precheck | gemma4-it:e4b-flash | open | – | – | – | – | – | – | 148 Not measured |

| Profile | Role | Recommended backend | Model | Reasoning |
|---|---|---|---|---|
| local-halogen | home | codex | gpt-6.1-sol | high |
| local-halogen | coordinator | codex | gpt-6.1-sol | high |
| local-halogen | coder | codex | gpt-6.1-sol | high |
| local-halogen | reviewer | codex | gpt-6.1-sol | high |
| local-halogen | planning | claude | claude-sonnet-5-5 | high |
| local-halogen | research | codex | gpt-6.1-sol | medium |
| local-halogen | content | claude | claude-sonnet-5-5 | medium |
| local-halogen | assistant | codex | gpt-6.1-sol | medium |
| local-halogen | finance | claude | claude-sonnet-5-5 | high |
| local-halogen | trading | codex | gpt-6.1-sol | high |
| local-halogen | browser | codex | gpt-6.1-sol | medium |
| local-halogen | support | codex | gpt-6.1-sol | medium |
| local-halogen | devops | codex | gpt-6.1-sol | high |
| local-halogen | general | codex | gpt-6.1-sol | medium |
| local-27b-npu | home | codex | gpt-6.1-sol | high |
| local-27b-npu | coordinator | codex | gpt-6.1-sol | high |
| local-27b-npu | coder | codex | gpt-6.1-sol | high |
| local-27b-npu | reviewer | codex | gpt-6.1-sol | high |
| local-27b-npu | planning | claude | claude-sonnet-5-5 | high |
| local-27b-npu | research | codex | gpt-6.1-sol | medium |
| local-27b-npu | content | claude | claude-sonnet-5-5 | medium |
| local-27b-npu | assistant | codex | gpt-6.1-sol | medium |
| local-27b-npu | finance | claude | claude-sonnet-5-5 | high |
| local-27b-npu | trading | codex | gpt-6.1-sol | high |
| local-27b-npu | browser | codex | gpt-6.1-sol | medium |
| local-27b-npu | support | codex | gpt-6.1-sol | medium |
| local-27b-npu | devops | codex | gpt-6.1-sol | high |
| local-27b-npu | general | codex | gpt-6.1-sol | medium |

| Profile | Class | Recommended backend | Cloud fallback |
|---|---|---|---|
| local-halogen | triage | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-halogen | coordinator-triage | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-halogen | routines | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-halogen | tool-selection | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-halogen | agents.routing | flash | gpt-6.1-sol / claude-sonnet-5-5 |
| local-halogen | agentic-coding | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-halogen | browser-direct | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-halogen | browser-jev | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-halogen | deutsch-texte | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-halogen | voice-reply | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-halogen | summaries | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-halogen | reflection | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-halogen | helena.mail | flash | gpt-6.1-sol / claude-sonnet-5-5 |
| local-halogen | helena.receipts | flash | gpt-6.1-sol / claude-sonnet-5-5 |
| local-halogen | helena.trading.rules | flash | gpt-6.1-sol / claude-sonnet-5-5 |
| local-halogen | helena.trading.routing | flash | gpt-6.1-sol / claude-sonnet-5-5 |
| local-halogen | volition.private | flash | gpt-6.1-sol / claude-sonnet-5-5 |
| local-halogen | paper-precheck | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-halogen | hermes-helpers | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-halogen | helena.general | flash | gpt-6.1-sol / claude-sonnet-5-5 |
| local-halogen | helena.model-router | flash | gpt-6.1-sol / claude-sonnet-5-5 |
| local-halogen | helena.routine.gate | flash | gpt-6.1-sol / claude-sonnet-5-5 |
| local-halogen | routines.precheck | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-27b-npu | triage | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-27b-npu | coordinator-triage | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-27b-npu | routines | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-27b-npu | tool-selection | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-27b-npu | agents.routing | flash | gpt-6.1-sol / claude-sonnet-5-5 |
| local-27b-npu | agentic-coding | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-27b-npu | browser-direct | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-27b-npu | browser-jev | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-27b-npu | deutsch-texte | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-27b-npu | voice-reply | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-27b-npu | summaries | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-27b-npu | reflection | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-27b-npu | helena.mail | flash | gpt-6.1-sol / claude-sonnet-5-5 |
| local-27b-npu | helena.receipts | flash | gpt-6.1-sol / claude-sonnet-5-5 |
| local-27b-npu | helena.trading.rules | flash | gpt-6.1-sol / claude-sonnet-5-5 |
| local-27b-npu | helena.trading.routing | flash | gpt-6.1-sol / claude-sonnet-5-5 |
| local-27b-npu | volition.private | flash | gpt-6.1-sol / claude-sonnet-5-5 |
| local-27b-npu | paper-precheck | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-27b-npu | hermes-helpers | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
| local-27b-npu | helena.general | flash | gpt-6.1-sol / claude-sonnet-5-5 |
| local-27b-npu | helena.model-router | flash | gpt-6.1-sol / claude-sonnet-5-5 |
| local-27b-npu | helena.routine.gate | flash | gpt-6.1-sol / claude-sonnet-5-5 |
| local-27b-npu | routines.precheck | cloud | gpt-6.1-sol / claude-sonnet-5-5 |
