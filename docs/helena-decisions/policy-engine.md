# Decision: the policy engine (Autopilot) and the model price table

Status: decided 2026-09-24 (package E "Autopilot-Regler + Budgets", branch `hub/autopilot`).

## What has to be decided

Helena needs ONE place that answers "may this agent do this kind of thing here?" for every
tool call, connector, workflow step and runtime (Hermes, Claude Code, Codex, the browser
gateway, Helena's own MCP tools). The answer has three values, not two:

- `allow`: go ahead;
- `needs-approval`: a person has to approve this exact action first;
- `deny`: not at all (for example the budget is used up),

each with a reason a person can read on the approval card. The inputs are the project's
Autopilot level (0 Vorschlagen, 1 Mit Freigabe, 2 Handeln & berichten, 3 Autonom im Budget),
an optional per-agent level, the action category (read, report, write, send, delete, pay,
publish, execute, credentials), where the action lands (inside the agent's workspace or
outside) and whether a budget is used up. Plugins must be able to add rules later (§3a
"Richtlinien"). It runs in-process: no extra service besides Postgres and Hermes (§3b.3).

Second question: where the € prices per model come from.

## Options compared (policy)

| | Cedar (`@cedar-policy/cedar-wasm`) | CASL (`@casl/ability`) | Small table-driven evaluator |
|---|---|---|---|
| License | Apache-2.0 | MIT | ours |
| Maturity / care | AWS-backed language with a formal spec and verified implementation; used by Amazon Verified Permissions; 4.13.0 released 2026-09-15, releases every few weeks | Stable, widely used (v7), mostly for UI/ORM permission checks | none needed, but everything is ours |
| Runs where | in-process WebAssembly (nodejs target, 4.3 MB wasm); measured in Bun: 0.14 ms per decision including parsing the policy set | in-process JS (180 KB), also in the browser | in-process |
| Rules as | a policy language (text), validated against a schema; `permit`/`forbid` with `when`/`unless`, annotations | JS code or JSON rules with MongoDB-style conditions | a TS table |
| Explains a decision | yes: the ids of the determining policies | the matching rule (and `because()` text for inverted rules) | whatever we code |
| Three values | two evaluations (without / with `context.approved`) | two `can()` checks | native |
| Extension by plugins | a plugin ships policy text; the engine adds it to the set; schema validation catches mistakes | a plugin ships JS rules (code) | a plugin would have to patch the table or we invent a format |
| Owner-written rules later ("never send from FAM after 22:00") | text, no code change | code | code |

Also looked at and dropped:
- OPA/Rego: the wasm path needs the `opa` binary to compile policies (system binary, extra
  build step); the server mode is a second service.
- Casbin (node-casbin, Apache-2.0): model + CSV policies fit RBAC/ABAC lookups, not a
  level × category matrix with conditions; weaker explanations.
- Cerbos, OpenFGA, Oso Cloud, Permit.io: separate servers or hosted services (§3b.3). The
  open-source Oso/Polar library is deprecated.

## Decision (policy)

**Cedar via `@cedar-policy/cedar-wasm` (nodejs target), as a thin layer.**

- The level matrix, the hard blocks and the budget stop are a Cedar policy set with a Cedar
  schema, kept as text in `packages/policy` (`@helena/policy`). Each policy has an id and a
  `@reason` annotation; the engine turns the determining policy ids into the reason shown
  on approval cards and in the audit log.
- `decide(agent, project, category, context)` evaluates twice: once as the action is
  (`context.approved = false`); if Cedar denies, once more as if a person had approved it.
  Allowed the first time → `allow`; only the second time → `needs-approval`; never →
  `deny`.
- The engine's facts (effective level and its source, scope, budget state) are computed in
  TypeScript from the database and passed as Cedar context; Cedar decides. Nothing about the
  matrix is written twice: the UI's plain-language summary ("Agenten in diesem Projekt
  dürfen …") asks the engine for each category instead of keeping its own table.
- The evaluator sits behind a `PolicyEvaluator` interface (`decide(request) → decision`),
  shaped to move into `@helena/sdk` as the "Richtlinien" extension point once hub/framework
  publishes it. A plugin contributes policies as Cedar text; they are validated against the
  schema when loaded.

Why not CASL: it is simpler to call, but it has no policy language, so rules from plugins or
from the owner would be JavaScript, and its natural home is UI permission checks. Why not
our own table: the owner's rule is "Standards statt Eigenbau"; the table would grow into a
home-made policy language the moment the first plugin needs a condition.

## Action categories from MCP tool annotations

Every agent tool is (or becomes) an MCP tool, so the category is derived from the MCP tool
annotations first (MCP spec 2025-06-18, `ToolAnnotations`), and only refined where a hint is
too coarse:

1. an explicit category the tool's owner declared (Helena routes: `mcpTool(name, annotations,
   { category })`; the browser gateway and plugins: their own tool table) wins;
2. `readOnlyHint: true` → `read`;
3. `destructiveHint: true` → `delete`;
4. `openWorldHint` not `false` (the MCP default is `true`) → `send`: the tool reaches
   something outside Helena;
5. otherwise → `write`.

An unannotated third-party tool therefore counts as `send` (the spec's own defaults say "may
be destructive, open world"), which needs approval below level 3. Hermes keeps each MCP
tool's `readOnlyHint` from discovery (`tools/mcp_tool.py`), which the approval guard passes
on. Shell commands have no annotations; the engine classifies them (`publish` for `git push`,
`npm publish` and the like, `delete` for removals, `execute` for what Hermes' own dangerous-
command detection flags, `write` for the rest) and decides the scope from the paths they touch.
`idempotentHint` does not change the category.

## Prices: models.dev

| | models.dev (`https://models.dev/api.json`) | LiteLLM `model_prices_and_context_window.json` | by hand |
|---|---|---|---|
| License | MIT | MIT | — |
| Format | per provider and model: USD per 1M tokens for input, output, cache read, cache write, plus context tiers | USD per token, many keys per model | — |
| Coverage of our catalog | 24 of 29 catalog models (all Claude 4.5+ and GPT-5.x/6 base ids) | similar, lags on new models | whatever we type |
| Already used here | Hermes caches it in `$HERMES_HOME/models_dev_cache.json`; opencode uses it | no | — |

**Decision: models.dev.** Helena seeds the price table from a snapshot of models.dev that
ships in the repo (`packages/policy/src/prices/models-dev-snapshot.json`, only the providers
the runners offer), so a fresh install has prices without network access. Administrator →
Modellpreise shows the table, lets the owner edit any row (a manual row is never overwritten)
and offers "Von models.dev aktualisieren", which fetches the current `api.json` server-side
and updates every row that is not manual. Prices are converted from USD with an exchange rate
the owner sets in the same place (default 0.86 € per $) and are always labelled as estimates.
Model ids are matched exactly, then with dots as dashes (`claude-fable-5.1` →
`claude-fable-5-1`), then without a `-900k`-style context suffix (priced at the long-context
tier when models.dev has one).

Rejected: the LiteLLM list (per-token floats, lags on new models, not what Hermes uses); a
hand-kept table (goes stale; the owner asked for a standard source).
