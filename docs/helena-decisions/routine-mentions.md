# Decision: @mentions in routines, and quiet routine runs

Status: accepted, 2026-09-25 · Branch: `hub/routine-mentions`

Owner decisions of 2026-09-25:

1. A routine's instructions may @mention agents, and every run starts each mentioned agent the
   way the owner's @mention in a task does ("Montags: @coder-vol prüf die Abhängigkeiten,
   @content-seo-vol fasse zusammen"). Every guard of a mention stays.
2. The E2E test found a notification flood: "Routine-Aufgaben: Der Agent erwähnt den Owner bei
   jeder Ausführung (@patrick.wilhelm) → Benachrichtigungsflut bei häufigen Routinen." A normal
   successful routine run leaves its result in the task quietly. The owner hears of a run only
   when it failed, needs an approval or decision, or the agent asks him for input.

No outside standard covers either: both are rules of Helena's own mention and notification
model, built on the existing mention resolution (`#shared/mentions`), agent queue (`agent_run`),
engine run history (`pipeline_run_step` parts) and inbox (`notification`). Nothing new is
installed and there is no migration.

## 1. A routine's mentions start agents

- **Whose mentions:** those of the member the routine acts for (`helena_schedule.actor_user_id`,
  whoever last saved what it does). The guards are the ones of a comment's mentions
  (`listMentionTriggerAgents`), now also named with a reason
  (`mentionedAgents` in `modules/agents/core/service.ts`):
  - `not-in-project`: an agent of the team outside the project reads as plain text, as in a
    comment;
  - `agent-author`: a routine an agent saved (the MCP tools `create_routine`/`update_routine`)
    starts nobody by a mention. This is the loop guard: only a delegation hands one agent's
    work to another. The routine's own delegation still runs;
  - `owner-only`: an agent scoped to its owner takes work only from that member;
  - `mentions-off`: the agent does not react to mentions;
  - `paused`: it takes no new work.
- **At save:** `owner-only` refuses the save with 403, like the routine's own agent does; so
  does "Jetzt ausführen" by a member the agent does not take work from. The other reasons can
  change before the next run, so they are only reported.
- **At every run:** the fire's `delegate` step resolves the mentions again and, for each named
  agent other than the routine's own, writes a part `dispatch.m<agentId>` of its dispatch step:
  `mention-started` with the agent run, or `mention-<reason>` as skipped. The run history
  shows these parts under the step ("Erwähnt in den Anweisungen · Gestartet · Agentenlauf #12
  · Läuft"), so it says which agents a run started and which it could not.
- **The run:** a `mention` run on the routine's task with the instructions as prompt, no
  source comment and the work class `routines` (Lokale KI treats it like the routine's
  delegation run). It is queued in the same transaction that creates (or reopens) the task and
  writes the part, so no runner claims it before it is known as the routine's, and a replayed
  fire starts nobody twice. The Autopilot, budgets, pause and approvals apply to it as to any
  run.
- **What the agents are told:** the runner frames a routine's runs apart
  (`frameRoutineDelegation`, `frameRoutineMention`): the agent the task is delegated to learns
  which agents the routine started beside it and must not hand their parts to them again (the
  E2E finding behind 1e1b935d); a mentioned agent learns its delegate and the others, does
  only its part and leaves the status to the delegate.
- **Parallel, like a comment:** all named agents start at once. A routine that needs an order
  ("first check, then summarize") is a workflow, or a routine delegated to a coordinator.
- **Editor:** the instructions are a Markdown editor with "@" autocomplete (the task editor's),
  and below it a live preview of the agents they start (`POST
  /projects/:key/routines/mentions`, same rules as the fire). The list shows "Startet auch …"
  and, in red, how many mentions start nobody.

## 2. A routine's work is quiet

**Cause of the flood.** A routine's task has no assignee, and the delegation prompt told the
agent: "This issue has no assignee … tag the one member whose role best fits this work. If none
clearly fits, tag a project owner. Tag exactly one person." So every run ended with a comment
that tagged the owner. On top, the routine's author was subscribed to every task a routine
created (the author of a task follows it), so every run also sent him "commented" and
"state_changed".

**Design (least surprising):**

1. **Prompt.** A delegation run on a routine's task and a routine's mention run say: a routine's
   result is read in its task, not announced — tag nobody; only when you cannot go on without a
   person's answer, call `mark_issue_blocked`. The People block drops its "tag the assignee"
   advice for these runs. This removes the cause.
2. **No subscription.** The routine files its task, not its author: a created task subscribes
   nobody (`createIssue(…, { subscribeAuthor: false })`). A reopening tells no watcher
   (`updateIssue(…, { quiet: true })`).
3. **Quiet while the routine's run lasts.** What an agent writes on the task while its claimed
   run there is a routine's (the delegation run a fire starts — work class `routines` — or a
   mention run a fire started) tells none of the task's watchers — no "commented", no "state_changed". This covers
   the watchers a reopened task already has. A run a person starts later on the same task (by
   mentioning the agent, answering it, delegating the task anew) is ordinary again: that is
   a conversation.
4. **A mention anyway: once a day.** If an agent still tags a person during a routine's run,
   that person gets at most one "mentioned" per routine and calendar day (in the routine's time
   zone); the others stay visible in the task. Check and insert hold a lock per routine, so two
   agents of one fire tagging the same person at once still make one notification.
   Rejected: dropping every agent mention (a real question the agent did not mark as blocked
   would be lost), a daily digest (Helena has none; a new delivery channel for one case).
5. **Always through:** a blocked question (`mark_issue_blocked` → `createComment(…,
   { asksForInput: true })`), approval requests, and failures (Start → "Braucht dich", and the
   `helena.run.failed` push of hub/push) are untouched.

**Agent team.** A routine delegated to a coordinator whose project runs agent teams starts
the team; the coordinator's plan stage is told which agents the fire already started by a
mention (`stagePrompt(…, startedByRoutine)`), so it plans only the rest. Not covered: the
team's own "Result to the task" status change on a reopened routine task still tells that
task's watchers (engine sync, `steps/agent-team.ts`); a created routine task has no watchers,
so this matters only for a reopened task someone follows.

## 3. Where it lives

| Part | File |
|---|---|
| Mention resolution with reasons | `apps/api/src/modules/agents/core/service.ts` (`mentionedAgents`) |
| Starting the agents of a fire | `apps/api/src/modules/routines/mentions.ts`, `engine/builtin/steps/delegate.ts` |
| Which runs are a routine's | `apps/api/src/modules/routines/agent-runs.ts` |
| Routine framing | `apps/api/src/modules/agents/core/prompt/framing.ts`, `run-context.ts` |
| Quiet notifications, daily collapse | `apps/api/src/modules/notifications/service.ts` |
| Save/run guard, preview, list field | `apps/api/src/modules/routines/{service,model,index}.ts` |
| Editor, preview, list line, run parts | `apps/web/src/features/routines/components/RoutineMentions.tsx`, `RoutineDialog.tsx`, `PipelineRunStepItem.tsx` |
