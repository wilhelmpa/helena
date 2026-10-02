# Browser worker delivery behind Cloudflare Access

Worker requests do not reliably inherit the service-token headers added to the test
browser's page requests. A redirect to the Access login cannot be used as a service-worker
script or an AudioWorklet module. The origin cannot override an Access response at the edge.
The October 2 unauthenticated HEAD probe still receives 403 for all four tested paths
(`/sw.js`, the manifest, the VAD worklet and code-server's service worker).

The tunnel template and strict LAN renderer expose only these static resources without an
authentication subrequest or browser credentials:

- `/sw.js` (including its `?api=...` query); JavaScript, scope `/`, `Cache-Control: no-cache`.
- `/manifest.webmanifest`; `application/manifest+json`, scope and start URL `/`, no cached
  session data. The document's manifest link retains `crossorigin="use-credentials"`.
- `/voice/vad.worklet.bundle.min.js`, `/voice/silero_vad_v5.onnx`,
  `/voice/ort-wasm-simd-threaded.mjs`, `/voice/ort-wasm-simd-threaded.wasm`.
- `/code/stable-<hex commit>/static/*` and `/code/_static/*`; bundled vendor assets only.
  The code service worker's scope is `/code/`; the upstream path loses only `/code/`.

The VAD files come from the installed vad-web/ONNX dependencies. They have explicit
JavaScript/WASM MIME types, `nosniff` and revalidation headers. The page CSP permits
same-origin workers and WebAssembly; scripts retain their nonce policy. The generated
vendor files are excluded from ESLint, not edited.

Code OSS does not ship the proprietary VSDA browser binaries. The narrowly matched
workbench response skips loading VSDA when no server license exists, using the signing
service's existing unsigned fallback. A licensed server keeps its signing path. No dummy
WASM or signing validator is supplied. Conditional cache headers are stripped from the
workbench request so an upstream 304 cannot reuse the old, uncorrected body. Hard-reload
an already-open editor once at rollout: the unchanged upstream commit may still have
immutable assets in the browser cache. This is separate from Access blocking editor and
extension-worker imports; see [code-server's upstream issue](https://github.com/coder/code-server/issues/7090).

## Cloudflare configuration required from the owner

In Zero Trust → Access → Applications, add more-specific self-hosted applications for the
paths above, each with a Bypass policy including Everyone. Use exact paths for the worker,
manifest and four voice files. For code-server use `/code/_static/*` and a separate
`/code/stable-<installed commit>/static/*` application; update the commit path with a code-server
update. Live 12.16 currently uses VS Code 1.139.1, commit
`53c2f3253bcf32886706fc023e794bbeb253c90f`; its application path is
`/code/stable-53c2f3253bcf32886706fc023e794bbeb253c90f/static/*`. Do not bypass `/code/*`, `/backend/*`, private media, the root document or WebSockets.
Keep the existing hostname-wide Access policies unchanged.

In the managed tunnel's published-application routes, place matching static-path rules
before the hostname catch-all, pointing at the same nginx origin. Disable origin
“Protect with Access” only on these static routes. Keep it enabled on the catch-all.
Use the exact voice paths and the code static prefixes; the catch-all must retain all
other paths. nginx independently limits the public paths even if an edge path pattern is
broader. No Cloudflare setting was changed by this branch.

Access's cookie configuration belongs to the hostname application. Its cookie path must
cover `/` so it reaches `/code/`, `/voice/`, `/sw.js` and the manifest; `HttpOnly` must remain
on. The API's own owner-session cookie uses `Path=/`, `SameSite=Lax` and HTTPS-dependent
Secure; the web bootstrap forwards its Set-Cookie attributes unchanged. Never copy an
Owner cookie into a service-test profile. A normal Owner browser with the Access cookie
and a header-only service-test browser are separate acceptance cases; the latter needs
the static exceptions even when normal browsing succeeds. See
[Cloudflare's authorization-cookie documentation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/).

After deploying the origin change and applying the edge settings, anonymous GET/HEAD
requests to each static path must return 200 without a Location header, with the matching
MIME type and cache header. Check `/`, `/code/`, a project file and `/backend/me` still
require their existing authentication. In a normal Owner browser verify the cookie Path,
manifest loading, root worker registration, push-device renewal, code workers and a spoken
conversation. In the service-test profile check the same worker resources; do not send
service credentials to third-party extension galleries. No test push is sent by this branch.
