# Local AI evaluation commands

The coding suite creates a separate temporary Git repository for each of twelve tasks, runs Hermes with its terminal tools, runs the fixture tests, and removes the repository. It never downloads models or changes Lemonade settings. Run it from a Hermes account that already has the selected providers configured:

```sh
bun apps/api/src/scripts/agentic-coding/run.ts --model-a Qwen3.6-35B-A3B-MTP-GGUF --provider-a helena-local --model-b claude-sonnet-4-6 --provider-b anthropic --json /tmp/coding-comparison.json
```

`--model-b` is optional. The script runs all tasks for A and then all tasks for B, one Hermes process at a time. The JSON contains each task's test outcome, valid and total tool calls, repeated calls, abort status, duration and token counts, plus totals for each model. `--hermes-bin` selects an installed Hermes executable.

The German text suite uses the local AI eval command and an OpenAI-compatible judge endpoint. The judge model defaults to `claude-opus-4-6` and can be changed with `--judge-model`:

```sh
bun apps/api/src/scripts/local-ai-eval.ts --base http://127.0.0.1:13305/api/v1 --key-file /etc/helena/local-ai.key --model Qwen3.6-35B-A3B-MTP-GGUF --classes deutsch-texte --judge-base "$JUDGE_BASE_URL" --judge-key-file "$JUDGE_KEY_FILE" --json /tmp/german-texts.json
```

The Administrator eval endpoint uses `LOCAL_AI_JUDGE_BASE_URL`, `LOCAL_AI_JUDGE_MODEL` and `LOCAL_AI_JUDGE_API_KEY` for the same judge. The `agentic-coding` class uses the installed Hermes CLI; its process needs a configured Hermes profile and access to the selected model.
