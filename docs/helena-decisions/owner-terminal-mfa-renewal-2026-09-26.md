# Owner terminal MFA renewal

A valid terminal TOTP failed with HTTP 409 when the same browser session already
had an expired or revoked grant. Verification succeeded, but INSERT conflicted
with the existing unique index on `owner_terminal_grant.session_id`. The dialog
reported every failure except rate limiting as an invalid code.

Renewal now updates the existing session grant after verification. A lock on the
owner row serializes replacement across sessions, and prior active grants are
revoked. Renewal updates the creation and expiration timestamps and clears the
revocation marker. The single-grant-per-session schema remains unchanged.

Terminal verification uses an already confirmed authenticator factor. Initial
factor enrollment stays in Account → Security, where better-auth can return its
rotated browser cookies. Known invalid-code responses remain HTTP 400 and count
toward the existing five-attempt limit; incomplete setup is HTTP 409 with a distinct
code, and technical verification failures are HTTP 503 without provider exception
text. The UI distinguishes these cases. No MFA rule, validity window or permission
is weakened.

## Validation

The new renewal regression fails against the original service with expected HTTP
200 / received HTTP 409. The fixed service passes renewal after expiration and
revocation, preserves a closed grant for an invalid code and leaves an incomplete
factor's session unchanged. API and unit tests: 14 passed, 83 assertions. Web error
mapping: one passed. Final type, lint and formatting results accompany the commit.

Root's scoped live evidence before the fix: eight step-up requests returned 409;
the existing grant had expired, the referenced browser session still existed, the
factor was verified and system time was synchronized. No OTP, factor secret,
backup code, session token or login body was inspected.

## Root acceptance

Run the normal shared gate and deploy. Keep MFA enabled. The owner enters a fresh
code through the existing Home terminal dialog; never ask them to send it in chat.
Confirm HTTP 200, a live grant in the same browser session and the expected owner
terminal UI. Observe only timestamps/statuses and grant metadata. A wrong code must
still fail without renewing the grant. If the owner cannot perform this final
interactive check immediately, report it as pending rather than reading their
factor secret or generating a real code.

Local-model inference capabilities prepared separately must bind both the grant
ID and its creation/expiration version, because a renewed grant now retains its ID.
