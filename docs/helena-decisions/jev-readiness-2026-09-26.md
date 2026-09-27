# Jev: browser and trading readiness

Reviewed 2026-09-26 against Helena `2a0a0909`. This review uses public primary sources and source code. No TypeSafe key was read, no provider call was made, no model was installed, and no paper order was sent. Changes described here require integration and deployment by the root orchestrator.

## Identity and supported protocol

The provider is **TypeSafe AI**, [typesafe.ai](https://typesafe.ai), with [official documentation](https://docs.typesafe.ai), [console](https://console.typesafe.ai) and [typesafe-ai GitHub organization](https://github.com/typesafe-ai). Similar third-party domains containing “jevtypesafe” are not the configured provider. The official [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript) links to `typesafe-ai/typesafe-sdk-js` at v0.6.0; Helena already has that SDK dependency.

The direct API is `POST https://api.typesafe.ai/v1/systemone`, authenticated with a bearer key. It accepts `model`, `state` and named typed `questions`. Helena's Choice and Noul requests match the documented structure and include explicit instructions. Choice returns a label, per-option probabilities and confidence; Noul returns `P(yes)`. Score exists at the provider but is not needed by Helena's current browser/trading questions. [API specification](https://docs.typesafe.ai/api), [SDK types](https://github.com/typesafe-ai/typesafe-sdk-js/blob/v0.6.0/src/types.ts).

The documented concrete model is `jev-1.13.0`; `jev-latest` is a moving alias. Pin the concrete model for evaluation and retain the response's model ID. It is text-only and does not generate free text. English is the best-supported language; German needs task-specific evaluation. Published limits include a combined 64k request-token budget and 32k for state plus the longest question. Current published input pricing is $0.042/million tokens, output free; this excludes the planning agent, browser runtime and any gateway charges. Recheck service limits and price when activating. [Models](https://docs.typesafe.ai/models).

Provider confidence is a statistic derived from the distribution, separate from the selected option's probability. The docs do not justify calling Helena's normalized-maximum formula the provider's formula. The native browser uses the reported field; generic `decide`/`trading_classify` deliberately uses Helena's `(n * max(p) - 1) / (n - 1)` measure, also for yes/no. Their thresholds must be evaluated separately. [Confidence](https://docs.typesafe.ai/confidence).

TypeSafe explicitly documents weaknesses with arithmetic, exact counts, dates and large irrelevant context. State content can influence the answer adversarially; structured output alone is no injection defense. Keep numerical rules in code and model decisions behind existing action policy. A `done` answer is not independent proof. [Jev 1.13 limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

## Browser compatibility and measured evidence

| Component | Fit in Helena | Evidence and limit |
| --- | --- | --- |
| Native `browser_task` with policy `jev` | Preferred project browser path; server stores key, gateway retains project isolation, lock, redaction, freshness and per-action authorization | Protocol and mocked loop tested; actual TypeSafe quality/latency awaits a configured key |
| `browser-use/jev-ultrafast` | Reference for operation and speculative target questions; a separate text model provides typing text | [Author repository](https://github.com/browser-use/jev-ultrafast); its browser harness and benchmark are not a Helena production test |
| `Ying-Kai-Liao/jev-browser` | Pinned comparison package at `e35ab134f65033d29c528132d92bf06e8d6adcb5`; isolated lab profile, not the project browser | [Author repository](https://github.com/Ying-Kai-Liao/jev-browser); useful observable subgoals/handback contract, author-reported results are not our measurements |
| `@jkudish/jev-browser` MCP preset | Separate third-party integration, not the pinned comparison package | Do not select it as a replacement for native browser control; its `npx` preset can fetch code and launches a separate integration |
| Laya browser v10s | Existing local checkpoint with dedicated `laya` policy | Helena fixture set **10/10**, public set **3/10**, September 24; no implication about Jev |
| Laya browser v17s | Possible future evaluation candidate only | Current [author model card](https://huggingface.co/cklxx/laya-browser) describes v3 input formatting, trained head length and chunking; short tasks improve but long forms remain weak. No update or performance claim for Helena |

The actual stored Laya public run took 75.2 seconds for ten tasks, 36 decisions and 74,712 input tokens, averaging 1,021ms per decision. The local fixture run took 20.3 seconds, 29 decisions, averaging 300ms. Files: `packages/browser-gateway/eval/results/2026-09-24-{local,public}-laya-rules.json`. Earlier `*-all-backends.json` also names `jev-browser@laya`: that is the wrapper running **Laya**, not the TypeSafe service. None of the four committed result files establishes TypeSafe performance.

Use the configured planning agent (owner default `gpt-6-luna`) to formulate goals, provide public typing values and handle ambiguity. Jev is the narrow decision model. Do not replace the planner with Jev or add a second text provider merely because a public demo uses one. Existing individual agent templates can contain model overrides; template sync must preserve deliberate owner choices and report discrepancies.

## Configuration after the owner supplies the key

1. In **Zugänge**, create/select credential kind `decision_model`, backend **Jev (TypeSafe Cloud)**, base URL `https://api.typesafe.ai`, model `jev-1.13.0`. The owner enters the key in that connection. Do not put it in a skill, chat, MCP preset, browser page or eval JSON.
2. Run the connection test. A model-list success confirms reachability/authentication, not browser accuracy. Then execute a minimal public synthetic Choice/Noul probe through Helena and record the returned concrete model.
3. In **Projekt → Einstellungen → Browser → Browser-Steuerung**, choose **Entscheidungsmodell**, that scoped connection and policy **Jev**. Use a dedicated test project first. Existing defaults remain unchanged by this commit.
4. Use **Browser 2.0** on the native project browser for the local/public task matrix below. Keep a budget and record correctness independently of `done`. Browser `minConfidence` currently overrides **target probability**, whereas the generic decision-class threshold is Helena confidence; do not copy numbers between them.
5. For trading, separately choose/evaluate the `helena.trading.news` class in Home → Entscheidungen before enabling it. `helena.trading.rules` and `.routing` have `cloud: never`; a TypeSafe cloud connection must remain refused there. Browser configuration does not turn these classes on.

The generic class gate requires a passing evaluation for its chosen connection. Native browser selection has no equivalent automatic evaluation gate, so the following rollout checks remain explicit. Scope the pilot to public pages: page text, goals and value candidates may leave the server. Redaction is not a guarantee that arbitrary business content is public. No general zero-retention assumption is made.

## Bounded corrections and remaining gaps

| Finding | Result / required action |
| --- | --- |
| Browser substituted `p(choice)` when provider confidence was missing/invalid | Reject malformed Choice answers. Loop regression proves `backend_error` before authorization or any action; valid provider confidence remains unchanged |
| Generic parser silently replaced missing/invalid probabilities with zero and renormalized | Require exactly all offered keys, finite unit probabilities, total within 0.02 of one and a valid maximum-probability choice; only rounding drift is normalized. Preserve existing Helena confidence semantics |
| Eval direct client appended `/v1` twice for a versioned base | Native direct eval client accepts root or `/v1` base, covered by request-URL tests. Configure the documented root for the separate upstream wrapper |
| Confusing metric attribution | SDK comment names Helena's own measure; skills explain the three different signals |
| Public browser quality unknown for TypeSafe | Actual provider pilot remains open until owner key is entered; neither mocks nor Laya results satisfy it |
| API option/context limits | Main target choices are capped at 240 and values at 30. Dropdown option selection can still exceed the provider's 255-option limit. Large pages can exceed token budget despite character/element caps. Failures hand back; test large dropdowns and context before widening pilot |
| Generic news privacy boundary | News class permits cloud and its prompt mentions open positions. Agent skill requires public/minimal context; this is not schema-enforced removal of arbitrary text. Do not submit account/private-position data |
| Local model assumptions | Browser-tuned Laya is not proven for trading rules/routing. Existing local logit/JSON backends need their own German class evals; no model installation is included |

Caller compatibility: `apps/api/src/modules/browser-task/connection.ts` preserves TypeSafe answers and all existing OpenAI adapters produce confidence. `task/run.ts` reports a malformed browser result as `backend_error`. `apps/api/src/modules/decisions/service.ts` catches parser failures and returns an error/fallback outcome; only a valid decided answer is actionable. Full API integration gate remains the root orchestrator's responsibility.

## Trading use and strategy evidence

Jev can sort a public news item by relevance/event, or select a typed tool/role. TypeSafe's [function-calling trading example](https://docs.typesafe.ai/cookbooks/function_calling) is a mapping from text to typed actions; it establishes no predictive market edge. News `direction` in Helena is an assessment label, not a price forecast. Quantitative signals, clocks, sizing and limits must use timestamped data and deterministic code.

The existing three seed versions are `status: entwurf`, with empty backtest/approval fields. They are research candidates:

| Candidate | Preparation priority and unresolved assumptions |
| --- | --- |
| `spy-rsi2` daily mean reversion | Start with a reproducible daily-data baseline. Resolve the mismatch between 15:45 evaluation and daily closing indicators; only data available at decision time may determine the signal. Compare net outcomes with cash and a relevant passive benchmark |
| `orb-spy` 5-minute opening range | Later: pin New York calendar/DST and completed-bar semantics; the code uses IEX data, which can form a different range from consolidated data. Test realistic spreads, delayed fills and no-event-day filters |
| `btc-trend` daily breakout | Research only while crypto execution is blocked. Specify that prior-high/low windows exclude the signal day's close; define completed UTC bars. Protective-exit handling must be implemented and proven first |

The numeric hit-rate expectations written in seed notes are unvalidated assumptions, not measured results. Select no “best” strategy from them. Pre-register rules and cost assumptions; keep chronological walk-forward periods and a final untouched period, record every parameter trial, evaluate instability across regimes and report drawdowns/uncertainty. Multiple trials can produce convincing false positives; [Bailey et al., The Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf) motivates tracking the whole search. These checks do not prove future returns.

Alpaca paper fills are simulated and omit important real execution effects; paper-only accounts use IEX market data. A successful paper run proves aspects of behavior and accounting, not a transferable return. [Alpaca paper specification](https://docs.alpaca.markets/us/docs/paper-trading). This work does not authorize live trading.

### Execution blockers found in the reviewed base

`packages/trading/src/alpaca/checks.ts` computes limits from filled positions and a count of today's orders. `tools.ts` submits after fresh reads, without an account-wide reservation/transaction around check plus submit. Pending buys can therefore evade position value/slot limits; pending or concurrent sells can reuse the same held quantity. Crypto entries carry no attached stop: the response only tells the agent to place a separate stop-limit order after fill. `strategyId`/`strategyVersion` are validated strings and journal metadata in this handler; an independent server-side approval/version check is not present here. The price read also needs explicit staleness handling for operational readiness.

These are blockers for unattended new entries and are assigned to a separate trading-safety implementation. Keep new entries halted and crypto disabled while account/market-data read-only proof proceeds. A key and a successful account response do not close these blockers.

## Agent skills and rollout checks

The bundle includes two local skills without new external dependencies. `helena-browser-decisions` is assigned to Browser-Operator, Markt-Research, Chart, Krypto and Daytrading preparation. `helena-trading-decisions` is assigned to all nine trading specialists and the blueprint coordinator. Existing research, risk, backtest, strategy-labor, paper execution and journal skills remain their role-specific foundation. Assignment does not add browser/tool permission; Paper-Trader keeps browser and arbitrary networking disabled. The TypeSafe [skill-suggestion cookbook](https://docs.typesafe.ai/cookbooks/skill_suggestion) is an optional future shortlist/recheck pattern, not implemented permission or skill installation.

Required evidence before marking the integration ready:

- [x] Official identity, endpoint, SDK, Choice/Noul and confidence semantics inspected.
- [x] Malformed responses rejected with offline regressions; existing valid native loops and adapters remain covered.
- [x] Local skills packaged and assigned to appropriate templates; no model or key activated.
- [ ] Root integration/full test, deploy and template-sync preview; report any customized-template drift.
- [ ] Owner key stored; direct TypeSafe probe records exact model, usage and latency.
- [ ] Native browser pilot: English and German search; one-field form on a synthetic page; dropdown; repeated labels; navigation race; no-results; false-done; missing value; login/captcha handback; budget exhaustion; injected page instructions; read-only refusal; unauthorized project/domain. Zero unintended side effects and zero false success reports in the acceptance set; report actual coverage and failures.
- [ ] Compare identical tasks against ordinary step tools and local Laya separately, with end-to-end time, decision-call time, tokens, handback rate and ground truth. Provider claims are not acceptance results.
- [ ] Trading news evaluation on held-out German public examples, including negation, stale/repeated news, conflicting reports and injected instructions; class precision/coverage thresholds met. Private classes reject cloud.
- [ ] Deterministic order reservations, concurrent/retry behavior, strategy version gate, exits and stale-data handling pass independent tests and operational proof. Read-only broker proof is recorded separately from order readiness.
- [ ] A chosen draft strategy has reproducible data, chronological tests, costs, versioned authorization and sufficient paper observations under the repaired gates. No current profitability claim.

Validation of this preparation: Kingston isolated copy reused existing dependencies; browser-gateway, decisions, trading decision definitions and bundle suites **238 passed, 0 failed**. Browser-gateway, decisions and SDK typechecks passed, as did targeted ESLint, Prettier and `git diff --check`. The skill creator's Python validator was unavailable because PyYAML is absent; Bun's YAML parser checked both frontmatters and the repository bundle validator checked packaging and references. No database, shared full-test script or live service was used. API integration, deployment and live evidence remain with the root orchestrator.
