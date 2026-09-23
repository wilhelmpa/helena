# worker — rules

Webhook delivery worker: a standalone Bun process that drains the
`webhook_delivery` queue and posts signed payloads to subscriber URLs. Runs as its
own service (own Dockerfile), separate from `apps/api`. See root `AGENTS.md`.

## What it does

- Polls `webhook_delivery` for due `pending` rows, claims a batch with
  `FOR UPDATE SKIP LOCKED`, posts each to its webhook URL, records the outcome.
- Signs every request: `X-Itsaplan-Signature: t=<ts>,v1=<hmac-sha256>` over
  `${ts}.${body}` with the webhook's `secret`. Plus `X-Itsaplan-Event`,
  `X-Itsaplan-Delivery`, `X-Itsaplan-Event-Id` (stable across retries).
- Retries transient failures (timeout, 429, 5xx) with equal-jitter exponential
  backoff up to `WEBHOOK_MAX_ATTEMPTS`; permanent 4xx fail immediately. After
  `WEBHOOK_DISABLE_THRESHOLD` consecutive failures the webhook is auto-disabled.
- Delivers `project_provisioning_job` and `project_deprovisioning_job` rows to the
  integration service at `PROJECT_PROVISIONING_URL`. A provisioning request names the
  project's boards and its agents that get a Hermes runtime of their own: external
  agents that work in this project only, other than the Home agent and the
  coordinators. Every `PROJECT_RECONCILE_INTERVAL_MS` (10 minutes) it reads the
  service's provisioned state from `<url>/state` and queues a new job for each project
  that differs from the database; finished deprovisioning rows are removed after 30
  days. Before it delivers a deprovisioning job it deletes the project's Mastra
  schedules through the control endpoint at `MASTRA_CONTROL_URL` (bearer from
  `MASTRA_CONTROL_TOKEN_FILE`); the job waits for a retry while that fails.
- Drains `notification_delivery` and sends each row itself: email through
  `@repo/mailer`, Telegram through the Bot API. The provider credentials are read
  from the database and decrypted here (`notification-send.ts`), so the process
  needs `APP_ENCRYPTION_KEY`.
- Imports mail (`src/mail/`): one IMAP connection per enabled account with a password
  imports every folder newest first, then waits on the inbox with IDLE and compares the
  other folders every `MAIL_POLL_INTERVAL_MS`. A message is stored once per account (by
  Message-ID) with one `mail_message_folder` row per folder holding it; the stored UIDs
  are the checkpoint an interrupted import resumes from, and `mail_folder.uid_next` is
  written only when a folder pass is complete. The raw `.eml` goes to `STORAGE_ROOT`,
  attachments to the vault (`PROJECT_VAULT_ROOT`, paths from `@repo/mail`). Changes made
  in Plan (`mail_action`) are pushed before the server's flags are read back. Queued drafts
  are sent over SMTP once their `send_at` passed, at most once: a send interrupted midway
  is marked failed, never repeated. New inbox mail of an account with triage on becomes a
  `hub_inbox_event` for the inbox triage.

## Invariants

- **Reads/writes `@repo/db` directly, never the API over HTTP.** It is a DB
  consumer and an HTTP producer. It does not import `apps/api` and does not call it.
- **Notification credentials are read, never taken from the caller.** A delivery
  row names its project; the credentials come from the team that owns it and from
  the instance config. Nothing about the recipient or the provider is passed in
  from outside.
- **No migrations here.** The api applies them on startup; the worker only uses
  existing tables and tolerates their brief absence (a tick logs and retries).
- **At-least-once delivery.** Duplicates are possible (a 2xx whose ACK is lost);
  the `event_id` is stable across retries so receivers deduplicate. Never mint a
  new id per attempt.
- **Claim leases, not a status flag.** Claiming pushes `next_attempt_at` forward
  by `WEBHOOK_LEASE_SECONDS`; a crashed delivery is reclaimed after the lease. Keep
  the lease comfortably larger than `WEBHOOK_TIMEOUT_MS`.
- **Pure logic stays dependency-free.** `backoff.ts`, `signature.ts`, and
  `isRetryableStatus` import nothing from `@repo/db`, so unit tests run without a
  database. Keep DB access in `store.ts`.

## Config

All via env with defaults (see `src/config.ts`): `WEBHOOK_POLL_INTERVAL_MS`,
`WEBHOOK_BATCH_SIZE`, `WEBHOOK_TIMEOUT_MS`, `WEBHOOK_MAX_ATTEMPTS`,
`WEBHOOK_DISABLE_THRESHOLD`, `WEBHOOK_LEASE_SECONDS`, `WEBHOOK_CLEANUP_DAYS`,
`WEBHOOK_CLEANUP_EVERY_TICKS`, and `MAIL_*` for the mail import (`src/mail/transport.ts`).
Only `DATABASE_URL` is required for webhook delivery. Notification delivery also needs
`APP_ENCRYPTION_KEY` (the same value the api uses) to read the stored provider
credentials; the mail import needs it for the account passwords, plus `STORAGE_ROOT` and
`PROJECT_VAULT_ROOT`.

## Tests

`src/__tests__/unit/` covers the pure logic with no database. `src/__tests__/integration/`
covers what needs one — the notification send reads its config from the database — and
runs against the test DB (`bun run test` loads `.env.test`; the Docker gate runs it
after the api and bot suites). It inserts the rows the api writes in production, the
way `apps/bot` does; there is no api to call.

## Run

- Dev: `bun run dev` at the repo root runs it under turbo alongside api + web
  (watch mode, loads root `.env`).
- Prod: the `worker` service in `docker-compose.yml`.
