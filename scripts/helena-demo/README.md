# Helena demo

## The seed

`seed.ts` loads a demo organization into a running Helena through its HTTP API. It never
touches the database, so it works against any install, local or remote.

```bash
HELENA_API_KEY=<your personal API key> bun scripts/helena-demo/seed.ts --base-url=http://localhost:3000
```

| Flag | Effect |
|---|---|
| `--dry-run` | Prints what it would create, writes nothing |
| `--with-skills` | Also imports the templates' skills and MCP servers from the pool bundle (GitHub skills are pinned to a commit and need the network) |
| `--start-work` | Assigns the first task of each project to a specialist, which queues a real agent run |
| `--team-id=N` | The team to seed; default is the key owner's first team |

It creates:
- the pool templates the demo copies, imported from the pool bundle `bundles/agent-pool`
  through the template-bundle import (`scripts/helena-bundle-sync.ts`). Once bundles also
  carry project and workflow templates, the demo itself becomes a bundle (`bundles/demo`);
- two projects (`SITE` "Demo: Website relaunch", `OPS` "Demo: Operations"), each with the
  coordinator Helena gives every project, reporting to the Home agent;
- specialists copied from templates (researcher, tech-writer and qa in SITE; planner and
  researcher in OPS), reporting to their coordinator;
- five sample tasks;
- a weekly routine in OPS ("Weekly status report", Mondays 09:00);
- the workflow "Research, write, review" in SITE (researcher → writer → your approval →
  comment), enabled with its roles resolved by capability.

It is **idempotent**: every step reads first and creates only what is missing. Tested
2026-09-24 against a real API on a throwaway database: the first run made 22 writes, the
second 0. Two expected warnings came up:
- that environment has no Home agent (it is bootstrapped by the runner service);
- no scheduler for routines, until hub/native-engine replaces Mastra.

Helena limits an API key to 100 requests per one-second window. The window only restarts
after a quiet second, and the API reports the refusal as a 500. The seed therefore pauses
after every 90 requests and retries a failed GET once.

## Demo without an API key (design)

Release criterion 5 of the OSS plan: "Demo läuft ohne eigenen API-Key mit Beispieldaten
(Antworten aus Aufzeichnung) oder mit einem Key". The design follows §3a (framework): it is a
**runtime adapter**, a plugin like Hermes, Claude Code and Codex, not a special path in the
core.

### Pieces

1. **`replay` runtime** at the runner's runtime extension point (`packages/runner`, moving
   to `@helena/sdk`'s runtime registry). An agent whose runtime is `replay` gets its runs and
   chat answers from recordings instead of a model.
2. **Recordings:** `scripts/helena-demo/recordings/<task-slug>.jsonl`, one per demo task and
   workflow step, plus a few chat exchanges. Each line is an AG-UI event, the format the
   runner already streams to Helena:
   - text deltas, reasoning, tool calls with arguments and results;
   - the final summary;
   - token usage, marked `simulated: true` and shown at cost 0.
3. **Side effects that are real.** A recorded call to one of Helena's own MCP tools
   (`comment_issue`, `create_subtask`, `request_approval`, `mark_issue_blocked`, `write_note`)
   is **executed** against Helena by the replay adapter, with the agent's key. The board,
   the approval card and the workflow run therefore change for real. Every other recorded
   tool call (shell, browser, web) is only shown. The adapter has an allowlist and no shell,
   browser or network of its own.
4. **Matching:** a run is matched by the demo task's title (or the workflow step id) to its
   recording. Anything else, such as a new task or a free chat question, gets one honest
   recorded answer: "I am a demo agent without a model. Add a model key under Zugänge and
   switch me to Hermes to let me really work on this."
5. **Pace:** events replay at their recorded timing, compressed to at most 30 seconds per
   run, so the live transcript looks like a real one.
6. **Switching to real work:** the demo agents carry the runtime `replay`. The setup page
   offers "Use my model key": it stores the key in Zugänge and switches the demo agents to
   `hermes`. Nothing else changes; their memory starts empty.
7. **UI:** a banner slot (framework UI slot "page header notice") reads "Demo: answers are
   recorded" on runs and chats that came from `replay`.

### Making the recordings

`helena demo record` (maintainers only) runs the demo tasks once on a real instance with a
real key and a fixed model, captures the AG-UI stream of each run, drops secrets and
machine-specific paths, and writes the JSONL files. A recording carries the AG-UI schema
version and the Helena version that made it. CI replays every recording against a test
instance and checks that the side effects land (the comment exists, the approval is
pending). A recording is re-made when the demo data or the tool schemas change.

### Cost and size

- One recording session costs one round of the demo tasks with a small model, a few cents.
- The recordings are a few hundred KB of JSONL, shipped in the `helena` image.
