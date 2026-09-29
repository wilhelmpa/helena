# Flash tool-call evaluation

`inventory.ts` writes the tools' schema size in bytes, required fields, enums, nested objects, and description lengths. `fixtures/inventory.json` is the snapshot from commit `4a874d577` plus this branch. `fixtures/external-tools.json` describes the local fixture MCP server; pass a `tools/list` export as the optional second input to include another configured external server.

`eval.ts` runs German prompts through the central agent loop with the real Helena, browser and configured-tool descriptors. Its tool executors return fixture data, so the evaluation makes no mail, trading, browser or remote MCP changes. It requires a private PostgreSQL database on `127.0.0.1`, a non-default port, and a database name ending in `_test` or `_eval`. The JSON report records selection, schema errors, evidence in the answer, repeated calls, input tokens, duration, and inventory coverage for each case.

Run it with the local model and exclusive lock:

```sh
flock ~/agent-work/halogen-bench.lock \
  ~/agent-work/heavy.sh bun apps/api/src/scripts/flash-tools/eval.ts \
  --model halogen-qwen3.8-flash-next \
  --out ~/agent-work/codex-tasks/105-private/result.json \
  --health-log ~/agent-work/codex-tasks/105-private/health.jsonl
```

Set `DATABASE_URL`, `APP_URL`, `API_URL` and the test authentication settings for the private stack before running. The evaluator checks `/health` for `busy=false` before every model request, waits for other Helena traffic, and records a health outage after 60 seconds with restart count and memory diagnostics. It stops if Halogen restarts or remains unavailable for ten minutes. Never start or restart Halogen from the evaluator.

The fixture corpus has two prompts for each represented group and two multistep tasks. It is a routing and argument test, not an end-to-end proof of every Helena route. External MCP tools need a `tools/list` export passed to `inventory.ts` because their schemas depend on the local configuration. Add route-specific fixtures and real private-stack assertions before claiming coverage of all tools.
