# Project browser

Each Plan project gets one persistent Chromium on its own KasmVNC display. Provisioning
(`integration/project-browser.mjs`) creates the private state below
`/var/lib/volition/project-browser/projects/<slug>` and starts
`volition-project-browser-kasm@<slug>.service` and
`volition-project-browser-chromium@<slug>.service`. Deprovisioning stops both units and moves
the state to the project trash. Directories use mode `0700`; `runtime.json`, `runtime.env` and
`Xauthority` use mode `0600`.

This directory holds the router and the display wait helper:

| File | Use |
| --- | --- |
| `project-router.mjs` | the loopback router on `127.0.0.1:6082`, run by `volition-project-browser-router.service` from the checkout with the modules next to it |
| `project-browser-control.mjs` | DevTools connection, window keeper, tab list and toolbar actions |
| `project-browser-screencast.mjs` | the live view: video and screencast frames out, page size, quality tiers, agent activity, dialogs |
| `project-browser-video.mjs` | the H.264 encoder (ffmpeg) and its quality tiers, and the MP4 box reading the fragments need |
| `project-browser-input.mjs` | the viewers' messages and the order their input reaches the page in |
| `websocket.mjs` | the server side of WebSocket for the live view |
| `bin/wait-for-x` | `/usr/local/libexec/volition-wait-for-x`, the `ExecStartPre` of the Chromium unit |

The video path needs `ffmpeg` on the host, built with `libx264` (`ffmpeg -encoders | grep libx264`);
Debian's own package has it. Without it — or if the encoder ever fails — the live view falls back
to the JPEG screencast below, for as long as the page's size stays the same.

The KasmVNC and Chromium units and the polkit rule that lets `volition-hermes` start, stop and
restart them are in `../native/systemd/`; `../native/install-browser.sh` installs KasmVNC and
those units. They run as `volition-browser`, which alone owns the profiles; with agent isolation
the provisioning service has the launcher write the state as that user
(`../integration/project-browser-state.mjs`), and isolated agents reach neither CDP nor the
profiles (`../isolation/README.md`).

The router accepts only validated project slugs and reads the private runtime state without
exposing paths, ports, cookies or tokens. Chromium CDP, the display and the router listen on
loopback only. Nginx publishes a project's display below the authenticated Plan origin:

```text
http://kingston-server.local/browser/projects/<slug>/vnc.html
```

The browser tool shows the live view by default and the display over VNC on request. The live
view is a WebSocket on the same authenticated path:

```text
ws://kingston-server.local/browser/projects/<slug>/api/screencast
```

The router attaches to the tab in front, follows tab switches, and streams DevTools screencast
frames: JPEG, sent on repaint only, each prefixed with the size of the page's viewport in CSS
pixels and the time it was drawn. A viewer that has not drawn its last two frames, or has
16 MiB waiting, misses the next ones and gets the newest when it catches up. Viewers send
mouse, wheel, key, paste and dialog messages as JSON (the format is at `viewerMessage` in
`project-browser-input.mjs`) and the CSS size and pixel ratio of their view. Pointer moves and
wheel turns that arrive while the page is busy are merged. A viewer that stops answering pings
for 30 seconds is dropped. The router refuses a WebSocket whose `Origin` is another host.

When every viewer's browser can play it, the router streams H.264 video instead: ffmpeg grabs
the page's area of the display and encodes it as fragmented MP4, one fragment per frame, which
a viewer plays with Media Source Extensions (plain HTTP, the LAN today) or decodes itself with
WebCodecs (a secure context — HTTPS, or Chromium's `--unsafely-treat-insecure-origin-as-secure`
for a test origin — which the Cloudflare tunnel will make of the live one later); the client
picks whichever the page has (`videoPlayback` in `apps/web/src/utils/liveVideo.ts`). A viewer
that cannot play video, or an encoder that fails, falls back to the JPEG screencast above for as
long as the page's size stays the same.

Video is adaptive: three quality tiers (`TIERS` in `project-browser-video.mjs`) trade resolution,
frame rate, encoder quality and thread count for how little bandwidth and CPU they need, from
"high" (the capture's own size, 60 fps) down to "low" (854 px long edge, 18 fps). A viewer
reports its round trip and the bytes it is receiving every few seconds; the router puts it on the
best tier its numbers afford (`chooseTier`), dropping at once but rising only one step at a time.
Viewers on the same tier of the same stream share its encoder — at most one ffmpeg per tier, per
project browser, never one per viewer — and a tier with no viewer left on it stops its encoder,
so nothing encodes while nobody is watching. A covered view (another panel, or the browser tab
itself backgrounded) tells the router it is hidden and gets no frames until it is shown again, at
which point it gets a fresh keyframe burst at once rather than waiting out the tier's keyframe
interval; the same burst is how a fresh viewer, or a viewer whose tier just changed, starts
without a wait either.

The live view can follow the tab the agent is working in instead of the tab in front (a toggle in
the browser bar, on by default, sent as `{"type":"follow","agent":true|false}`); a small,
read-only "agent is acting" indicator reuses the same activity signal the stream's own size and
rate already track. Neither is a lock: the live view has no notion yet of who is allowed to act,
only of who last did: the actual control lock, its "Übernehmen" banner and its "Steuert: …" label
arrive with the browser gateway (see `docs/volition-design-browser-gateway.md` §5), which this is
built not to conflict with.

While someone watches, the window keeper sizes the browser window to the most recent viewer's
view, and the tab in front is drawn at pixel ratio 2 for a high-density screen (JPEG quality
90, as many frames as the page draws), so the page looks like a tab of the viewer's own
browser. Ratio 2 is used only when the view's long edge is at least 785 CSS pixels: Hermes
halves a screenshot until its long edge is at most 1568 pixels and clicks at CSS pixels read
from it, so a 2x screenshot of a smaller page would put its clicks off by 2.

The agent works on the page the person sees. When it acts (trusted input on the page that did
not come from a viewer, or a navigation), the page keeps its CSS size and is streamed at ratio 1,
quality 75 and at most 20 frames a second for 30 seconds after its last action: a 2x stream at
full rate fills the browser's DevTools connection, which the agent's commands then wait for
(about 200 ms each instead of 1 ms). A new view size is applied once the agent is quiet. When
the last viewer leaves, the page keeps its CSS size at ratio 1; a desktop (VNC) viewer has the
window fill the screen again.

The stream shows the page only. JavaScript dialogs are shown in the live view and answered from
it; `<select>` popups, file choosers and Chromium's own menus are drawn by the browser outside
the page and need the VNC view.

The Hermes catalog passes the same project's `BROWSER_CDP_URL=http://127.0.0.1:<port>` to the
project coordinator, so Hermes controls the Chromium profile shown in Plan.

```sh
systemctl status volition-project-browser@<slug>.target
systemctl restart volition-project-browser@<slug>.target
systemctl status volition-project-browser-router.service
```

Restarting a browser keeps its profile and sign-ins. Deleting the project moves the profile to
the trash, which is purged after its retention period.
