# TypeSafe in Helena

The official `typesafe-ai` skill is pinned to upstream commit
`65a39f393687675ce170e6094757de20370365b9`, with MIT attribution in
the agent-pool manifest. Its SKILL.md SHA-256 is
`71ea90d7906c6554c4f4c460ef7361b2d26f59116ccdae986dc6d997b9389f52`.
The Helena library stores the original markdown and license. Browser and trading
helpers specify Helena tools, credential isolation and independent validation.
The pool and trading blueprint assign these skills to the appropriate roles.

## Runtime verification

On September 26, the official skill (118), browser helper (119), and trading helper
(120) were installed in team 1. The runtime skill loader returned the exact official
markdown for 48 agents/templates. All previously assigned skill IDs remained present.
The target set includes agents with the native browser gateway, browser operators,
the trading coordinator and trading/finance roles. Existing project permissions remain
the authority for tool access; a skill never grants a browser or a brokerage account.

A server-side TypeSafe decision connection (46) uses the existing owner-entered JEV
credential (45), retained unchanged. An internal equality check confirms the same key
is stored. Agents receive neither value. The endpoint is `https://api.typesafe.ai`
and model `jev-latest`, matching the provider model list and API documentation.

## Connection acceptance

Helena's connection test checks actual inference with a synthetic public yes/no
question, even when the model list is reachable. The answer must contain a valid
probability. HTTP 402 produces an explicit billing/credits message and an error status.
This prevents a successful metadata request from falsely reporting inference ready.
The test performs no browser action and sends no owner, mail or trading data.

The live model list was reachable. SDK and direct HTTP inference both returned
`billing_error` / HTTP 402, saying that the key's organization has no available API
credits. The owner confirms credits in the same organization. The cause remains
unresolved; a provider billing delay or error is possible but not proven. No successful
JEV decision, trading action or end-to-end browser run is claimed. No payment was made.
Continue independent work; repeat the public synthetic inference test when the
provider becomes available, then record real model/latency/token and outcome evidence.

Targeted validation: 15 API integration tests passed, including metadata-success with
inference-402 and malformed probability failures; API typecheck and lint passed.
The library assignment is live data. The connection-test and durable manifest changes
remain subject to the root integration, full-test and deployment gate.

Sources: [official skill](https://github.com/typesafe-ai/skills/tree/65a39f393687675ce170e6094757de20370365b9/skills/typesafe-ai),
[API reference](https://docs.typesafe.ai/api),
[use-case map](https://docs.typesafe.ai/concepts/use-case-map).


## Safe SDK errors and keys

Decision credentials accept a trimmed, nonempty printable ASCII token when the backend
requires a key. Embedded whitespace, control characters and non-ASCII header values are
refused before saving and before any network call, including credentials stored by older
versions. Optional keyless local backends remain supported. The API never copies a provider
or SDK error message or cause into responses, credential status or Browserlab summaries.
Client construction, synchronous SDK validation, transport and parsing failures are mapped
to fixed messages. HTTP 402 retains its billing/credits guidance; HTTP 413 asks to reduce
input. Router error bodies are also discarded before Browserlab stores a failure.

Regression fixtures use dummy keys and a loopback server only. They cover malformed keys on
create/update and in historical storage, both internal browser decision routes, status
persistence, synchronous SDK failure, generic APIConnectionError messages/causes, timeout,
402/413, and a router response reflecting its synthetic service token. No real provider
request or credential inspection is part of these checks.

Upstream reports: [SDK key/error handling #14](https://github.com/typesafe-ai/typesafe-sdk-js/issues/14)
and [generic HTTP errors #13](https://github.com/typesafe-ai/typesafe-sdk-js/issues/13).


Safety validation: 21 API integration tests / 115 assertions passed on private PostgreSQL
55568. API TypeScript, scoped ESLint and Prettier passed. Removing key validation or restoring
raw SDK error messages each caused the corresponding regression tests to fail. Original
sources were restored after both mutation controls. Logs: `~/agent-work/typesafe-safety-*.log`.
The private test database process was stopped by the test runner. No deployment was performed.
