# Decision: access center ("Zugänge & Verbindungen")

Status: decided 2026-09-24 (hub/access-center). Scope: connectors, credentials, grants, audit,
approvals for connector actions, Google, IMAP/SMTP mail, web logins, API keys and secrets, SSH
keys, MCP/OAuth connections.

Rule applied: `docs/volition-helena-oss.md` §3b "Standards statt Eigenbau". Every building block
below names the standard it uses, the alternatives that were weighed, and the thin layer Helena
adds on top.

## 1. Summary

| Block | Decision | Rejected |
|---|---|---|
| Secret storage | Keep `@repo/crypto` (AES-256-GCM, `APP_ENCRYPTION_KEY`) and the `integration_credential` table: one store for every secret | Better Auth `encryptOAuthTokens`, OS keyring, HashiCorp Vault / Infisical / OpenBao, sops/age |
| Connector sign-in (OAuth) | Google: `google-auth-library` `OAuth2Client` (official, Apache-2.0) with PKCE. MCP servers: the MCP TypeScript SDK's client `auth()` (MIT). Future generic OAuth providers: Arctic (MIT) | Better Auth's `account` table / `linkSocial`, openid-client for Google, a hand-written OAuth client |
| Google APIs | The official per-API packages `@googleapis/{gmail,calendar,drive,docs,sheets,people,tasks}` (Apache-2.0) as the primary engine. `gog` (MIT) as an optional engine for tokens that already live in a gog keyring | the 215 MB `googleapis` monolith, hand-written REST calls, gog as the only engine |
| Mail transport | ImapFlow (MIT) + Nodemailer (MIT-0), both already in use; Google mailboxes sign in with SASL XOAUTH2 using the account's OAuth access token | a second import engine on the Gmail API, app passwords |
| Agent tools | Helena's MCP server (`@modelcontextprotocol/sdk`, routes → tools), one tool per connector action, each with an action category that sets the MCP tool annotations | a single generic "execute action" tool, a separate MCP server per connector |
| Policy | A thin `decideConnectorAction()` seam over the action category and the grant, shaped for hub/autopilot to replace with its engine (Cedar/CASL is autopilot's decision) | a policy engine in this branch |
| SSH | `node:crypto` Ed25519 key generation (exists), OpenSSH + `GIT_SSH_COMMAND` (git's own standard hook), system `git clone` | libgit2 bindings, isomorphic-git, ssh-agent forwarding |
| Reference model | Nango's concepts (integration → connection → actions/syncs, connection health) as a **design reference only** | Nango as a dependency (Elastic License 2.0, and a separate server) |

## 2. Helena's own auth (Better Auth 1.6): can it carry connector accounts?

Helena signs people in with Better Auth 1.6.27 (`packages/auth`): email/password, magic link,
passkeys, API keys, `socialProviders.google`, `genericOAuth` for one OIDC provider, and the `mcp`
plugin (Helena as the OAuth server for MCP clients). Better Auth keeps provider tokens in its
`account` table and can refresh them (`getAccessToken`), and `linkSocial` can ask for extra
scopes. It still does not fit connectors:

1. **Wrong meaning.** An `account` row is a sign-in identity of one person. Linking the family
   Gmail as a login would let whoever controls that Google account sign in to Helena as the
   owner. A connector is a team or project resource that agents use under grants, not a way in.
2. **Callback only.** Better Auth completes OAuth at `/api/auth/callback/<provider>` on
   `BETTER_AUTH_URL`. Google accepts a web-client redirect only for https or localhost, and a LAN
   install runs on plain http (`http://kingston-server.local`). A headless install needs the
   paste-back flow (loopback redirect, the owner copies the final URL back), which Better Auth
   does not offer.
3. **No grants or audit.** Tokens would sit outside the credential store, invisible to the one
   grant system and its audit log, encrypted (if at all) with a different key.
4. **One client per provider per instance.** Connectors need one OAuth client per install and
   possibly several (one per Google Cloud project), each uploaded as a client JSON.

So Better Auth stays what it is (people signing in), and connectors keep their tokens in the
credential store. What Better Auth teaches is reused: PKCE, `state` bound to the session, and
refresh on read.

## 3. OAuth for connectors

**Google: `google-auth-library` `OAuth2Client`** (Apache-2.0, maintained by Google, 11.x).
- It is the auth layer the official `@googleapis/*` clients already take (`auth: client`), so the
  same object signs API calls and refreshes the access token on demand; there is no second token
  path to keep in sync.
- `generateAuthUrl({access_type: 'offline', prompt: 'consent', code_challenge, state})`,
  `generateCodeVerifierAsync()`, `getToken({code, codeVerifier, redirect_uri})`,
  `getAccessToken()` and `getTokenInfo()` cover start, exchange, refresh and health.
- Two ways back, chosen per client type in the uploaded client JSON:
  - `installed` (Desktop) client → loopback redirect `http://127.0.0.1:<port>`. The owner signs
    in on any device, the browser ends on an unreachable 127.0.0.1 page, the owner pastes that
    address into Helena. This is Google's supported replacement for the retired OOB flow and the
    same flow `gog auth add --remote` uses.
  - `web` client and Helena served over https → the normal callback
    `/connectors/google/oauth/callback`.

**MCP servers with OAuth: the MCP TypeScript SDK's client `auth()`** (`@modelcontextprotocol/sdk`,
MIT, already a dependency of the API). It implements the MCP authorization spec: protected
resource metadata (RFC 9728), authorization server metadata (RFC 8414), dynamic client
registration (RFC 7591), PKCE, resource indicators (RFC 8707) and refresh. Helena implements its
`OAuthClientProvider` interface over the credential store; nothing else is hand-written.

**Future generic OAuth connectors** (Microsoft 365 mail, GitHub, Notion …): **Arctic** 3.x (MIT,
fetch-based, 60+ provider presets, PKCE, generic `OAuth2Client`, three tiny `@oslojs` deps).
Not added now because no connector in this branch needs it.

Weighed and not chosen:
- **openid-client** 6.x (MIT, OpenID-certified, panva): the best choice for OIDC discovery with
  an arbitrary issuer, but Google is served better by its own library, and MCP by the MCP SDK.
  It stays the fallback for a future "any OIDC provider" connector.
- **oauth4webapi** (openid-client's core): lower level than needed.
- A hand-written OAuth client: exactly what §3b forbids.

## 4. Google: official SDK first, gog as an optional engine

| | `@googleapis/*` + `google-auth-library` | gog (steipete/gogcli) |
|---|---|---|
| License | Apache-2.0 | MIT |
| Form | npm packages, in-process | a 44 MB Go binary, run through sudo as its own user |
| Tokens | Helena's credential store (AES-256-GCM) | gog's encrypted file keyring under `volition-google` |
| Access token for IMAP/SMTP XOAUTH2 | yes (`getAccessToken()`) | **no**: no command prints one; `gog auth tokens export` writes the *refresh* token to a file |
| Open-source install (Docker) | works with only a client JSON | needs the binary, a user, a keyring password and a sudo rule |
| Coverage | every Google API, typed | Gmail, Calendar, Drive, Docs, Sheets, Slides, Forms, Contacts, Tasks, Chat, Keep … |
| Tests | the client takes a fake transport | only against a fake broker |

**Primary: the official SDK.** It is the standard, runs in process, is typed, needs nothing on
the host, and one token serves both the APIs and the mailbox. The per-API packages add about
7 MB; the `googleapis` monolith (215 MB unpacked) is rejected.

**gog stays an optional engine** because the owner's three accounts are already authorized
there and must keep working without a new consent. Helena reaches it only through a new,
restricted broker (`helena-google-broker`, run with `sudo -u volition-google`), never through
the owner's unrestricted `volition-gog-bridge`:
- It reads one JSON request on stdin.
- Only allowlisted operations: list accounts with a health check, the two steps of the remote
  sign-in, import a client JSON, remove an account, and a fixed set of tool commands, each
  pinned with gog's own `--enable-commands-exact`.
- Never `auth tokens`, `backup`, or `auth credentials list`.

Agents never call gog. Helena calls the broker for them, after the grant and policy checks.

With gog, the **mail inbox is not available**. Only an access token lets IMAP sign in with
XOAUTH2, and gog can hand one out only by exporting the refresh token. Exporting would break
exactly the isolation that moved gog to its own user. A gog account therefore offers tools and
health only. For the inbox, the account is connected once with the Helena engine. "In Helena
übernehmen" then removes the gog token (`gog auth remove` through the broker), so a token never
lives twice ("keine Doppelung").

Recommendation for the owner's install: move the three accounts to the Helena engine once:
- upload the OAuth client JSON
- three sign-ins
- switch on Mail

Afterwards gog is the owner's personal CLI only.

## 5. Mail: IMAP/SMTP with XOAUTH2, not the Gmail API

The inbox needs mail from a Google account without an app password. The two ways:

- **IMAP + SMTP with SASL XOAUTH2** (chosen). ImapFlow takes `auth: {user, accessToken}`, and
  Nodemailer takes `auth: {type: 'OAuth2', user, accessToken}`. So the existing, tested import
  engine keeps doing all of its work:
  - folders and Gmail's All Mail
  - UID/CONDSTORE deltas
  - IDLE push within seconds
  - flag and move write-back
  - sending our own MIME

  The same engine then serves Google and every other provider (decision D3: IMAP/SMTP as the
  basis). A later Microsoft 365 connector gets its mailbox for free, because Exchange Online
  also speaks XOAUTH2.
- **Gmail API** (rejected). It would need a second import engine: labels instead of folders,
  `history.list` deltas, and Pub/Sub or polling for push. That means two code paths for one
  inbox, and push would need a Google Cloud Pub/Sub topic.

The cost of XOAUTH2 is the scope `https://mail.google.com/`, which the account's Mail service
requests. Like `gmail.modify`, it is a restricted scope. For the owner's own accounts, an
unverified app in "In production" state works, with Google's warning screen on consent. Leaving
the app in "Testing" is wrong, because refresh tokens then expire after 7 days (see the setup
guide).

Per mail service:
- `Abrufzeitraum in Tagen` (default 30): the first import searches `SINCE` the window start, and
  a daily pass prunes imported copies that fell out of the window. The originals on the server
  are never touched.
- "Zurücksetzen" wipes the imported copies (messages, threads, folder state, `.eml` files,
  attachment files) and imports again.

## 6. Agent tools and action categories

- **Transport:** connector tools are Helena MCP tools, generated from API routes like every other
  Helena tool (`apps/api/src/mcp`). The routes come from the connector registry, so a plugin
  connector gets its tools without core changes.
- **One tool per action,** each with a JSON Schema input, for example `google_mail_search` and
  `google_calendar_create_event`. A generic "execute any action" tool was rejected: models pick
  typed tools more reliably, and MCP annotations then describe each action honestly.
- **Visibility:** an agent lists only the connector tools of providers it holds a grant for.
- **Action categories:** `read`, `write`, `send`, `share`, `delete` (autopilot adds `pay` and
  `publish`). Each category sets the standard MCP tool annotations (§3b):

  | Category | Annotations |
  |---|---|
  | read | `readOnlyHint` |
  | write | `idempotentHint` false |
  | send / share | `openWorldHint` |
  | delete | `destructiveHint` |

  The category itself travels in the route's `x-mcp` metadata, so the policy never guesses from
  hints.

## 7. Grants, policy, approvals, audit

- **One grant table** (`integration_credential_grant`, widened):
  - Subject: an agent or a project.
  - Scope: an optional service of the account (`mail`, `calendar` …; empty = every service).
  - Access: `read` or `write`.
  - Web logins, API keys, secrets, SSH keys, Google and MCP connections all use it.
- **Policy seam:** `decideConnectorAction({agent, projectId, category, grant})` returns
  `allow | approve | deny`. The default until hub/autopilot ships:
  - no grant → deny
  - read access → only `read`
  - write access → `read`/`write` allowed, and `send`/`share`/`delete` need the owner's approval
- **Approvals:** an action that needs one is stored exactly as asked (`connector_action`) and
  filed as an `approval_request` (kinds `send` / `publish` / `delete`). The worker carries it out
  once approved, the same pattern as mail drafts. What runs is exactly what the owner saw.
- **Audit:** `integration_credential_use` records every delivery, fill, tool call, denial and
  approval request, with the category.

Autopilot (Cedar or CASL) replaces the body of `decideConnectorAction`; callers stay unchanged.

## 8. SSH keys

Keys are generated in Helena (Ed25519, exists). Only runs of granted agents receive them:
- The runner writes each key 0600 into a 0700 directory of the agent's profile.
- It sets `GIT_SSH_COMMAND` to `ssh -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`
  with a per-profile `known_hosts`, and one `-i` per granted key. This is git's documented hook;
  no git library is needed.
- "Repo in Bereichsordner klonen" runs `git clone` with the chosen key into the area folder. The
  nested repo is added to the workspace repo's `.git/info/exclude`, git's own per-clone ignore
  file.

Rejected:
- libgit2 / nodegit: native builds, unmaintained.
- isomorphic-git: no SSH transport.
- ssh-agent forwarding: a long-lived socket per agent.

## 9. What Helena builds itself (the thin layer)

- **Connector registry:** a provider declares its credential schema (secret vs readable fields),
  services and scopes, sign-in flow, health check, and tools with category and schema. It stays
  small and moves into `@helena/sdk` when hub/framework publishes it.
- **The paste-back step:** Google's library has no UI for pasting the redirect URL back.
- **The gog broker**, and the JSON-in/JSON-out calls to it.
- **Pruning of the fetch window, and the reset.**

## 10. Licenses of added packages

All Apache-2.0: `google-auth-library`, `@googleapis/gmail`, `@googleapis/calendar`,
`@googleapis/drive`, `@googleapis/docs`, `@googleapis/sheets`, `@googleapis/people`,
`@googleapis/tasks`.

- Already present: `imapflow` (MIT), `nodemailer` (MIT-0), `@modelcontextprotocol/sdk` (MIT),
  `better-auth` (MIT).
- No binary or system package is added. gog is already installed on the owner's machine, and
  bundling it is the packaging branch's call.
