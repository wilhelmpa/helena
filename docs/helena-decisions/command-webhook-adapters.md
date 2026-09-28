# Command and webhook agent adapters

An agent with one project may select `runtimePolicy.runtime` as `command` or `webhook`. The existing agent runner claims and reports its runs and chats, so queue leases, heartbeats, history and budget gates use the same API as the other runtimes. Before each invocation the runner asks `/agent-policy/decide`; a response other than `allow` stops the invocation. The agent's API key and any delivered environment variables keep their existing grants.

## Command

Set `runtimePolicy.commandScript` to a relative file path below the project workspace, such as `scripts/review.sh`. The runner passes its absolute path to `/bin/sh -eu` in the project's isolated unit. The launcher refuses paths outside the workspace, links and nonregular files. The script receives one JSON object on stdin with `prompt`, `systemPrompt`, `sessionId`, `model`, `thinkingLevel`, `maxTurns`, `runBudgetSeconds` and `autopilotLevel`. The existing `ITSAPLAN_*` environment variables identify the run or chat and its API access. Stdout is the result; stderr and a nonzero exit code report failure. Output is capped at 64 KiB.

## Webhook

Set `runtimePolicy.webhookUrl` to a public HTTPS URL and `webhookSecretEnv` to the name of an environment variable granted to this agent through Zugänge. Its value is a 24–64 byte signing key serialized as `whsec_` plus base64. Helena sends a JSON `agent.run` or `agent.chat` event with task data and the three [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md) headers `webhook-id`, `webhook-timestamp` and `webhook-signature`. The signature is `v1,` plus base64 HMAC-SHA256 over `id.timestamp.raw_body`. The request has a fixed ID per run or chat message, a deadline from the run budget, a 64 KiB response limit, no redirects and a DNS-pinned public target. A successful response body becomes the result; a non-2xx status fails the run.

Both adapters accept a JSON result of `{ "output": "…", "usage": { "inputTokens": 0, "outputTokens": 0 }, "spend": { "inputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0, "cacheWriteTokens": 0, "reasoningTokens": 0 } }`. Report token counts when the script or service uses a model; Helena records those counts in the same budget ledger. Plain text output has no reported model spend. The script author and webhook operator remain responsible for enforcing policy inside their own code: Helena checks the invocation and its own API actions, but cannot inspect arbitrary side effects inside a script or external service.
