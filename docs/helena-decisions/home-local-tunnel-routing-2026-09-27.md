# Home local terminal tunnel routing

## Confirmed failure

At live `18f1b079`, Root completed Cloudflare sign-in and fresh terminal MFA. The
new `local-qwen36/main` tab requested
`https://helena.volition.one/focus/owner-terminal/local-qwen36/main/` and showed a
refused iframe. Root observed a cross-origin `dispatchEvent` SecurityError.

Read-only inspection confirmed that the installed native owner-terminal snippet
already included both local presets, while the separate installed
`/etc/nginx/sites-available/helena-tunnel.conf:126` and its source template still
allowed only the five earlier presets. The local URL therefore selected the
general Next.js route, whose `frame-ancestors 'none'` policy prevents embedding.
The live nginx configuration passed `nginx -t`; syntax checking alone did not
detect the missing route.

The fix adds the two local presets to the existing tunnel route. Its edge/session
and MFA checks, per-kind signed token, origin check, Unix socket and browser
credential stripping remain intact. The tunnel also uses the native snippet's
404 rule for public bootstrap/inference capability paths. No API, router, MFA,
model, agent default or credentials change is required.

## Isolated evidence

`tests/test_owner_terminal_routing.py` starts a private real nginx with synthetic
HTTP authentication/web upstreams and a Unix terminal upstream. It exercises the
actual template and header snippets, without reading any live configuration or
key. Four tests cover 37 cases: seven presets each with HTML, an asset and a
WebSocket upgrade; nine edge/grant/origin refusals; six public capability paths;
and an unknown preset. They verify the per-kind auth path/token, unchanged URL and
stripped browser Cookie/Authorization. The authentication fixture is synthetic;
the real API/MFA proof remains the separately completed Home suite.

All four routing tests passed on Kingston under one `heavy.sh --class test`
slot. Removing the two local kinds reproduced assertion failures. Removing only
the capability block also reproduced assertion failures. Each mutation was
restored byte-for-byte, followed by another passing run. The temporary nginx and
upstreams stop during cleanup. No database or model process was started.
The complete native Cloudflare Python suite also passed on Kingston: 24 tests,
zero failures and zero skips. `git diff --check` passed.

## Root deployment and acceptance

1. Integrate this narrow candidate, run the regular shared full gate, check
   in-flight activity, fast-forward live and run the regular `deploy.sh`. The
   current deploy script does **not** render the Cloudflare tunnel template.
2. Before applying the tunnel configuration, inspect the existing installed site
   and headers against the candidate. Use the existing installer in dry-run mode
   from the deployed checkout:

   ```bash
   sudo deployment/volition-stack/native/cloudflare/install.sh nginx
   ```

   Require exactly the two additional preset names and the capability 404 block
   in the site diff. Require the existing installed headers to equal the checked
   in header snippet. If other customizations appear, reconcile them explicitly;
   do not overwrite the complete tunnel configuration unchecked. Confirm the
   existing entry-proof map/environment are present, restricted and consistent
   with the API/web services using the existing redacted `install.sh check`.
   Do not print either secret file, rotate the proof or create a missing proof.
3. Save the exact existing site, headers and enabled-link target to a private
   Root backup. Then run the existing installer, which also saves a timestamped
   backup, tests nginx and reloads it:

   ```bash
   sudo deployment/volition-stack/native/cloudflare/install.sh --apply nginx
   ```

   Verify exit status, `nginx -t`, nginx/tunnel service health and the installed
   diff. No owner-terminal/API/model restart or new login is part of this fix.
4. Through Root's owner-authenticated browser, reopen the existing local Qwen3.6
   tab. Require terminal HTML and WebSocket success, then normal Codex trust and
   the synthetic built-in read/edit/command proof in
   `home-terminal-combined-acceptance-2026-09-26.md`. Confirm the ordinary shell
   remains usable. Keep actual model/tool execution open until that proof passes;
   a visible menu or terminal is insufficient. Confirm the public capability
   routes return 404 without exposing tokens.

If nginx validation or the live route regresses, restore **only** the saved site,
headers and original enabled-link target, run `nginx -t`, and reload nginx only
after it passes. The installer disables the enabled link on validation failure,
so restoring the original link is part of rollback. Preserve entry-proof files,
Cloudflare policy, sessions, MFA grant and model state. This candidate has not
been applied live by the delegated task.
