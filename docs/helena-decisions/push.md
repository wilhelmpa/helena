# Decision: push to the owner's phone and desktop (Web Push)

Date: 2026-09-25 · Branch: `hub/push` · Status: decided and built

## The job

On 2026-09-25 at 16:21 one disk of the RAID dropped out. Helena showed it in red on Start, and
nowhere else; the owner was away from his desk and learned nothing. Owner decision the same
day: **"Push aufs Handy"**. Helena must reach his phone and his computers on its own, with no
third-party app or account: Web Push to Helena's own installed web app.

What has to reach him, each switchable per device:

| Category | Default | What |
|---|---|---|
| **Notfälle** (`emergencies`) | on | The machine: a degraded or rebuilding mirror, a failing disk or spare running out, serious mdadm/smartd reports, a failed backup, backup check or restore test, a CPU too hot, the thermal guard, EFI partitions that differ or are not mounted, the host helper silent, a Helena service down. Once when it appears, once when it is over, at most a reminder after 12 hours. |
| **Freigaben** (`approvals`) | on | An agent asks for an approval (to everyone who may decide it). |
| **Braucht dich** (`needs-you`) | off | The other red things: a model login to sign in again, important security checks failing, a local model server down while local AI is on, a failed run, a failed chat answer. |
| **Agenten-Antworten** (`agent-replies`) | off | An agent's chat answer is ready while the person is not looking at Helena. |

Emergencies are detected on the server (the api), every minute, whether or not anyone has
Helena open.

## The standards

- **Web Push** as the browsers implement it: the Push API and service workers in the page,
  RFC 8030 (the protocol to the push service: TTL, Urgency, Topic), RFC 8291 (payload
  encryption, `aes128gcm`, RFC 8188) and RFC 8292 (VAPID: the server identifies itself with a
  signed ES256 JWT). The push services are the browsers' own (Apple, Google FCM, Mozilla,
  Microsoft); nothing else and no account is involved, and they only ever see ciphertext.
- **Platforms:** Chrome, Edge, Firefox and Safari on desktop; Chrome and Firefox on Android;
  **iPhone and iPad from iOS 16.4, only for a web app added to the home screen** (Safari offers
  no Push API in a tab). The manifest (`app/manifest.ts`, `display: standalone`, icons from
  `public/brand`) already makes Helena installable.
- **A secure context is required** (https, or `localhost`/`127.0.0.1`). Helena on plain
  `http://kingston-server.local` cannot subscribe; the settings page says so. Push goes live
  with the Cloudflare/HTTPS step (`helena.volition.one`).

### Library: `@block65/webcrypto-web-push` (MIT)

| | `@block65/webcrypto-web-push` | `web-push` | `@pushforge/builder` | our own |
|---|---|---|---|---|
| License | MIT | MPL-2.0 (allowed) | MIT | — |
| Crypto | WebCrypto (same in Bun, Node, browsers) | `node:crypto` ECDH + `asn1.js` + `jws` | WebCrypto | — |
| Sends itself | no: builds headers and body, we send | yes, its own `https.request` | no | — |
| Dependencies | 1 (`uint8array-extras`) | 5 | 0 | — |
| Maintenance | 2.0.0 on 2026-09-03 | last release 3.6.7, Jan 2024 | 2.0.5, Apr 2026 | — |
| Adoption | ~70k/week | ~6.7M/week (the reference) | ~60k/week | — |

Chosen: **@block65/webcrypto-web-push**. It only builds the request, so the request goes
through Helena's SSRF guard (`@repo/net` `pinnedFetch`: https only, public addresses only,
DNS pinned) with our timeout and our retry, and a test hands in a fake push service. It pads
every payload to the 4096 bytes every push service must accept (so the length says nothing
about the content). Verified on Kingston under Bun 1.4.2: its output decrypts with `http_ece`
(the reference implementation `web-push` itself is built on) and its JWT verifies; the
package's own test keeps that cross-check.

Rejected: `web-push` (fine licence and the reference, but it brings its own HTTP client, so no
SSRF guard and no injectable transport, node-only crypto, and no release since January 2024),
`@pushforge/builder` (equivalent, less active), writing RFC 8291 ourselves (no reason to).

## How it fits Helena (§3a, framework first)

### Two extension points in `@helena/sdk` (`notifications.ts`)

- **`notificationCategories`** (`NotificationCategory`: id, label, description, `defaultOn`,
  `audience` owner|everyone, order, urgency, TTL). Helena's four are registered by the internal
  plugin `helena.push`; a plugin adds its own under its id and it appears on the settings page
  with a switch per device.
- **`alertSources`** (`AlertSource`: id, category, `graceSeconds`, `collect()` → the problems
  that are red now, each with a stable key, a subject, a text and a path in Helena). Helena
  watches every source; a plugin (a UPS, a ZFS pool) gets the same once-open/once-resolved
  behaviour by registering one. Host capabilities (`hostCapabilities`) are already covered: the
  built-in server source turns every capability's critical health line into an alert, so a
  plugin's host capability pushes without any push code.
- Manifest `provides.notificationCategories` / `provides.alertSources`, host registrars,
  `normalizeAlertItem` for what a plugin hands over (bounded keys, texts, only paths inside
  Helena).

### Push is one more channel of the notification outbox

`notification_delivery` (the outbox of email and Telegram) takes `channel = 'push'`:
`recipient` is the device (`helena_push_subscription.id`), `project_id` is null (a push
belongs to a person, not a project; a check keeps it required for the other channels), and
`payload.push` carries the rendered message. A partial unique index on (recipient,
`payload->>'dedupeKey'`) for pending push rows makes queuing the same message twice a no-op.

- **Enqueue** (`@helena/push` `enqueuePush`): one row per device that has the category on; the
  text is written here, in the device's language (`packages/locales/messages/<locale>/
  push.json`, ICU MessageFormat via `intl-messageformat`, all 10 languages). A caller pays one
  insert; nothing waits for a push service.
- **Drain** (`processPushDeliveries`): claim with `FOR UPDATE SKIP LOCKED` and a lease, send,
  delete on success. 429/5xx/network → retry with equal-jitter backoff (or the service's
  `Retry-After`), at most `HELENA_PUSH_MAX_ATTEMPTS` (5); 404/410 → the device is gone and
  removed with its waiting messages; 400/401/403/413 → failed for good (kept a week). A row
  older than its TTL is dropped unsent. The device keeps `last_success_at`, `failure_count`
  and the push service's last answer for the settings page.
- **Both the api and the worker drain push rows** (`background.ts` loop `push-deliveries`,
  2 s; the worker's tick). An emergency like "worker down" must still leave; the email and
  Telegram drain skips push rows. When the api itself is down no emergency is detected; that
  is the limit of an in-app watcher (see "Not covered").
- The TTL, Urgency and Topic headers come from the category: emergencies and approvals
  `high` (wakes a dozing phone), a day; needs-you 12 h, agent answers an hour. The topic is a
  hash of the tag, so an alarm and its recovery replace each other at the push service while
  the phone is offline; the tag does the same on the lock screen.

### Alerts: once when it appears, once when it is over

`apps/api/src/modules/push/alerts.ts`, a loop in the api (`push-alerts`, every
`HELENA_PUSH_ALERT_INTERVAL_MS` = 60 s). State in `helena_alert`, one row per problem
(`<source>|<key>`): opened, last seen, last notified, resolved.

- A problem is pushed once it has lasted its **grace period** (source default 90 s; the
  machine 60 s; services 240 s, because a deploy restarts every service; EFI differences
  15 min, because a kernel update rewrites them). A blip inside the grace resolves silently.
- While it stays open nothing is pushed; after `HELENA_PUSH_REMINDER_HOURS` (12) one reminder
  ("Noch offen … Seit 12 Stunden."), then again 12 hours later.
- It is **resolved only by a successful read** that no longer reports it, and then announced
  ("Wieder in Ordnung: …", urgency normal) only if it was announced. A source that throws
  (the host helper times out, one capability could not be read) changes nothing: a helper
  that stops answering is not a recovery. A helper that answered before and went silent is an
  emergency of its own (`helena.hostd`).
- A mirror that goes from degraded to rebuilding stays one alert (the text updates, no new
  push) and is resolved when the mirror is whole.
- Every step that pushes first moves the row with a conditional update, so two api replicas
  checking at the same moment push once.
- Recipients: the instance owners (role `god`). Alerts are about the instance.

### Events

The internal plugin subscribes (in process, in the api) to `helena.approval.requested` (the
people who may decide, `approvals/service.ts` `deciders`), `helena.chat.message` (assistant
answers; success → agent-replies, failed → needs-you, to the thread's person, **only while
nobody looks**) and `helena.run.failed` (needs-you, owners). The subscriber only queues; a
failure is logged and never fails the change that caused it. It is not durable (an api crash
between the change and the insert loses the push, not the change); the send is.

"Not looking" is presence, not guesswork in the service worker (a push must always show a
notification, or Safari revokes the subscription): a visible page of Helena reports itself
every minute (`PUT /account/push/presence`, only for a person with a device that wants
answers), and a hidden page says so at once. `helena_push_presence` holds `visible_until`.

### Keys and subscriptions

- **VAPID key pair**: generated with WebCrypto on first use, stored encrypted in `app_secret`
  under `push.vapid` (AES-256-GCM, bound to its row, like every other secret; needs
  `APP_ENCRYPTION_KEY`), the public half mirrored in the row's redacted part. Never logged,
  never returned except the public key. Two processes racing store one pair
  (`insertSecretIfAbsent`). `rotateVapidKeys()` exists for a leaked key: it removes every
  subscription, and each device subscribes anew the next time Helena opens there. The JWT's
  `sub` is `HELENA_PUSH_SUBJECT`, else the app's public https origin, else `mailto:` the
  owner's address (Apple refuses anything that is neither).
- **`helena_push_subscription`**: endpoint (unique), device key, auth secret, the VAPID key it
  was made with, label ("iPhone · Safari"), user agent, language, categories per device,
  expiry, last success/failure. Endpoint and keys are stored in plain: without the VAPID
  private key they send nothing, and a leak of them lets nobody push. Subscribing checks the
  endpoint (https, no credentials, not local or private) and the key sizes; the address it
  resolves to is checked again on every send.
- **Routes** (`/account/push…`, the signed-in person's own, not MCP tools): an API key or an
  MCP token is refused (an agent must not route the owner's emergencies to its own endpoint),
  and every change must come from the app's origin.

### Web

- `public/sw.js`: shows every push (title, body, tag, renotify, requireInteraction, icon), opens
  the page on a click (focuses an open tab and navigates it, or opens one), renews a subscription
  the push service replaced (`pushsubscriptionchange`, with the API's address from its own URL).
  No fetch handler and no cache: the app loads exactly as without it. CSP gained
  `worker-src 'self'` (a worker cannot carry the script nonce).
- Konto → **Benachrichtigungen** (`/account/notifications`): "Push auf diesem Gerät" (switch,
  categories for this device, "Test senden"), "Deine Geräte" (each device with its push service,
  categories, last delivery or error, a menu to switch its categories, test and remove), and a
  clear hint for plain http, iPhone/iPad in a Safari tab, blocked notifications and a server
  without key.
- `PushSync` (in the providers, renders nothing): registers the worker where push works,
  renews a device made with an older key, keeps its language current, reports presence, routes
  a click in a tab the worker does not control yet. A subscription the server does not know
  stays off: removing a device on the Mac is not undone by the phone.

## What the owner does once HTTPS is live

- **iPhone / iPad (iOS 16.4+):** open `https://helena.volition.one` in Safari → Teilen →
  „Zum Home-Bildschirm" → open Helena from the home screen → Konto → Benachrichtigungen →
  "Push-Nachrichten" on → allow. "Test senden".
- **Android (Chrome or Firefox):** open the https address (optionally "App installieren") →
  Konto → Benachrichtigungen → on → allow → "Test senden".
- **Mac / Windows (Chrome, Edge, Firefox, Safari):** the same; on a Mac the system settings
  must allow notifications for the browser.
- Choose per device what it receives (the phone: Notfälle + Freigaben; the desk: maybe more).

## Not covered (on purpose, or later)

- **Helena itself down:** if the api or Postgres stops, nothing detects anything. An outside
  heartbeat (a dead man's switch that pushes when Helena stops checking in) needs a second
  place to run; with Cloudflare in front, a Cloudflare Worker cron or healthcheck could do it.
- Mail as a channel (no mail provider yet), third-party push services (ntfy, Pushover).
- Workflow approval steps are not pushed yet (only agents' approval requests); a
  `helena.pipeline.*` event would make it one more subscriber.
- A device that subscribes while a problem is already open is told at the next reminder, not
  at once.
