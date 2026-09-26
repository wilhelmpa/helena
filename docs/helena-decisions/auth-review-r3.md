# Authentication review R3

Authentication counts callers without a trusted client address in Better Auth's shared
per-path bucket. Only session reads and the capability-protected local-owner endpoint are
exempt. The proxy must overwrite `X-Real-IP` and restrict direct API access. The installed
Better Auth 1.6.27 implements both the missing-IP bucket and the top-level
`twoFactor.allowPasswordless` setting; no library update or auth schema migration is required.

Passwordless accounts can enroll and disable TOTP. Password accounts still supply their
password for those operations. Email and username password sign-ins, including the normal
login form reached after an SSO refusal, honor `twoFactorRedirect`. A password reset also
reports an incomplete sign-in when TOTP is pending.

Credential report masking includes SSH private keys and web-login TOTP seeds. Replaced and
deleted values remain encrypted in existing `app_secret` rows under a team-specific
`agent-mask.<teamId>.<uuid>` key. They are never returned through the credential API. The
retention period is the greater of one day, the configured run lease, and the configured
chat lease, plus the 30-second mask refresh interval. This exceeds the supported two-hour
run budget. Expired entries are removed when that team's mask is loaded. Row locks preserve
intermediate values during concurrent rotations. A cache reset or API restart reloads the
retained values from the database. Deletion, retention, and the deletion audit entry share
one transaction; failed or out-of-scope deletion produces no deletion audit.

The tunnel service denies every destination except loopback, its configured public DNS
resolvers, and the global Cloudflare tunnel edges. This excludes home networks that use
globally routed IPv6 prefixes. Edge ranges follow Cloudflare's
[required tunnel destinations](https://developers.cloudflare.com/tunnel/configuration/),
checked 2026-09-26. The service uses the global region, not the separate US/FedRAMP regions.
Optional software-update and management diagnostics destinations are not allowed; automatic
updates are already disabled. Remote application origins outside this allowlist require an
explicit operator policy change.

The local-owner configurator verifies the loaded `inet helena_kiosk` output rejection rule
and the actual kiosk UID before reading or writing the owner configuration or nginx listener.
An absent, weakened, or ambiguous rule aborts without adding an owner listener. Origin
configuration keeps no backup on a no-op apply, and rollback selects the newest backup from
before the target HTTPS origin rather than a later HTTPS reconfiguration.

## Deployment and live acceptance

Only the root orchestrator deploys after the shared gate and in-flight check. There are no
new dependencies, downloads, account actions, or migrations.

- API/web changes deploy normally. Keep the existing app encryption key unchanged.
- Update `helena-cloudflared.service`, run `systemctl daemon-reload`, and restart the tunnel
  in the deployment window. `install.sh --apply service` updates the unit but its
  `enable --now` does not restart an already-running connector: explicitly restart it.
- Verify the actual unit's `IPAddressDeny=any` and expected allows, connector `/ready`, and
  an authenticated owner HTTPS request. Prove kernel egress rejects a home global IPv6
  address while the tunnel still connects. Do not create a Cloudflare dashboard route.
- Check the kiosk rule via JSON and run the configurator's `require_kiosk_guard()` without
  running `main()`. Confirm a non-kiosk local user cannot connect to 127.0.0.1:8088.
- Do not enroll/change the owner's TOTP, reset a password, or rotate a real credential for
  testing. The isolated integration tests exercise these operations with synthetic values.
- `/code-review ultra` remains an owner-only second review step.

## Validation

Regression coverage includes missing/empty/invalid IP headers, spoofed untrusted forwarded
headers, passwordless TOTP enrollment/disable, password-protected enrollment, email/username
2FA, password-reset 2FA, current/legacy GCM tag truncation, SSH/TOTP masking, concurrent
credential rotations, delete/cache-reset retention, configured long leases and expiry,
truthful deletion audit, the shared edge/cross-site error model, kiosk rule prerequisites,
global home IPv6 blocking, fingerprint normalization and repeated apply/rollback.

Focused checks on the isolated Kingston copy (PostgreSQL 55566): API 91/91,
owner-terminal/edge follow-up 15/15, web login 4/4, auth/crypto 30/30, and Python
native-script tests 20/20. API, web, auth and crypto typechecks and changed-file lint pass.
Mutation checks prove that restoring the missing-IP bypass, nested passwordless option,
missing retention, or omitted GCM tag length makes the corresponding regression fail.
Logs are in `~/agent-work/review-r3-tmp/`; no live deployment was performed by this worker.
