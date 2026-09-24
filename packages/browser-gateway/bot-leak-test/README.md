# Bot-signal leak test (design §7 / §10.2, Abnahme §9.4)

The spike that had to pass before the rest of the browser gateway was built: does
patchright-core, connected with `connectOverCDP` to a real, headed, unmodified system
Chromium (no `--enable-automation`, no launch by the gateway itself), leave any of the
classic automation fingerprints a site could use to detect it?

`leak-test.html` implements the checks named in the design doc:

| Check | What it looks for |
|---|---|
| `webdriver` | `navigator.webdriver === true` |
| `console-getter-trick` | a getter invoked synchronously by a CDP client's console-argument preview |
| `error-stack-getter-trick` | the same, via an `Error#stack` getter |
| `sourceURL-trace` | a synthetic `//# sourceURL=` marker (Puppeteer/Playwright's classic `evaluate()` pattern) surfacing in a captured stack trace |
| `bindings` | a global left by `Runtime.addBinding`/`exposeBinding` (`__playwright*`, `__puppeteer*`, `cdc_*`, ...) |
| `ua-consistency` | informational only — UA/platform/language/timezone, to eyeball rather than fail on |

Two of these (`console-getter-trick`, `error-stack-getter-trick`) did **not** discriminate
on the Chromium build this was run against (153.x): the getter is not invoked either way,
which looks like an upstream fix independent of any automation tool. They are kept because
the design doc names them and a future Chromium could differ; `sourceURL-trace` and
`bindings` are the two checks proven to actually catch something (see the negative controls
below) and are what the positive result really rests on.

## Negative controls (prove the checks are real)

A check that always reports "clean" is worthless. Two scripts drive the *classic*
Puppeteer/Playwright pattern over raw CDP (no patchright) and confirm the page's own checks
catch it:

- `negative-control-cdp.mjs`: `Runtime.enable` + `Runtime.evaluate` with a synthetic
  `//# sourceURL=__puppeteer_evaluation_script__...` — must report `sourceURL-trace: leak
  true`.
- `negative-control-binding.mjs`: `Runtime.addBinding` — must report a
  `__playwright_binding__...`-shaped global present.

## Positive test

`patchright-check.mjs` connects with patchright-core's `chromium.connectOverCDP(...)` (the
same call the gateway itself makes — see `../src/session.ts`) to the already-running
Chromium, drives the page's login form through the ordinary locator API (`fill`/`click`,
not `evaluate`, mirroring what the gateway's own tools use), then runs the leak checks —
inline, not by calling a page-authored `window.*` function, because patchright's own
`evaluate()` runs in an isolated world and cannot see a main-world global (itself a useful,
if incidental, first finding: patchright's evaluate does **not** share a JS realm with the
page's own script). Must report every check `leak: false`.

## Running it

Needs a real, already-running, headed Chromium — nothing here launches one. On Kingston,
under an agent's own `~/agent-work/<name>` directory (never `/tmp`, per the project's
working rules):

```sh
export XAUTHORITY=$PWD/Xauthority
Xvfb :93 -screen 0 1920x1080x24 -nolisten tcp -auth "$XAUTHORITY" &
node serve.mjs 18566 &                     # a tiny static server for leak-test.html — see below
DISPLAY=:93 chromium --ozone-platform=x11 \
  --user-data-dir=$PWD/profile \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=19566 \
  --no-first-run --no-default-browser-check \
  --window-size=1280,900 \
  http://127.0.0.1:18566/ &

node negative-control-cdp.mjs 19566 http://127.0.0.1:18566/       # expect sourceURL-trace: leak true
node negative-control-binding.mjs 19566 http://127.0.0.1:18566/   # expect a __playwright_binding__... global
node patchright-check.mjs 19566 http://127.0.0.1:18566/           # expect every check: leak false
```

`serve.mjs` is not checked in here (it's a five-line `node:http` static file server for
`leak-test.html`, trivial to recreate); any static server works, including opening the file
directly with `file://` for a quick check (only the CDP port and page URL matter to the
scripts above).

Both CDP and HTTP ports must not collide with another agent's or a live unit's own —
`ss -tlnp` first, same as any other test environment on the shared Kingston host.

Not part of `bun test` (needs a real browser); this is a manual, documented spike/regression
artifact, the same category as `../live-e2e.manual.ts` and `../full-e2e.manual.ts`.
