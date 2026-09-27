# Paper acceptance: setup and actual agent reads

Review base: `072fb36fd74cc3a5f8879608c62ad18bc3ac66fd`. No live database, broker,
account, credential, routine or order was changed during this review.

## Reviewed boundaries

- `AlpacaPaperClient` builds HTTPS requests only to `paper-api.alpaca.markets` and
  `data.alpaca.markets`, rejects non-paper key IDs before fetching, refuses redirects,
  and applies a 15-second request timeout. Market data shares Alpaca's data host; the
  live trading host is excluded.
- `alpaca-paper-setup.ts` requires team 1, TRADE, external agent 66
  (`paper-trader-trade`) and exactly that project membership. Source credentials 43/44
  must be API keys in that team and global or TRADE-scoped, with no grants or tools.
  Existing foreign bindings or grants refuse setup before any provider read. Existing
  encrypted values and owner limits are preserved. Fresh setup has crypto disabled and
  `tradingHalted: true`; existing setup must actually read back `limits.halted === true`.
- Setup dry-run performs no provider calls or writes. Check and apply use only GET
  account, positions, open orders and clock. Apply grants and binds only agent 66;
  an identical repeat changes nothing. A 200-item order response is a capped page.
- Agent 66's source template uses `gpt-6-luna`, the Paper execution/limits/journal skills,
  without the separately prepared JEV/TypeSafe skills. Browser, terminal and generic
  connections are disabled in that template. This source review does not establish the current
  stored agent configuration. Setup does not overwrite skills, model, instructions or
  routines; Root must inspect those fields before the actual agent proof.
- Trading migration is `0191_paper_execution_intents`, after the existing
  `0190_helena_mail_triage_claim`. Vault is outside this release. No migration was run
  during this source review.
- A new entry still needs a current, canonical strategy note and hash-bound human
  project-owner approval, fresh price data, account lock, pending-order reservations,
  and a durable request intent. Uncertain outcomes do not trigger another POST.
  Entry halt leaves risk-reducing closes and limited cancellation possible; it is not
  a blanket prohibition on every write.

The HTTP MCP transport builds a server per POST, but its configured catalog is captured
before dispatch. Dispatch must recheck the
current agent/tool binding, credential team/integration/project and agent project before
decrypting credentials or making a request. The regression keeps the MCP client open
while removing its binding or changing those scopes; every subsequent call must fail
without another broker read. A project change during the policy check also refuses the
request. The existing `credentialInScope` rule preserves unscoped Home/multi-project
chat access through actual membership of the credential's project. A verified project
socket narrows that access to its project; Home receives no membership bypass. An
unscoped multi-project chat still has no execution project in the tool context.

## Offline acceptance commands

Use an isolated checkout with existing dependencies. Do not run API integration tests
against the deployment database or another running gate. Root releases the private
database slot first. No installation is part of these commands.

From that checkout, the pure checks need neither a database nor a provider:

```sh
bun test packages/trading/src/alpaca/alpaca.test.ts \
  packages/trading/src/alpaca/safety.test.ts
```

Actual configured-agent MCP dispatch is tested in the existing operator suite. It uses
an in-memory MCP transport, API-created dummy users/credentials and a fetch fixture
that accepts only GET on the two fixed Alpaca hosts. It cannot reach a real broker.
The positive case reads account/limits, positions, orders and market; only four local
credential-use audit rows are added. Execution intents, agent runs and notification
deliveries stay at zero. Revocation and scope-change cases reuse the same MCP session.

Set `paper_check_root` to the reviewed private checkout, with its private `.env.test`.
The following guard reads only connection metadata and prints no URL or credentials:

```sh
set -eu
: "${paper_check_root:?Set the reviewed isolated checkout path}"
cd "$paper_check_root/apps/api"
NODE_ENV=test bun --env-file="$paper_check_root/.env.test" -e '
  const u = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost"].includes(u.hostname) ||
      !/^[0-9]+$/.test(u.port) || u.port === "5432" ||
      u.pathname !== "/itsaplan_test" || process.env.NODE_ENV !== "test")
    throw new Error("Private paper test database required");
'
NODE_ENV=test bun --env-file="$paper_check_root/.env.test" test \
  src/scripts/__tests__/alpaca-paper-setup.test.ts \
  src/modules/agents/tools/__tests__/integration/agent-tools.test.ts \
  src/modules/trading/__tests__/integration/paper-safety.test.ts
```

The operator suite resets its private database and reproduces manifest IDs 43/44/66
through private sequences. It must never be staged as a production proof script.
The API test preload supplies temporary vault/storage directories. Fixture MCP clients
are closed before fetch is restored or the next test resets the database.

## Root acceptance after deployment

1. Use the exact-head/root-owned script staging and serial execution procedure in
   [the operator runbook](alpaca-paper-operator-2026-09-26.md). Confirm migration 0191,
   no pending/streaming work, and no concurrent credential or agent configuration edit.
2. Inspect stored agent 66's project, model, instructions, skills and disabled toolsets.
   Match the Paper-only role above. Preserve owner assignments and schedules. A missing
   skill or stale instruction is an explicit reconciliation item, not a successful proof.
3. Run dry-run, then GET-only check, then apply. Confirm exact scope, complete limits,
   active Paper account, entry halt and no orders. Repeat apply and require `changed:false`.
   These reads and local binding writes are separate from strategy approval or execution.
4. Open a fresh TRADE chat with agent 66. Request only account/limits, positions, open
   orders and market data; explicitly prohibit submit, close, cancel, strategy approval
   and configuration changes. Inspect actual native tool results and credential-use
   audit records. A claim in generated prose or the setup's direct client read alone
   does not prove the agent can use its MCP binding. Record returned data timestamps
   and any missing feed entitlement; do not claim freshness from response receipt alone.
5. Confirm the proof contains only the requested read tools, no new execution intents,
   no write-category credential use and no order/approval/configuration action. Record
   only safe counts, tool names, manifest IDs and outcomes. Do not print credentials,
   raw headers or provider errors. Keep halt on; no order is required for acceptance.

The offline checks establish dispatch and guard behavior with synthetic responses.
Only Root's deployed agent proof establishes the real account and runtime access. Neither
establishes a profitable strategy or authorizes an order.

## Historical donor validation evidence

The results below belong to the reviewed donor. The new Paper-on-7b composition and
regenerated 0191 migration still require their own private Linux/PostgreSQL gate.

- Pure Paper host/client/risk/reservation/replay checks: 27 tests, 119 assertions, no failures
  on the Mac; existing cached dependencies only.
- Private PostgreSQL 17 on reserved port 65505: operator, configured-tool and Paper-safety
  integration suites passed 38 tests and 372 assertions. The operator suite includes the
  actual in-memory MCP reads, five binding/scope changes, and four unscoped/Home/project
  socket combinations with subsequent membership removal.
- The nine targeted revocation/scope regressions fail against the base dispatch. Restoring
  the candidate produces the complete 38/0 result again. No real broker was contacted.
- API TypeScript, scoped ESLint, repository Prettier and diff checks passed. The private
  database is stopped after the checks. Deployed authentication, current stored agent
  configuration and real broker-read acceptance remain Root's separate steps above.
