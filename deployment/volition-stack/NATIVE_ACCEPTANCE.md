# Kingston native acceptance — 2026-09-23

## Deployment scope

Plan, Hermes, Mastra, project browsers, code-server, and terminals run as native systemd
services on Kingston. The tested entry point is `http://kingston-server.local/`.
The Keller installation and public Cloudflare routing were not changed.

Privat (PRIV), Familie (FAM), and volition.one (VOL) have project workspaces and coordinators.
External mailbox authentication and automatic triage are deferred.

## Executed acceptance

- A real Mastra `agent-team` run called the VOL coordinator, a second Hermes agent, and
  the coordinator as reviewer. All three model calls used `gpt-5.6-luna`, reasoning `low`.
- Run `native-team-acceptance-20260923-v3` completed successfully. The specialist computed
  17 + 25 = 42; the reviewer accepted its evidence. Plan displayed the exact task VOL-1
  in Done with the Mastra result comment.
- Restarting the Mastra service preserved the successful run and result.
- Replaying the same event returned the existing run. Replaying task synchronization
  left one result comment. A mismatched project/task reference was rejected.
- A deterministic queue recovery check reused the same logical run after failure at
  attempt 1, refused recovery after attempt 3, and never requeued successful work.
  This recovery check made no model calls.
- Lease and heartbeat contracts are checked before enqueuing. Defaults match the
  deployed runner: 300-second leases and 60-second heartbeat bounds.
- Hermes final result text is extracted from its NDJSON stream. Tool transcripts do not
  become the structured team result. Missing results, explicit runtime failure, and
  oversized final results fail explicitly.
- The temporary task was deleted. Both participating agents' model and reasoning
  overrides were restored to their original defaults. Execution history remains available.
- Hermes used the project browser through `browser_exec(session="project")`; the same
  visited tab was visible in Plan. Terminal working directory and project Code UI were
  checked. Plan Docs synchronized a Markdown file into the native project vault.

## Automated checks

- Runner: 60 tests passed, including structured result extraction and UTF-8 byte bounds.
- Mastra control plane and event ingress: 14 tests passed using an isolated temporary DB.
- Integration service: 88 tests passed, including the Mastra/Hermes bridge.
- Python browser catalog: 4 tests passed.
- Browser/terminal proxy and Nginx guard installation: 12 tests passed.
- Repository formatting, lint, type checking, and `git diff --check` passed.
- The production Plan database was not used for destructive API integration test suites.

## Access checks

- Only SSH and Nginx TCP ports were reachable from the caller; backend TCP ports bind
  to loopback.
- Anonymous embedded Code, Terminal, Browser, and Hermes requests returned 401.
- Foreign Origin requests were rejected with 403. Forged forwarding/auth headers did
  not bypass the Plan session gate.
- Hermes responses carry same-origin framing restrictions. Nginx strips Plan browser
  credentials before forwarding embedded-tool requests.

## Limits and deferred acceptance

- Local access currently uses HTTP. TLS, remote access, and Cloudflare cutover require
  their own acceptance; this document does not certify LAN transport confidentiality.
- KasmVNC UDP listeners exist. Client UDP streaming is disabled by default; service
  restrictions are configured, but packet-level rejection remains unverified.
- Projects use separate profiles and scoped application capabilities, with shared Unix
  service ownership. They are not mutually isolated OS security tenants.
- The team workflow supports independent specialist assignments. Dependency-bearing
  assignments are explicitly rejected; arbitrary task dependency graphs are not implemented.
- The successful team test establishes one bounded work/review path, not every possible
  business workflow. External mail, OAuth, and authenticated-site browser persistence
  require tests after the corresponding accounts are connected.
- The Home agent's task API access does not grant unrestricted owner administration.
  Owner-only agent configuration remains in the authenticated Plan UI.
- Agent quality, website bot acceptance, and uninterrupted upstream availability are not
  guaranteed by these tests.
