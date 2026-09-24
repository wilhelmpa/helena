# Standards quick wins (`hub/standards-quickwins`)

Status: in progress, 2026-09-24. Scope: the backlog in `docs/helena-decisions/standards-audit.md` §5.1 (on `hub/standards-audit`). The research and the choice of library are the audit's; this file records only what was built per item, and every place where the implementation deviates from the audit's recommendation, with the reason.

| ID | State | Commit | Notes |
|---|---|---|---|
| F21 | done | see git log | `ipaddr.js` 2.5.0 (MIT) |

## F21: IP classification with `ipaddr.js`

- `packages/net` keeps its DNS pinning, redirect refusal and limits. Only the question "which addresses are refused" moved to `ipaddr.js` `range()` (IANA special-purpose registries).
- Two tiers remain, as the audit describes them:
  - **every fetch** (`isPrivateIp`): unspecified, loopback, RFC 1918, link-local (the whole `fe80::/10`, which the old prefix check covered only for `fe80:`), CGNAT, unique-local, and now also NAT64 (`64:ff9b::/96`, `64:ff9b:1::/48`), SIIT (`::ffff:0:0:0/96`), 6to4, Teredo, site-local `fec0::/10`, `192.0.0.0/24` and `198.18.0.0/15`.
  - **public-only** (link previews): every address `ipaddr.js` does not classify as plain `unicast`, and IPv6 outside `2000::/3`.
- Deviation, on purpose: the documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`) stay allowed outside public-only. They are unroutable, so there is no SSRF in them, and the API's mail tests use `203.0.113.10` as a stand-in public mail host.
- Side effect (a fix): public-only used to refuse all of `192.0.0.0/16`, which includes real public hosts such as `192.0.78.9` (WordPress). Now only the two special /24s are refused. The anycast ranges AS112 and AMT are now refused under public-only; they are not link-preview targets.
