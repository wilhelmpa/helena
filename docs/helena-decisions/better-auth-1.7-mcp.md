# Decision: Better Auth 1.7 and the MCP authorization server (F06)

Status: planned 2026-09-24 (hub/access-center). This is one coordinated upgrade to do
before open source, in its own branch. It is not part of the access center, because it
moves every sign-in path and needs its own live test.

## Today

Helena signs in with Better Auth **1.6.27** (`packages/auth`). Its MCP endpoint is an
OAuth resource server through the legacy **`mcp` plugin** from `better-auth/plugins`:
- The plugin is built on the old oidc-provider.
- Its tables are `oauthApplication`, `oauthAccessToken` and `oauthConsent`
  (`packages/db/src/schema/auth.ts`).
- Where it is used:

| Where | Call |
|---|---|
| `packages/auth/src/index.ts` | `mcp({ loginPage, resource: \`${API_URL}/mcp\`, oidcConfig })` |
| `apps/api/src/mcp/mount.ts` | `withMcpAuth(auth, handler)` |
| `apps/api/src/shared/auth-context.ts` | `auth.api.getMcpSession(...)` |
| `apps/api/src/app.ts` | `oAuthDiscoveryMetadata(auth)`, `oAuthProtectedResourceMetadata(auth)` |

The MCP 2026-07-28 authorization profile expects things the legacy plugin does not
implement:
- Client ID Metadata Documents (CIMD) as the default client identity. Dynamic client
  registration is deprecated there.
- RFC 9207 issuer identification in the authorization response.
- DPoP (RFC 9449) sender-constrained tokens.
- Resource indicators (RFC 8707) binding a token to the MCP resource.

## Target

**Better Auth 1.7.x with `@better-auth/mcp`** (MIT, same maintainers). The plugin sits
on `@better-auth/oauth-provider` (OAuth 2.1) and adds the following:
- RFC 9728 protected resource metadata and RFC 8414 discovery
- CIMD, with dynamic client registration only when explicitly enabled
- DPoP, resource indicators, and RFC 9207 `iss` on the authorization response
- JWT access tokens verified against the server's JWKS (the `jwt` plugin)
- `requireMcpAuth(...)` for the MCP route, with a correct `WWW-Authenticate` challenge
  and scope step-up

Its tables are `oauthClient`, `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent`,
`oauthClientAssertion`, plus `jwks` from the `jwt` plugin.

Rejected:
- **Staying on 1.6 with the legacy plugin.** Current MCP clients move to CIMD and stop
  registering dynamically. Helena's public MCP endpoint would then fall behind the spec
  it advertises.
- **A hand-written MCP authorization server on openid-client.** That is exactly what
  §3b forbids, and Better Auth already owns the session and user tables.

## Plan (one branch, one deploy)

1. **Upgrade in lockstep.** Move `better-auth`, `@better-auth/api-key`,
   `@better-auth/passkey` and the CLI used by `auth:generate` to the same 1.7.x. Mixed
   versions do not run: the peer `better-call` is pinned.
2. **Swap the plugins.** Replace `mcp(...)` with `jwt()` + `mcpAuth(...)` from
   `@better-auth/mcp`, with these settings:
   - `resource = ${API_URL}/mcp`
   - `loginPage = ${APP_URL}/login`
   - the consent page Helena already has (`/oauth/consent`)
   - CIMD on
   - DCR on for one release, so clients registered today keep working, then off
3. **Schema.** Run `bun --filter @repo/auth auth:generate`, then
   `drizzle-kit generate --name=better_auth_1_7`.
   - Existing `oauthApplication` rows are copied into `oauthClient` in the same
     migration (client id, secret hash, redirect URIs, name).
   - Access tokens are not copied: clients refresh or sign in again once.
   - The old tables are dropped one release later.
4. **Call sites.**
   - `mount.ts`: `withMcpAuth` becomes `requireMcpAuth`.
   - `auth-context.ts`: `getMcpSession` becomes the plugin's token verification, which
     returns the user id.
   - `app.ts`: the discovery handlers come from the new plugin.
   - `mcp-request.ts` keeps passing the token.
5. **Tests to port or add.**
   - Port `apps/api/src/mcp/__tests__/integration/oauth.test.ts` to the new flow:
     - discovery documents
     - a CIMD client
     - authorization code with PKCE and resource
     - a DPoP-bound token refused without its proof
     - refresh
     - a wrong resource refused
   - Add a test that the API-key session path (`enableSessionForAPIKeys`) and the
     key limit (`key-rate-limit.ts`) are unchanged.
6. **Live.**
   - Deploy.
   - Run the migration.
   - Connect Claude Desktop and one other MCP client again.
   - Check `/.well-known/oauth-authorization-server` and
     `/.well-known/oauth-protected-resource`.

## Size and risk

M–L. The risk sits in step 3: an MCP client registered today has to register again, or
be copied correctly. Password, passkey, magic link, Google and OIDC sign-in are untouched
by the plugin swap, but the version bump moves them too, so the auth test suites
(`auth-verify`, `api-keys`, `password-reset`, `usernames`, the OIDC and passkey tests)
are the gate.
