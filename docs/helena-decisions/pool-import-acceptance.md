# Point 5: authenticated pool import acceptance

Prepared from `4ac4367a`, including release `94380daf`. Live acceptance: NOT RUN.
The existing `callerOf` and `inProcessTransport` forward the caller's cookie,
API key and Authorization header. The team permission guard applies to the outer
request and every internal resource request. No additional login is needed.

Root performs this after the ordered release gate and point 4 acceptance, using
the existing authenticated Owner session at `/account/teams/1/ai-agents`:

1. Open **Vorlagen importieren → Agentenpool**. The offered id is
   `helena-agent-pool`. Use the current team's id; do not import into another team.
2. Send the existing import request with
   `{"offer":"helena-agent-pool","dryRun":true,"update":false}` to
   `POST /teams/1/template-bundles/import` (under the existing API base).
3. Save only the response report: `written`, `unchanged`, `drift`, `warnings`,
   `summary`, `lines`. Require HTTP 200, `written=0`, no 401/403/`Stopped` line,
   and no unresolved warning. HTTP 200 alone does not mean the import succeeded.
4. Inspect planned missing skills before applying: a missing GitHub skill may
   download. Hold that operation unless its download is already authorized.
   Existing entries must remain unchanged; drift must not enable **Update**.
5. Apply with `dryRun:false, update:false` through the same UI/session. Repeat
   once; require `written=0` on the repeat and no duplicate templates, skills or
   MCP servers. Preserve Owner instructions, models and runtime policies.

Record deployed SHA, team id, both reports, and the authenticated UI result.
Do not export cookies, headers, credential stores or browser profiles. Do not
log out the Owner for negative tests: missing-session 401 and foreign-team 404
are covered in the isolated API test below. No provider is called by that test.

From the private API test environment only:

```sh
bun test src/modules/template-bundles/__tests__/integration/import.test.ts
```

This existing test exercises dry-run, actual writes, repeat import, protected
drift, explicit update, export, missing session and a caller outside the team.
It creates synthetic local skill files and a tool definition, without contacting
the configured example endpoint. Pool import creates team templates; it does
not prove project runner ownership. Point 6 supplies that separate proof.
