# Service worker delivery

`/sw.js` is a public static script. The tunnel template and the strict LAN renderer serve
this exact path from the web server without an authentication subrequest, cookies or
authorization headers. Every other path retains its existing authentication checks.

The public entry returned HTTP 302 to the Cloudflare Access login on September 30, 2026.
The origin change cannot override an Access redirect at the edge. In Cloudflare, create a
more specific Access application for `helena.volition.one/sw.js` with a Bypass policy for
Everyone. If the managed tunnel's origin also verifies Access, give this exact path its own
published application before the general hostname route, pointing to the same nginx entry,
with origin Access verification disabled for that path only. Keep the general hostname's
Access policy and origin verification enabled.

After the owner applies these settings and the origin change, an unauthenticated HEAD
request to `https://helena.volition.one/sw.js` must return 200 with a JavaScript content type
and no Location header. Check an unrelated protected path still requires authentication.
Then renew the existing push device in an authenticated browser; no login is required to
fetch the script itself.
