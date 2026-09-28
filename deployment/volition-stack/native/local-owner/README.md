# Personal sign-in on the home network

Helena uses each person's own session on the LAN and kiosk. Without a session, choose a
saved name or enter an account and authenticate with a password, passkey or configured
identity provider. Saved names contain no session or permissions. A valid personal session
opens Home automatically; switching person signs out and returns to the chooser.

The server default is `HELENA_LOCAL_SIGN_IN_MODE=personal`, including when the variable is
absent. Historical `LOCAL_SINGLE_USER_*` settings alone do not authenticate anyone.

After deploying the family access change, apply the personal mode through the normal ops
account, from the deployed checkout, after checking for in-flight work:

```sh
sudo python3 deployment/volition-stack/native/local-owner/configure.py --personal
```

The script preserves the existing hostname, writes personal mode to the API and web
environment and removes the network capability from the LAN and kiosk maps. It does not
print the retained rollback token. It validates nginx and restarts API/web when needed.
Revoke existing owner sessions during this cutover: older automatic LAN sessions are
ordinary sessions and cannot reliably be distinguished from password sessions. Confirm the
owner's working password or passkey first. Do not invite another person before cutover.

`--single-user` is an explicit compatibility mode for a genuinely single-person instance.
Both API and web require this value. The API also refuses it whenever more than one human
account exists, even when the other account is inactive. Agent bot users do not count.
This mode is inappropriate for a shared family installation. A token rotation without
`--single-user` keeps personal sign-in as the safe default.

Existing host protections remain: nginx overwrites incoming capability headers, strips
capabilities on the public backend, and the tunnel uses its own listener and verified Access
assertion. In compatibility mode, only the exact LAN listener and non-self LAN sources get a
capability; kiosk access also requires its UID firewall guard. No capability reaches a browser.

Cloudflare sign-in requires its entry proof, a valid assertion, an explicit identity allowlist
and an existing active human account. Members additionally require a verified account email.
It creates no account or membership. A browser's Helena identity must match its Access identity;
a mismatch requires fresh sign-in. Service API keys retain their existing independent flow.

For rollout, account and project grants and the real two-person acceptance, see
`docs/helena-decisions/family-access-item11.md`. No downloads or new authentication service
are needed.
