# Paper execution safety — 2026-09-26

This change prepares safe demo execution. It does not place an order, approve a strategy,
change an account, remove the owner's entry halt, or establish profitability. Apply migration
0191 (`paper_execution_intents`) before starting the updated API. Its generated snapshot
follows 0190 (mail triage claim) and adds only the Paper intent table. Unified Vault is not
part of this release.

## Enforced before a new order

- The native API takes a PostgreSQL advisory lock on the broker's account ID. Different
  credential aliases for the same account contend on the same lock. Busy calls fail and
  can be retried with the original request ID. Credential ownership, project restriction,
  keys, current limits and emergency stop are checked again inside that operation.
- Open buys reserve position value and position slots. Open sells reserve inventory;
  attached OCO/bracket legs reserve their shared quantity once. Partial fills retain their
  remaining exposure; notional buys retain the full notional conservatively. Pending
  orders are observed before positions, so a concurrent fill does not vanish between the
  two observations. Incomplete/capped order lists and unvalueable data fail closed.
- A buy requires a canonical note at
  `Projects/<KEY>/Docs/Strategien/<id>/<id> v<version>.md`. Its YAML must have matching
  `typ: strategie`, `strategie`, string version, `status: paper`, `instrumente` and a
  nonempty `backtest` reference. The server checks the order symbol against that list.
  The gate verifies identity and evidence references, not economic merit or every prose rule.
- `trading_request_strategy_approval` takes project key, credential ID, strategy ID/version
  and optional issue ID. The server reads the complete note (at most 6000 UTF-8 bytes),
  verifies the account and creates a native approval card with its full text and SHA-256.
  The owner clicks the existing approval action; no manual hash entry is needed. Only a
  human project owner can decide this card. Autopilot 3 and frontmatter `freigabe` do not
  grant it. The latest card must be approved, belong to the same project/account/version,
  and match the current file hash. A new pending/rejected card or changed content blocks
  further submissions. Existing seed strategies remain drafts and unapproved.
- Stock entries attach their protective stop as OTO or bracket. Crypto entries fail closed
  even when `allowCrypto=true`: a later separate stop is not reliable entry protection.
  `alpaca_paper_check_order` remains a read-only risk preview, not a strategy approval or
  a reservation. Submit performs its own fresh checks and approval verification.

## Stable requests and uncertain outcomes

`alpaca_paper_submit_order` and `alpaca_paper_close_position` require `requestId`, a UUID
created once for the intended action and retained with the request. An account/project/request
hash yields a stable broker `client_order_id`; a separate argument hash prevents reuse for a
different order. The API commits an intent on a separate database connection **before** POST.
It survives rollback of the lock transaction and process failure. Recent durable orders also
count against today's order limit if the broker's order-history list temporarily lags.

A repeated request only looks up the original broker client ID. It never repeats POST.
An unanswered POST, invalid acknowledgement, or missing reconciliation result leaves the
intent uncertain and blocks other new orders on that account. In particular, a crash between
committing intent and sending POST conservatively blocks the account. A broker 404 alone is
not proof that the first request was never accepted. There is intentionally no automatic
resend or agent-accessible clearing endpoint. The operator must reconcile the original intent
with broker evidence before an audited recovery; do not delete intents to unblock trading.

The lock covers Helena API instances sharing this database. It cannot serialize manual
broker actions or other applications. Keep this paper account exclusive to this connector
while evaluating automation. Transactions are limited to three simultaneous lock holders
per API process to leave pool capacity for durable writes. Broker calls have bounded timeouts.

## Existing positions and limits

Risk-reducing closes use explicit sell quantities through the same reservation and intent
path; they no longer bypass it through DELETE-position. They can run while new entries are
halted or the daily loss limit is exceeded, provided current broker/price/inventory checks pass.
A fresh target price is required (maximum age 60 seconds). This deliberately refuses stale
weekend or closed-market data. Existing protective orders continue at the broker.

A close cannot oversell inventory already reserved by protective exits. It never cancels
those exits automatically. The cancellation tool only cancels a simple opening buy; sell
orders and attached order groups are preserved. Closing a protected position manually may
therefore require the owner to manage its exit in the broker UI. Atomic replacement of an
attached exit is a separate capability and is not claimed here. Stops limit intended risk;
they do not guarantee a fill price or eliminate gap/slippage risk.

## Readiness gate for the orchestrator

1. Integrate and migrate 0191 after the existing 0190 claim migration; deploy API and refresh the
   changed native tool schemas, skill text and role/routine text. Keep entries halted and
   crypto disabled until the remaining checks below pass.
2. Read the real paper account, positions, open orders and limits through the configured
   native agent tool. Record the returned status and freshness, never credentials. Confirm
   stock paper eligibility and current market-data availability.
3. Freeze a candidate strategy version with reproducible backtest, untouched holdout/walk-forward
   evidence, transaction costs, drawdown and risk criteria. Research examples and an LLM's
   confidence are not evidence of a profitable strategy. Review the complete native snapshot.
4. Have the human owner decide that explicit strategy card. Verify the native agent sees the
   bound tools and cannot self-approve or raise limits. A strategy's text gate does not itself
   implement its market signal; validate the exact deterministic signal and data pipeline.
5. Confirm unresolved intents are absent and native checks behave as expected. Any actual
   paper order is a separately authorized execution step; none is part of this change's tests.

## Models and TypeSafe

Read-only metadata observed 2026-09-26: `openai-codex/gpt-6-luna` has positive runtime evidence.
The stored catalog also lists `gpt-6-sol`, `gpt-6-astra`, `claude-sonnet-5` and `claude-opus-5`;
listing or a price row does not prove current account access. This change does not select or
activate a model. Existing trading roles that still select Sonnet conflict with the owner's
stated preference and require the orchestrator's configuration reconciliation. Use the proven
luna default until a stronger research model has measured task evidence and confirmed access.

The official [TypeSafe skill](https://github.com/typesafe-ai/skills),
[Choice contract](https://docs.typesafe.ai/primitives/choice), and
[function-calling cookbook](https://docs.typesafe.ai/cookbooks/function_calling) separate typed
judgments from executable business rules. Helena's browser/trading decision skills follow
that separation. Use JEV for bounded DOM choice, text/news classification or specialist routing;
compute sizing and enforce policy in code. Separate semantic confidence from permissions and
observed outcomes. No JEV response is a trading forecast or strategy approval. The orchestrator
installs and assigns the official skill inside Helena, not as a substitute for these gates.

Alpaca primary sources: [paper-trading limitations](https://docs.alpaca.markets/us/docs/paper-trading)
and [order/attached-order semantics](https://docs.alpaca.markets/us/docs/orders-at-alpaca).

## Validation of this change

- 31 trading package tests pass, including pending inventory/slots, crypto entry refusal,
  repeated requests, concurrent credential aliases, lost POST responses, a crash before
  POST, stale prices and protection-preserving cancellation.
- 53 API/real-PostgreSQL tests pass across trading safety, native approvals, configured
  agent tools and the trading blueprint. They include the real advisory lock, committed
  intents surviving rollback, changed credentials, owner-only approval, payload-forgery
  rejection, and invalidated note snapshots.
- API and trading TypeScript checks, changed-TypeScript ESLint, formatting and diff checks
  pass. The donor Paper migration applied with its prior migrations to a fresh isolated
  PostgreSQL 17 database. Dependencies were reused; all broker traffic in tests was a local
  fixture. No real account or order was touched.
