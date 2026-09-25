# Trading: research, analysis, backtests and paper trading (project TRADE)

Decision, 2026-09-26, branch `hub/trading`. The owner's requests, verbatim:

- 2026-09-25 ~23:55: "Kannst du ein Trading-Projekt anlegen für Aktien, Krypto und Daytrading mit passendem Skill-Set (gerne Recherche) und allem Weiteren anlegen und auch eine Orga mit Zielen und alles aufbauen."
- ~00:05: "Ein Agent soll bei einem geeigneten Broker ein Demokonto anlegen und das Trading mal starten. Macht Jev für schnelle Entscheidungen Sinn?"
- ~00:10: "Richte eine Strategie-Entwicklung ein, die sich selbst verbessert – Hermes-Fähigkeiten dafür nutzen, und Second Brain, Files, Docs, Obsidian extrem gut verknüpfen."

## 0. Kurzfassung (für den Owner)

- **Kein Echtgeld, by construction.** Agents research, analyse, backtest, keep the journal and trade **only in an Alpaca paper account**. One agent (Paper-Trader TRADE) places paper orders, and only through Helena's own paper tools. Those tools know only Alpaca's paper hosts, refuse live keys (paper keys start with `PK`) and check **your hard limits before every order**: order value, position value, risk down to the stop, daily loss, open positions and orders per day. You set the limits yourself, in the same form as the keys.
- **Every other way to place an order is blocked twice.** First, any order tool of another MCP server, and any command or code that names a broker's or exchange's trading API, counts as `pay`, which only you can approve. Second, the project's network refuses the live trading hosts of 50+ brokers and exchanges. The Paper-Trader itself has no internet at all: it reaches only Helena.
- **You open the demo account yourself.** Alpaca paper accounts are open to German residents with only an email and need no deposit. You then store the paper keys under Integrationen → "Alpaca Paper-Trading (Spielgeld)"; no agent signs up anywhere.
- **Jev-style decisions:** yes for fast sorting, never as a trading signal. Three decision classes answer through the local Qwen3.6 in about 0.5–3 s:
  - sort news: relevance, direction, kind
  - check one written rule against a planned trade
  - route a task to the right role

  Each stays off until its eval passes.
- **The project is a blueprint.** One command sets it up:
  - project TRADE in "Familie & Privat", 6 areas, a coordinator and 9 specialists, and project instructions
  - an Obsidian-linked knowledge structure with 9 note templates, the "Strategie-Labor" board and 7 goals
  - 11 routines, all **switched off**, for you to turn on
- **The Strategie-Labor improves itself:** idea → versioned strategy → backtest (Gate B) → your approval (Gate C) → paper → journal → review → new version or retire. Lessons become memory proposals you confirm; recurring steps become learned skills you adopt.
- **Your part:** see §11. Open the Alpaca paper account and store the keys, set the limits, confirm the Regelwerk, and approve the Python installs for backtests.

## 1. Guardrails (binding; they are in the project instructions, every template and the skill `trading-grundregeln`)

1. Agents never place, modify or cancel orders, move funds or trade with real money. The only exception is the Paper-Trader, and only in the paper account, only through `alpaca_paper_*`.
2. No broker or exchange credential with trading or withdrawal rights anywhere in Helena. The paper keys are paper keys; any other key a source needs is read-only and added by the owner.
3. Output is analysis with sources, assumptions, risks and uncertainty. Every analysis, strategy, backtest and review note ends with "Hinweis: Keine Anlageberatung. … Entscheidungen und Risiko liegen beim Owner."
4. German tax context is documentation help only; open questions go to the Steuerberater.
5. Strategies only from the written rule book (Regelwerk) and only after a passed backtest and the owner's approval. Start small, with one simple documented strategy per market.
6. The emergency stop (Not-Aus) and the connection's "Handel angehalten" stop new entries.

## 2. Research

The full research notes, with every source, are in the agent report of 2026-09-26. The summary follows.

### 2.1 Skills (Agent Skills, pinned to a commit; Helena imports only SKILL.md and Markdown)

**Adopted (21 new pins):**

| Repo @ commit | Skills | License |
|---|---|---|
| tradermonty/claude-trading-skills @ `28503f67265b9e57a40175b8ded222cd9271deac` (2.9k★, active) | backtest-expert, edge-strategy-reviewer, technical-analyst, us-stock-analysis, market-news-analyst, trade-performance-coach | MIT |
| agiprolabs/claude-trading-skills @ `981e1d736cdc02bdc1c55c74ec9224e956414706` (already pinned in the pool) | walk-forward-validation, ta-lib, token-economics, position-sizing, exit-strategies, ohlcv-processing | MIT |
| JoelLewis/finance_skills @ `5c498eacf7057e31238c4c5a8012a1afe9ec7c8a` | financial-statements, digital-assets | MIT |
| himself65/finance-skills @ `7fe91853b536304b13bce210ecf8b685cf77ec48` | company-valuation | MIT |
| anthropics/financial-services @ `574ed3624aebd0418c7e96cd101262f30210ab26` | morning-note, catalyst-calendar, earnings-preview, thesis-tracker | Apache-2.0 |

The pool already had: portfolio-analytics, risk-management, correlation-analysis, regime-detection, volatility-modeling, trade-journal (agiprolabs); statistical-analysis, explore-data, data-visualization (Anthropic); pre-mortem, recherche-bericht, fact-check-workflow, search-strategy.

**Rejected:**

| Skill | Why rejected |
|---|---|
| pre-trade-discipline-gate, drawdown-circuit-breaker | Built around their own JSON artifacts and scripts, which Helena drops. Helena's hard checks and the German skills below cover them. |
| comps-analysis | Built on FactSet/Daloopa MCPs. |
| alpaca `paper-trading` | Built around the Alpaca CLI/MCP and host env. Helena's paper tools replace it. |
| agiprolabs `vectorbt` | Library under the Commons Clause. |
| agiprolabs `pandas-ta` | Upstream is gone. |
| agiprolabs `strategy-framework` | Has a "Small Live → Scale" step. |
| execution, MEV, DEX, prediction-market skills; US tax skills | Out of scope. |
| script-driven screeners and calendars | Need an FMP key. |

**Written in German (13, in `bundles/agent-pool/skills/`):**

| Skill | What it covers |
|---|---|
| trading-grundregeln | the guardrails above |
| trading-wissen-verknuepfen | vault structure, front matter, wikilinks, no orphans, files as attachments, board |
| marktrecherche-und-news | DE/EU primary sources, ad-hoc disclosures, keyless economic calendar, `trading_classify`; `refs/quellen.md` |
| technische-analyse | reproducible, multi-timeframe, zones, ATR, scenarios |
| krypto-analyse | keyless on-chain, tokenomics, custody/exchange risk, MiCA; never wallets |
| premarket-briefing | XETRA/US times in CET including the DST weeks, calendar, gaps, allowed setups only |
| regelwerk-und-positionsgroesse | size formula, reconciliation with the connection's limits, changes only with approval |
| trade-journal-fuehren | one entry per order, clientOrderId reconciliation |
| performance-review | metrics vs. backtest, lessons → memory/skill proposals, goal notes |
| backtest-methodik | IS/OOS, walk-forward, costs, Gate B, attachments |
| strategie-labor | the loop, statuses, gates, versions, retire criteria |
| paper-trading-ausfuehrung | the Paper-Trader's checklist |
| kapitalertraege-dokumentieren | documentation only |

### 2.2 Data sources and MCP servers

| Source | Key | Free tier | Can trade? | Verdict |
|---|---|---|---|---|
| Alpaca Market Data (`data.alpaca.markets`, through `alpaca_paper_market`/`_bars`) | paper keys | 200 req/min, IEX feed | no (data host) | **start** |
| SEC EDGAR | no | ≤ 10 req/s, User-Agent | no | **start** |
| ECB Data Portal, Bundesbank | no | free | no | **start** |
| Forex Factory weekly JSON | no | ≤ 2 per 5 min (we: daily) | no | **start** (unofficial) |
| CoinGecko (API or remote MCP `mcp.api.coingecko.com`, Apache-2.0) | optional | public tier | no | **start** (attribution) |
| yfinance / Yahoo | no | undocumented | no | personal research only (Yahoo terms); never an OSS default |
| Finnhub | yes | 60/min | no | owner's choice |
| FRED | yes | free | no | owner's choice |
| Alpha Vantage | yes | 25/day | no | not worth it |
| Stooq | yes since 2026-04 (captcha) | – | no | skip |
| Polygon (now Massive), Twelve Data, EODHD, FMP | yes | small | no | later, if needed |
| alpaca-mcp-server 2.3.2 (MIT) | yes | – | **yes** (`place_*_order`, `close_*`, `cancel_*`; `ALPACA_PAPER_TRADE=false` switches to live) | **rejected** (§4.2) |
| CCXT MCP 0.1.3 (MIT) | – | – | yes (sandbox/live flags) | rejected for now |
| OpenBB MCP (AGPL-3.0) | per provider | – | no | heavy; later, if needed |
| yfmcp 0.14.0 (MIT) | no | – | no | possible for the researcher (personal use); needs a `uvx` download → owner OK |

### 2.3 Paper trading for a German resident

- **Alpaca paper:** "Anyone globally can create an Alpaca Paper Only Account" with an email. No funding.
  - Paper REST and trade stream: `paper-api.alpaca.markets`; live: `api.alpaca.markets`. Paper is separable by hostname.
  - Market data: `data.alpaca.markets` (shared, read-only).
  - Keys: paper `PK…`, live `AK…` (community-documented; the wrong environment answers 401 anyway).
  - Starts at $100k. There is no reset; a new account is a new key.
  - US stocks/ETFs, options and crypto. Whether crypto paper works for non-US residents is **unverified**, so the owner checks it on signup.
  - Paper-only accounts get the IEX feed only.
- **Binance Spot Testnet:** `testnet.binance.vision`, GitHub login, no Binance account. Hostname-separable, so possible later as a second connector. Binance stopped EU spot services in July 2026 (MiCA).
- **Excluded**, because paper and live share a host: OKX demo (same REST host plus a header), Interactive Brokers (same Web API host), Saxo. Kraken is futures demo only. Bybit demo keys come from a live account.

### 2.4 Python for backtests (installs need the owner's OK)

**Minimal stack, one uv venv:**
- pandas, numpy, statsmodels, scikit-learn (BSD)
- pandas-ta-classic (MIT) or TA-Lib (BSD)
- backtesting.py (AGPL-3.0; run as an external tool)
- bt (MIT), quantstats (Apache-2.0)
- data: yfinance, ccxt (public endpoints only), alpaca-py (Apache-2.0)

**Not used:**
- vectorbt (Apache-2.0 + Commons Clause)
- vectorbt PRO (proprietary)
- freqtrade (GPL-3.0, a live bot) and backtrader (GPL-3.0, stale), which are external only

Nothing is installed by this branch; the quant agent reports a missing package.

### 2.5 Tax context (documentation help only; values checked 2026-09)

- **Abgeltungsteuer:** 25 % + Soli (26.375 %).
- **Sparer-Pauschbetrag:** €1,000 / €2,000.
- **Loss pots:** share losses only against share gains. The Termingeschäfte cap was abolished by the JStG 2024.
- **Crypto (§ 23 EStG):** tax-free after more than one year of holding; FIFO; **Freigrenze €1,000 from 2024**; BMF-Schreiben 06.03.2025 (records to keep); DAC8 reporting from 2026.
- **Paper trades have no tax effect.**

## 3. What Helena already gives

| Area | What exists |
|---|---|
| Browser | project browser (research on sites), gateway categories |
| Knowledge vault | Obsidian-compatible, git-versioned; `write_note`, `search_knowledge`, `backlinks`; templates in `Templates/`; JSON Canvas boards |
| Attachments | `Projects/<KEY>/Files/Tasks/<KEY>-n/` |
| Routines | cron with IANA time zones; America/New_York follows the US session over DST |
| Goals | organisation goals. hub/agent-context adds goal tools (`list_goals`, `get_goal`, `add_goal_note`, `link_issue_to_goal`), goals in SOUL.md, and a reflection after chats. |
| Decisions service | `decide()`, eval gate, local Qwen3.6 logit readout |
| Autopilot | Cedar policy; `pay` is a hard block |
| Egress proxy | per-project deny lists and per-agent modes |
| Emergency stop | Not-Aus |
| Memory approval | on by default |
| Reflection and learned skills | exists |
| Agent pool bundle | import in the UI |
| Tool integrations | credential forms in the UI and the configured-tool picker on the agent. Configured tools had **no execution path for Hermes agents** before this branch (§4.1). |

## 4. Architecture

### 4.1 Extension points (framework §3a)

| Point | Built here | First extension |
|---|---|---|
| **Project blueprints** ("Projekt-Vorlagen als Dateien") | `@helena/sdk` `blueprints.ts` (types, validation), `@helena/sdk/blueprints` (directory form), `apps/api/src/modules/project-blueprints` (pure planner, state, applier), script `apps/api/src/scripts/project-blueprint.ts` | `blueprints/trading` |
| **Configured tools reach agents** | `apps/api/src/modules/agents/tools/run.ts`, wired into `mcp/server.ts`. A connector tool bound to a credential and enabled on an agent is listed and run over Helena's MCP endpoint. The call goes through the policy host; everything but reading stops while the emergency stop is on; it runs with the bound credential, which the agent never sees, and is audited in `integration_credential_use`. This works for every integration (Jina, Notion …), not only trading; none was configured live, so nothing changes for existing agents. | `alpaca_paper` |
| **Connector (SDK)** | `@helena/trading`: `alpacaPaperConnector()` with localized credential fields; the integration catalog now resolves labels in the reader's language | internal plugin `helena.trading` |
| **Decision classes** | three classes, registered by `helena.trading`; the agent tool `trading_classify` (route `POST /projects/:key/trading/classify`) | §6 |
| **Policy classification** | `@helena/policy` `trading.ts`: `LIVE_TRADING_HOSTS`, `isOrderToolName`, `mentionsLiveTradingHost`, used by `classifyToolCall`/`classifyShell` | order tools and live hosts → `pay` |

### 4.2 Why Helena's own paper connector, not alpaca-mcp-server with env vars (hub/agent-env)

- **Hard limits need state and have to sit where the order leaves.** Helena checks them in code against a fresh account read before every order. An MCP server in the agent's sandbox can only be limited by what the model is told.
- **Live has to be impossible.** alpaca-mcp-server switches to the live host with one env var and ships `close_all_positions`, `exercise_options_position` and `update_account_config`. Helena's client builds only paper URLs, re-checks every URL before the request (`assertPaperUrl`), refuses redirects and refuses non-`PK` keys.
- **The key stays out of reach.** It is encrypted in `integration_credential` and used by the API. hub/agent-env's delivery of credentials as environment variables is not needed for trading, and agents never see the paper key.
- **No download at run time.** alpaca-mcp-server would be a `uvx` download at every start.
- **One audit trail, and Not-Aus applies.**

### 4.3 Defence in depth: paper only, no live trading

| Layer | What it stops |
|---|---|
| Paper client (`@helena/trading`) | any host but `paper-api.alpaca.markets` / `data.alpaca.markets`; non-`PK` keys; redirects |
| Pre-trade checks (`checkOrder`) | orders over the owner's limits; entries after the daily loss limit; entries without a stop; shorts; unapproved symbols; crypto if off; "Handel angehalten" |
| Configured-tool path | agents without the binding (only the Paper-Trader has the order tools); Not-Aus; the Autopilot's decision |
| Policy classification | order tools of any other MCP server; shell commands and code naming a live trading API → `pay` (hard block) |
| Egress (TRADE project) | 51 live trading hosts denied for every TRADE agent; the Paper-Trader in mode `blocked` (Helena, gateway and model only) |
| Paper-Trader template | toolsets `terminal`, `code_execution`, `browser`, `web`, `x_search`, `connections`, `video*` denied |
| Instructions and skills | the rules in words; every refusal reported, never worked around |

## 5. The paper tools (`alpaca_paper_*`, connector `alpaca_paper`)

| Tool | Category | Purpose |
|---|---|---|
| `alpaca_paper_account` | read | equity, cash, day P&L, the owner's limits, orders today |
| `alpaca_paper_positions` | read | open positions |
| `alpaca_paper_orders` | read | orders; `clientOrderId` = `helena-<strategy>-v<version>-<time>` links each to its strategy version |
| `alpaca_paper_market` | read | latest prices (IEX / Alpaca crypto) and the market clock |
| `alpaca_paper_bars` | read | OHLCV bars |
| `alpaca_paper_check_order` | read | the hard checks without placing |
| `alpaca_paper_submit_order` | write | checks, then places; stock entries carry their stop (OTO) and target (bracket); requires `strategyId`, `strategyVersion`, `rationale`; returns a ready journal entry |
| `alpaca_paper_cancel_order` | write | cancel |
| `alpaca_paper_close_position` | write | close; allowed after the daily limit and while entries are halted |

- **Why `write`:** a paper account moves no money. At autopilot level 1 the Paper-Trader acts without an approval card, while the checks above hold.
- **The connection's fields:**
  - paper key ID and secret
  - max order value, max position value, max risk per trade and daily loss limit (all required; a missing one blocks every entry)
  - max open positions (default 5) and max orders per day (default 20)
  - allowed symbols, allow crypto, "Handel angehalten"
- **Crypto stops:** Alpaca attaches no stop to crypto orders, so the tool reminds the agent to place a `stop_limit` sell once the buy is filled.

## 6. Decision classes (Jev-style `decide`, local Qwen3.6)

| Class | Questions | Threshold | Input | Eval (cases, pass rule) |
|---|---|---|---|---|
| `helena.trading.news` "Trading: Nachrichten einordnen" | relevance (high/medium/low/none), direction (positive/negative/neutral/mixed), event (earnings/macro/regulation/corporate/crypto/other) | 0.7 | cloud allowed | 24, precision ≥ 0.85, coverage ≥ 0.5 |
| `helena.trading.rules` "Trading: Regel prüfen" | "Does the planned trade satisfy this rule? Rule: …" (yes/no) | 0.85 | local only | 24 (12 yes / 12 no), precision ≥ 0.9, coverage ≥ 0.5 |
| `helena.trading.routing` "Trading: Aufgabe zuordnen" | role (10 roles of the team) | 0.7 | local only | 24, every role at least once, precision ≥ 0.85, coverage ≥ 0.5 |

- **For sorting only:** never an entry or exit signal. The hard limits are code, not a decision.
- **Off by default:** a class can only be switched on once its eval passed on the chosen connection (Home → Entscheidungen → Auswerten on "Lokale KI auf diesem Server").
- **Not measured yet:** the rule check includes arithmetic (risk-reward, 1 % of the account). If the logit readout fails those, the gate keeps the class off.
- **Tool:** `trading_classify` (kind `news` | `rule` | `routing`) asks the class's own questions, so what agents ask is what the eval measured.

## 7. Project blueprints (the extension point)

- **Format:** `helena.project-blueprint`, version 1. The directory form:
  - `helena.blueprint.json`
  - `instructions.md` (≤ 4000 characters)
  - `knowledge/**.md`, placed under `Projects/<KEY>/`
  - `templates/**.md`, placed under `Templates/`
  - `boards/*.json`: stickers and arrows, written as JSON Canvas
- **It describes:** project and department, areas, coordinator text, skills and assignment, agents (template copies with assignment, extra skills, network mode, project browser, tool bindings), network allow/deny, goals and routines.
- **Never:** ids, people or secrets.
- **Applying** (`project-blueprint.ts`):
  - It is a dry run by default. The sections are `project`, `areas`, `agents`, `network`, `knowledge`, `goals`, `routines`, `tools` and `report`; `tools` runs only on request, once the owner's credential exists.
  - It writes only through Helena's services: `createProject` (the coordinator, provisioning job and default states come with it), `createViewFolder`, `copyTemplateIntoProject`, `setAgentSkills`, `setAgentProjectInstructions`, `setAgentAssignment`, `enableProjectBrowser`, `setAgentNetwork`, `writeNote`, `createBoardFile` + `createNoteBoard`, `createGoal`, `createRoutine(enabled: false)`, `createAgentTool` + `setAgentTools`.
  - It never touches a Hermes home.
- **Idempotent:**
  - It adds only what is missing and never overwrites a text someone wrote. The coordinator's text is replaced only while it is still Helena's generated default.
  - It never sets the network mode of a project that has settings, and never a per-agent mode set by hand.
  - Routines carry a stable UUID key derived from the blueprint and key.
  - A missing template is a **blocker** ("import the pool first").
  - A second run plans 0 changes (tested).
- **Later:** an API route and a UI entry ("Projekt aus Paket anlegen"), and blueprints offered by plugins, like bundles.

## 8. The TRADE setup (blueprints/trading)

**Project, department and areas:**
- Project `TRADE` "Trading" in the department "Familie & Privat" (id 2 live), with the project instructions from `instructions.md`: guardrails, where things live, data sources, working rules, approvals and the team.
- Areas (folder): Aktien (`aktien`), Krypto (`krypto`), Daytrading (`daytrading`), Research (`research`), Strategie-Labor (`strategie-labor`), Journal & Risiko (`journal-risiko`).

**The team** (copies of pool templates, all reporting to the coordinator, who reports to Home):

| Handle | Template (model, effort) | Skills (own + pinned) | Paper tools | Network |
|---|---|---|---|---|
| `@hermes-trade-coordinator` | created with the project (runtime default) | + trading-grundregeln, trading-wissen-verknuepfen, strategie-labor, ziele-in-aufgaben-zerlegen, dispatching-parallel-agents, writing-plans, verification-before-completion | – | open |
| `@trading-researcher-trade` "Markt-Research TRADE" | trading-researcher (claude-sonnet-5, medium) | 13: news, fundamentals, valuation, earnings, catalysts, thesis, research | – | open + project browser |
| `@chart-analyst-trade` | chart-analyst (claude-sonnet-5, medium) | 9: technical analysis, TA-Lib, regime, volatility, correlation, exits | market, bars | open + browser |
| `@crypto-analyst-trade` | crypto-analyst (claude-sonnet-5, medium) | 8: crypto, tokenomics, digital assets, regime | – | open + browser |
| `@daytrading-prep-trade` | daytrading-prep (gpt-5.6-luna, medium) | 7: pre-market, morning note, catalysts, TA, rule book | market, bars | open + browser |
| `@risk-journal-trade` "Risiko & Journal TRADE" | risk-journal (claude-sonnet-5, medium) | 11: rule book, journal, review, coach, risk, sizing, portfolio, lab | account, positions, orders (read) | open |
| `@quant-backtester-trade` | quant-backtester (gpt-6-luna, medium, 150 turns, 90 min) | 11: backtest method, walk-forward, OHLCV, statistics, charts, lab | market, bars | open |
| `@strategy-developer-trade` | strategy-developer (claude-opus-5, medium) | 8: lab, edge reviewer, backtest expert, pre-mortem, rule book, exits | – | open |
| `@paper-trader-trade` "Paper-Trader TRADE" | paper-trader (gpt-6-luna, medium) | 6: paper execution, journal, rule book, verification | **all 9** | **blocked** |
| `@finance-trade` "Finanzen & Belege TRADE" | finance (claude-sonnet-5, medium) | + kapitalertraege-dokumentieren (added to the template) | – | open (template denies browser) |

- **Models:**
  - Routine briefs run on gpt-5.6-luna, the cheap model that is verified to work.
  - Analysis runs on claude-sonnet-5, the pool's standard.
  - Backtests and the Paper-Trader run on gpt-6-luna, verified to work.
  - Strategy design runs on claude-opus-5.
  - `copyTemplateIntoProject` falls back to the runtime default where the provider refused a model for this account.
- **Memory approval** stays on for all agents (default); the planner reports any agent where it is off.
- **Triggers:** mention and assign are on for every copy, so delegation starts runs.

**Knowledge** (`Projects/TRADE/Docs/`):
- `Trading-Start` (the map of content), `Regelwerk` (draft with proposed numbers for the owner), `Strategie-Labor`, `Datenquellen`.
- Overviews: `Strategien/Trading-Strategien`, `Backtests/Trading-Backtests`, `Journal/Trading-Journal`, `Berichte/Trading-Berichte`, `Reviews/Trading-Reviews`, `Research/Trading-Research`, `Märkte/Trading-Watchlist`, `Steuern/Kapitalerträge 2026`.
- Three starter strategies, one per market, as drafts (status `entwurf`, untested hypotheses with explicit rules, parameters and a pre-mortem): `orb-spy v1.0` (opening-range breakout in SPY, day trading), `spy-rsi2 v1.0` (RSI(2) pullback in SPY above the 200-day average, swing) and `btc-trend v1.0` (Donchian trend following in BTC/USD, daily). Each has an index note. They go to the backtest first; nothing trades before Gate B and the owner's approval.
- Note names are unique across the vault, so a `[[link]]` hits exactly one note. Tests check that every link resolves and that no note is an orphan.

**Templates** (`Templates/Trading/`, used by Helena's "Aus Vorlage" and by Obsidian): Analyse, Strategie, Backtest, Trade, Tagesbericht, Wochenreview, Monatsreview, Pre-Market-Briefing, Watchlist. Each has front matter with `typ`, and the analysing ones carry the no-advice line.

**Board:** "Strategie-Labor" (a public JSON Canvas under `Projects/TRADE/Boards/`): idea → strategy → backtest → approval → paper → journal → review → improvement, plus "Pausieren/Ausmustern" and "Regelwerk". The stickers link to the notes.

**Goals** (project TRADE, department "Familie & Privat", all active):

| Goal | Target date |
|---|---|
| Trading-Regelwerk schriftlich festlegen (Risiko pro Trade, Tagesverlustgrenze) | – |
| Datenquellen und Watchlists einrichten | – |
| Paper-Trading-Konto mit festen Grenzen anbinden | – |
| Keine Strategie ohne bestandenen Backtest ins Paper-Trading | – |
| Strategie-Labor: erste Strategie durch Backtest und 4 Wochen Paper-Trading | 2026-12-31 |
| Trade-Journal lückenlos führen, Wochenreview | – |
| Kapitalerträge/Krypto 2026 sauber dokumentieren | – |

The suggested "Jede Strategie vor Echtgeld backtesten" became "Keine Strategie ohne bestandenen Backtest ins Paper-Trading", because live trading is out of scope.

**Routines** (all created **switched off**):

| Routine | Agent | When |
|---|---|---|
| Pre-Market-Briefing DAX | daytrading-prep | 08:30 Mon–Fri Europe/Berlin |
| Pre-Market-Briefing US | daytrading-prep | 09:00 Mon–Fri America/New_York (15:00 CET) |
| Krypto-Morgenbriefing | crypto-analyst | 08:00 daily |
| Paper-Session Start (US) | paper-trader | 09:40 Mon–Fri New York (after the opening range) |
| Paper-Session Schluss (US) | paper-trader | 15:50 Mon–Fri New York |
| Paper-Tagesbericht | paper-trader | 16:15 Mon–Fri New York |
| Paper-Krypto täglich | paper-trader | 09:05 daily Berlin |
| Wochenreview Trading | risk-journal | Sat 10:00 |
| Monatsreview Trading | risk-journal | 1st of the month, 10:00 |
| Strategie-Labor Wochenrunde | strategy-developer | Sun 18:00 |
| Steuer-Dokumentation monatlich | finance | 2nd of the month, 11:00 |

The New York routines follow the US session through both DST changes by themselves.

**Network:** mode `open` for research. The deny list is `LIVE_TRADING_HOSTS` (51 hosts, kept equal by a test), and `@paper-trader-trade` runs `blocked`.

## 9. Strategie-Labor and self-improvement

**The loop** (skill `strategie-labor`, note `Strategie-Labor`, board):
1. Idea
2. Strategy note with explicit rules (Gate A)
3. Backtest (Gate B): ≥ 100 day-trading or ≥ 30 swing trades in-sample and ≥ 30 out-of-sample; OOS expectancy > 0 and profit factor ≥ 1.2 after costs; walk-forward efficiency ≥ 0.5; ±20 % parameter neighbours still profitable; drawdown within the rule book; the variants tried are documented
4. `request_approval` to the owner (Gate C)
5. Paper for ≥ 4 weeks and 20 trades
6. Journal
7. Weekly and monthly review against the backtest
8. A new version (1–2 changes, never editing a traded version), or pause/retire

The pause/retire criteria apply after ≥ 30 paper trades or 6 weeks: expectancy ≤ 0 R, profit factor < 1.0, max drawdown > 1.5× the backtest's, a win rate more than 15 pp off, or rule adherence < 90 %.

**Linking:**
- Trade → strategy version → backtest → review → research, and every strategy has an index note.
- The paper `clientOrderId` carries strategy and version, so broker orders and journal entries join.
- Result files go to the task's attachments and are embedded in the note.
- `backlinks` is checked before a run finishes.

**Hermes learning:**
- Reviews propose lessons as memory entries; memory approval is on, so the owner confirms them.
- Recurring analysis steps go through Helena's reflection → learned skills, which the owner adopts or pins.
- Reflection stays `complex` (after runs with ≥ 10 tool calls); reviews and backtests reach that easily.
- hub/agent-context adds reflection after chat threads, so preferences the owner states in chat also become proposals. The skills use its goal tools (`add_goal_note`) where they are available and a task comment otherwise.

## 10. Live steps (orchestrator)

1. Merge `hub/trading` (after hub/agent-env and hub/agent-context, or before; no shared files, see §12). It needs:
   - `bun install` (a new workspace package, `@helena/trading`)
   - `deploy.sh` (API + web: plugin, routes, MCP change, catalog locale, translations)
   - no migration
2. **Import the pool:** Administrator → Agentenpool → "Vorlagen importieren" → Agentenpool (dry run first). This creates the 8 new templates, adds the 21 pinned and 13 German skills, and adds `kapitalertraege-dokumentieren` to the finance template. The alternative is `deployment/volition-stack/scripts/setup-agent-pool.ts` with the bundle section.
3. **Dry run of the blueprint:**

   ```sh
   ssh helena-ops@kingston-server.local 'sudo systemd-run --wait --pipe --collect --uid=volition-plan \
     -p EnvironmentFile=/etc/volition/plan.env -p WorkingDirectory=/srv/volition/source/plan/apps/api \
     /usr/local/bin/bun src/scripts/project-blueprint.ts --blueprint ../../blueprints/trading'
   ```

   Expect: no `[BLOCKED]` lines, about 85 changes.
4. **Apply:** the same command with `--apply`. Then wait for the provisioning job (workspace, browser, terminal, vault folders); Projekte → TRADE shows it.
5. **After the owner stored the paper keys** (Integrationen → "Alpaca Paper-Trading (Spielgeld)"): run the same command with `--sections=tools --apply`. It binds all paper tools to `@paper-trader-trade` and the read tools to risk-journal, chart, daytrading and quant.
6. **Checks:**
   - A new chat with `@paper-trader-trade`: "Lies das Paper-Konto" → `alpaca_paper_account` answers `paper: true` and shows the limits.
   - A second dry run: "Would apply 0 change(s)".
   - Home → Entscheidungen → run the eval of the three trading classes on "Lokale KI auf diesem Server"; switch on only what passes.
7. **Routines** stay off until the owner switches them on (Projekt TRADE → Routinen).

## 11. Owner (Deutsch)

1. **Alpaca-Paper-Konto anlegen** (app.alpaca.markets, nur E-Mail, keine Einzahlung) und die **Paper-Schlüssel** (beginnen mit PK) unter Integrationen → „Alpaca Paper-Trading (Spielgeld)“ eintragen, **zusammen mit deinen Grenzen**. Vorschlag bei 100.000 $ Spielgeld:
   - Order 1.000 $
   - Position 2.000 $
   - Risiko je Trade 50 $
   - Tagesverlust 150 $
   - 5 Positionen
   - 20 Orders/Tag

   Prüfe dabei, ob Krypto im Paper-Konto freigeschaltet ist.
2. **Regelwerk bestätigen oder anpassen** (`Docs/Regelwerk.md`, Entwurf mit den Zahlen oben): Märkte, Handelszeiten, Risiko.
3. **Welche Datenquellen mit Schlüssel?** Schlüsselfrei startet alles. Optional:
   - Finnhub (News/Termine)
   - FRED (Makro)
   - CoinGecko-Demo-Key
4. **Python-Pakete für Backtests freigeben** (§2.4, ein uv-venv, ca. 9 Pakete).
5. **Welche Routinen sollen laufen**, und ab wann? Sie sind alle aus. Empfehlung: zuerst Pre-Market US, Krypto-Morgenbriefing und Wochenreview; die Paper-Session-Routinen erst, wenn eine Strategie-Version freigegeben ist.

## 12. Overlaps with other branches

| Branch | Overlap |
|---|---|
| **hub/agent-env** | Not needed for trading: the paper key stays in the API. Its credential UI files (`apps/web/src/features/teams/components/credentials/*`) are untouched here. |
| **hub/agent-context** | Uses its goal tools and chat reflection when present, and does not depend on them. No shared files; `organization/service.ts` is only read here. |
| **hub/agent-tuning** (merged) | Its pool copies (`setup-agent-pool.copies.ts`) copy `finance` into PRIV and VOL. Those copies gain `kapitalertraege-dokumentieren` through the template (template → copy sync), unless their skills were overridden. Its `org` section adds the generic coordinator skills to every `hermes-*-coordinator`, `@hermes-trade-coordinator` included; that is harmless. Its 23 disabled bundled Hermes skills and denied toolsets are a sensible default for the TRADE agents too; extending its target to TRADE is a follow-up. |
| **Shared files touched** | `apps/api/src/mcp/server.ts` (configured tools), `modules/plugins/builtin.ts`, `planner.ts`, `modules/routines/service.ts` (`enabled` on create), `modules/projects/service.ts` (an export), `modules/agents/integrations/{service,catalog,index}.ts`, `packages/policy/src/classify.ts`, `packages/sdk/src/index.ts` and `package.json`, `apps/web/messages/*/god.json` (one key), `bundles/agent-pool/*`. |
| **Pre-existing on volition/hub** | `scripts/no-itsaplan-strings.test.ts` fails on `apps/api/src/scripts/agent-tuning/plan.test.ts` (agent-tuning's file). |

## 13. Open

- A UI and API route for blueprints ("Projekt aus Paket anlegen"). Plugins could offer blueprints like they offer bundles.
- A Binance Spot Testnet connector for crypto (hostname-separable), if the owner wants a second venue.
- Evals of the three trading classes on the live local AI: not run here (no model on the test machine).
- The live proof of the paper tools against Alpaca's real paper API waits for the owner's keys. It is covered by tests with a fake Alpaca (URLs, bracket order, refusals, key check, emergency stop, audit).
- yfmcp or the CoinGecko MCP for the researchers: optional, and needs an owner OK for the download.
- Extend agent-tuning's "disabled bundled skills / denied toolsets" to the TRADE agents.

## 14. Sources

- **Skills:**
  - https://github.com/tradermonty/claude-trading-skills
  - https://github.com/agiprolabs/claude-trading-skills
  - https://github.com/anthropics/financial-services
  - https://github.com/himself65/finance-skills
  - https://github.com/JoelLewis/finance_skills
  - https://github.com/alpacahq/alpaca-skills
- **MCP servers:**
  - https://github.com/alpacahq/alpaca-mcp-server
  - https://github.com/narumiruna/yfinance-mcp
  - https://docs.coingecko.com/docs/mcp-server
  - https://docs.ccxt.com/docs/mcp
  - https://pypi.org/project/openbb-mcp-server/
- **Alpaca:**
  - https://docs.alpaca.markets/docs/paper-trading
  - https://docs.alpaca.markets/docs/about-market-data-api
  - https://github.com/alpacahq/alpaca-py (`alpaca/common/enums.py`)
- **Other venues:**
  - https://testnet.binance.vision/
  - https://developers.binance.com/docs/binance-spot-api-docs/demo-mode/general-info
  - https://bybit-exchange.github.io/docs/v5/demo
  - https://docs.kraken.com/api/docs/guides/futures-introduction/
  - https://www.okx.com/docs-v5/en/
- **Tax:**
  - BMF-Schreiben 06.03.2025 (Kryptowerte)
  - JStG 2024 (§ 20 Abs. 6 EStG)
  - § 23 EStG Freigrenze (Wachstumschancengesetz)
