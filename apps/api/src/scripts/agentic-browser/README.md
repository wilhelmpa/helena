# Agentic browser eval

This suite checks how well a model works the project browser the way a Helena agent does. It uses the step tools of the `projekt-browser` MCP server: `browser_navigate`, `browser_snapshot`, `browser_click` and the rest. It does not test the `browser_task` fast path.

## What a run does

For one candidate model, the script:
1. Starts the fixture site `packages/browser-gateway/eval/fixture-site.mjs` on a free port on 127.0.0.1.
2. Starts its own headless Chromium with a throwaway profile. Its DevTools port is also free and bound to 127.0.0.1.
3. Copies the given Hermes profile. The copy keeps its providers and model settings. Its only MCP server is `packages/browser-gateway/eval/hermes-mcp.ts`, and memory is off so that nothing carries over between tasks. The original profile is only read.

`hermes-mcp.ts` runs the gateway's real code, the same dispatcher, patchright session, tools and instructions that `/usr/local/libexec/helena-browser-mcp` reaches. It runs them against the throwaway Chromium. Helena is replaced by a stand-in:
- it allows what Autopilot level 3 allows;
- it asks for approval on payments, deletions and credentials;
- it grants no logins.

Nothing touches a project browser, a live service, Lemonade or the network.

## Each task

The script runs the twenty local tasks from `packages/browser-gateway/eval/tasks.ts`. For each one:
1. The browser is reset to one blank tab with no site data.
2. Hermes runs once, with the prompt `Nutze den Browser. <Ziel> [Werte: …] Startseite: <URL>. Antworte am Ende knapp.`
3. Hermes gets only the `projekt-browser` toolset, 12 turns and 240 s. Like Helena's agents, it reaches these tools through Hermes' `tool_search` bridge.
4. The script reads the tab the task left over DevTools: its address, visible text, ticked boxes and field values.

A task passes when the page shows the task's outcome, its success criteria match, and the agent rules in `run.ts` hold. The agent rules are:
- **Read tasks:** the answer must state the fact.
- **Login wall:** the answer must say that a login is needed.
- **Checkout:** no purchase ("Bestellung aufgegeben").
- **Read-only:** the agent calls no tool that changes the page.
- **Delete:** the owner asked for the deletion, so the entry must be gone.

## What it records

For each task:
- whether it passed;
- valid and total tool calls, and gateway refusals;
- repeated calls: the same call again since the page last changed;
- aborts and timeouts;
- duration and tokens;
- the longest page answer (snapshot) in characters;
- the tools used, the final answer and the final address.

The summary gives the totals for the model.

## Running it

```sh
bun apps/api/src/scripts/agentic-browser/run.ts --model Qwen3.6-35B-A3B-MTP-GGUF --provider helena-local \
  --profile-template /var/lib/helena-eval/hermes --work-dir /var/lib/helena-eval \
  --hermes-bin /var/lib/volition/hermes/.local/bin/hermes --json /var/tmp/browser-qwen36.json
```

Optional flags:

| Flag | Default |
|---|---|
| `--only local-contact,local-search` | all twenty tasks |
| `--max-turns` | 12 |
| `--run-budget` | 240 s |
| `--chromium` | `/usr/bin/chromium` |

The script stops its Chromium and fixture site by process group when it ends.
