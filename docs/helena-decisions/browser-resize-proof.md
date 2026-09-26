# Project browser resize proof

The opt-in native proof is
`deployment/volition-stack/browser/project-browser-resize-x11-proof.mjs`.
Run it as an unprivileged user with existing Node, Chromium, Xvfb and the
browser workspace's `ws` dependency. It requires no installation or GPU.

```sh
~/agent-work/heavy.sh --class server timeout -k 5s 100s \
  node deployment/volition-stack/browser/project-browser-resize-x11-proof.mjs
```

It creates a private display, temporary Chromium profile, synthetic loopback
page and loopback project router. Runtime state contains only this fixture.
The viewer uses the actual screencast WebSocket route with free owner control,
follow-agent enabled and hold-size disabled. It does not call `setLiveViewport`
directly. It never opens a production profile, route, project or provider.

The checks cover 620×632 → 1280×680 → 800×632 → 620×632 CSS pixels, then a
viewer disconnect, page freeze, reconnect and another maximization. Each step
requires actual page geometry at DPR 2, matching native window bounds and at
least three complete JPEGs whose independently parsed pixel dimensions match.
Changing image hashes establish fresh animation. A viewer click is verified
through the fixture counter, and the original single tab must remain.
Transitional cropped or lower-resolution JPEGs are permitted while resizing;
they cannot satisfy the final assertions. The proof is bounded to 90 seconds
and stops its own router, Chromium and Xvfb. Temporary synthetic profiles and
logs remain available for inspection.

## Evidence, 2026-09-27

The exact baseline `68430b23` failed the native initial-size check: actual
1050×837 at DPR 2, unknown toolbar, while the viewer received an announced
620×632 page. A diagnostic copy of `b85a9143` identified the timing failure:
the probe measured outer 1042×972 / inner 1042×829, toolbar 143. Immediately
after restoration the outer size was 1050×980 while the inner size remained
1042×829. That stale read was considered plausible with toolbar 8×151 and
prematurely failed the final calibration check.

Waiting for the restored page's measured toolbar fixes this demonstrated
race. The native full path then passed twice, including a run on the final
product code: maximized CSS 1280×680, native bounds 1280×823 DIP and fresh
2560×1360 JPEGs. The delayed-inner-size regression fails against `b85a9143`
and passes with the fix. Router and owner-resize tests: 45 passing.

Server evidence is under `~/agent-work/browser-maximize-jpeg/`:
`baseline-proof.log`, `calibration-diagnostic.log`,
`candidate-settled-proof.log` and `candidate-final-proof.log`.
These prove a private native failure and correction. Actual owner UI
maximization after deployment remains required; this is not an authentication,
video-encoder or production-tab acceptance test.
