# Native Jev browser integration

Reviewed 2026-09-26. Upstream: [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast/tree/1231850a0bf1a0c0341fe408ef1668dbbfdfac46), pinned at `1231850a0bf1a0c0341fe408ef1668dbbfdfac46`.

## Source audit and selected changes

The complete relevant runtime was inspected: `jev_ultrafast/agent.py`, `browser.py`, `model.py`,
`questions.py`, `snapshot.js`, `tests/test_agent.py`, `scripts/check_guards.py`, `docs/design.md`,
`docs/performance.md` and `LICENSE`. Source was read without executing upstream code or installing
its packages. The MIT notice is retained in `packages/browser-gateway/NOTICE`.

| Upstream mechanism | Helena integration |
| --- | --- |
| Actual DOM node identities and guards captured with observation | `task/page-script.ts` captures field/document state, target semantics and nearby context atomically; `session.ts` retains raw guards privately and compares the original guard, rather than mere node existence. Replaced nodes, changed labels/types/form destinations/options and navigation invalidate the decision. Open shadow roots and frame separation remain supported. |
| Geometry and occlusion immediately before input | After Helena authorization and pointer/scroll preparation, the executor checks the original key/guard and hit target together. A scroll that changes the observation requires another observation before input. |
| One operation request with compatible speculative targets | `task/policy-jev.ts` sends operation and conditional target heads together. Every target head has both next-action and target rules. SELECT choices include native option indices; disabled options/optgroups are excluded. Duplicate option values and labels stay distinct. Only the selected operation consumes its target/value heads. |
| Consume mutations before execution; uncertain outcomes stop | A browser observation can authorize one input. SELECT has no label-to-value retry. Unknown action errors hand back with a recorded attempt; failed subsequent observation preserves completed steps. |
| Text generation restricted to the chosen input | Helena retains its existing outer-agent/caller `values` path. Jev only chooses a supplied value key. No additional text model, API key or runtime is added; login and OTP remain dedicated tools. |
| WAIT and action/request bounds | WAIT re-observes the page and stops after six waits. Existing 1–60 step bounds and `2 * maxSteps + 2` decision limits remain. Helena's human-input settings and loading waits remain intact. |
| Independent completion checks | `success` requires exact final URL, visible text substrings and/or uniquely labelled fields with exact values/checked states. All supplied criteria must pass on a fresh observation before `done`; a failed check hands back. Without criteria, a completion claim ends as `likely_done`, with a snapshot. |

Primary implementation references:
[agent loop](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/agent.py),
[snapshot and guards](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/snapshot.js),
[browser execution](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/browser.py),
[model contract](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/model.py),
[questions](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/questions.py),
[tests](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/tests/test_agent.py),
[local guards](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/scripts/check_guards.py).

## Caller contract

```json
{
  "goal": "Submit the contact form with the supplied name and email",
  "values": { "name": "Ada", "email": "ada@example.test" },
  "success": {
    "url": "https://example.test/thanks",
    "textIncludes": ["Message received"]
  },
  "maxSteps": 12,
  "mode": "act"
}
```

`success` permits only `url`, `textIncludes` and `fields`; each field has a `label` and at least
one of `value` or `checked`. At most ten text criteria and ten fields are accepted. Values match
exactly, text matches case-sensitively with normalized whitespace, and ambiguous labels fail.
Shortened, normalized or redacted field values cannot prove an exact field criterion; the
gateway preserves the existing snapshot limits and fails closed for those values.
No selectors or executable code are accepted. Criteria are evaluated locally; they are not
extra instructions to the decision model. Credential fields cannot serve as field criteria.
The caller must choose criteria that cover the requested outcome. DOM/URL evidence does not
prove server-side persistence, delivery, payment settlement or other external effects.

Existing API `finishTask` accepts `likely_done` as a finished status, the web SDK exposes it,
and the Lab's active predicate only treats `queued`/`running` as active. Legacy calls therefore
terminate without false verified completion. `likely_done` retains a verification label and an
outline badge, while the caller receives a continuation snapshot. `browser_check` is another
model opinion, not independent proof. No database migration is required.

## Boundaries

The gateway continues to use the project's isolated browser and Helena's existing server-side
TypeSafe connection. Read mode, project routing, domain policy, redaction, credential tools,
control ownership and action authorization remain in force. The upstream shared Chrome profile
and separate inspector/demo server are not used. There are no installs, downloads of runtimes,
new credentials, live browser actions or trades in this implementation.

Scoped guards are practical stale-decision checks, not proof that arbitrary website changes
are irrelevant. DOM access, visible-text caps and common HTML/ARIA labels cannot cover every
canvas, closed shadow root or custom widget. Such cases may hand back to the calling agent.

Upstream reports three matched run pairs on one Google Flights task and profile, with median
runtime falling from 9.450 to 7.092 seconds. The small sample has sign-test p=0.25; initial
navigation and final independent checking are excluded. Its helper charge excludes Jev and
browser costs. These results establish neither Helena's speed nor general browser reliability.
See the pinned [performance report](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/docs/performance.md).

## Validation and release acceptance

Offline regressions cover shared speculative rules, selected versus unused malformed heads,
SELECT indices, independent completion, authorization-time staleness, uncertain mutation,
failed post-action observation and bounded WAIT. The existing Jev and Laya suites remain.
Opt-in native Chromium tests use an already installed binary and a private disposable profile:

```sh
TMPDIR="$HOME/agent-work/tmp" HELENA_BROWSER_TEST_EXECUTABLE=/usr/bin/chromium \
  bun test packages/browser-gateway/src
```

The native suite verifies actual node replacement/navigation, context/label/form/type changes,
shadow field insertion, hidden text, height changes, covered SELECT, disabled optgroups,
duplicate option values, one-use decisions, exact field-value evidence and text replacement
without form submission.
It uses local synthetic pages, no model service and no live profile. No live success rate or
latency improvement is claimed. Root integration/full gate, deployment, and a synthetic
end-to-end run through the configured Helena TypeSafe connection remain release acceptance.

Validation recorded before integration: 230 gateway tests passed (836 assertions), including
ten actual Chromium checks and the public `runTaskTool` caller contract; gateway TypeScript,
ESLint and formatting passed. Seven existing web Lab tests and the changed panel's ESLint
check also passed. The release orchestrator runs the combined full gate and live proof.
`deploy.sh` already rebuilds the installed MCP shim and restarts the project browser router when
`packages/browser-gateway` changes; use the existing deployment path after the in-flight check.
