<!-- Draft (package G). Moves to the repository root at the public cut. -->

# Security policy

## Reporting a vulnerability

**Do not open a public issue.** Report it privately through GitHub's private vulnerability
reporting: *Security → Report a vulnerability* in this repository.

Please include:
- what an attacker can do, and under which conditions;
- steps or a proof of concept;
- the version or image tag and how the instance is deployed (Docker, native);
- whether agents, the browser gateway or the owner terminal are involved.

You get an acknowledgement within 72 hours and an assessment within 7 days. We publish an
advisory once a fix is released and credit you unless you prefer otherwise. Please allow a
reasonable time for the fix before disclosing.

## Supported versions

| Version | Security fixes |
|---|---|
| Latest minor (1.x) | Yes |
| Older minors | Upgrade to the latest minor |

## Scope

In scope:
- the API, web app, worker and runner;
- the browser router and gateway, the terminal routers;
- the shared packages and the deployment files in this repository;
- the way Helena configures and drives Hermes Agent, Claude Code and Codex.

Out of scope:
- vulnerabilities in the runtimes themselves (report them to their projects);
- issues that need an already compromised host or database;
- missing hardening headers without impact;
- volumetric denial of service.

AI-specific findings are in scope. For example:
- an agent reaching data, tools or credentials outside its grants;
- a prompt injection that performs an action of consequence without an approval;
- a credential reaching a model's context;
- one project's agent reaching another project's browser, files or terminal.

## Defaults for a new install

| Setting | Default |
|---|---|
| Registration | Closed. The first admin comes from a one-time setup link printed at first start |
| LAN auto-login | Off. It can be enabled for explicit host names and address ranges only |
| Owner terminal | Requires a TOTP code. The LAN bypass is off, and forwarded addresses are trusted only from configured proxies |
| Telemetry | None. Helena sends nothing anywhere |
| Published ports | Only the web entry. The API, Postgres, Chromium DevTools and the terminals stay internal |
| Agent actions of consequence | Wait for an approval; dangerous commands are blocked by the approval guard |
| New agents | Autopilot level "act with approval" |
| Credentials | Encrypted at rest; never placed in a prompt; each delivery audited |

## Hardening checklist for operators

- Serve Helena over HTTPS; cookies are `Secure` in production.
- Generate `BETTER_AUTH_SECRET` and `APP_ENCRYPTION_KEY` with `openssl rand -base64 32`. Back
  up `APP_ENCRYPTION_KEY` separately: without it, stored credentials cannot be decrypted.
- Keep the Postgres port and the Docker socket away from the agents container.
- Set up TOTP or a passkey for the admin account.
- Review the agent pool before copying templates into projects: skills are instructions.
- Keep backups encrypted; browser profiles in a backup hold logged-in sessions.
- Update regularly: `docker compose pull && docker compose up -d`. Migrations run with a
  backup first.

## How Helena handles secrets

- Secrets are stored encrypted in Helena's access centre. Each is granted to projects, agents
  or services, as read or write, with an audit log.
- Runtimes receive only what a run needs, as environment variables or the runtime's own
  credential store, never in the prompt. Website logins are filled by the browser gateway.
- API keys are shown once at creation. Agents' keys are rotated by Helena.
- The repository is scanned for secrets (gitleaks) on every change.
