# Project browser

Each Helena project gets one persistent Chromium on its own KasmVNC display. Provisioning
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
| `project-browser-video.mjs` | the H.264 encoder (ffmpeg) and its quality tiers |
| `project-browser-mp4.mjs` | ffmpeg's FLV output read tag by tag and written out as fragmented MP4, one fragment per frame |
| `project-browser-input.mjs` | the viewers' messages and the order their input reaches the page in |
| `websocket.mjs` | the server side of WebSocket for the live view |
| `bin/wait-for-x` | `/usr/local/libexec/volition-wait-for-x`, the `ExecStartPre` of the Chromium unit |

The video path needs `ffmpeg` on the host, built with `libx264` (`ffmpeg -encoders | grep libx264`);
Debian's own package has it. Without it — or if the encoder ever fails — the live view falls back
to the JPEG screencast below.

The KasmVNC and Chromium units and the polkit rule that lets `volition-hermes` start, stop and
restart them are in `../native/systemd/`; `../native/install-browser.sh` installs KasmVNC and
those units. With agent isolation (`../native/isolation.sh apply`) they run as `volition-browser`
(drop-in `browser-user.conf`), which alone owns the profiles, and the provisioning service has
the launcher write the state as that user
(`../integration/project-browser-state.mjs`), and isolated agents reach neither CDP nor the
profiles (`../isolation/README.md`).

The router accepts only validated project slugs and reads the private runtime state without
exposing paths, ports, cookies or tokens. Chromium CDP, the display and the router listen on
loopback only. Nginx publishes a project's display below the authenticated Helena origin:

```text
http://kingston-server.local/browser/projects/<slug>/vnc.html
```

The browser tool shows the live view by default and the display over VNC on request. The live
view is a WebSocket on the same authenticated path:

```text
ws://kingston-server.local/browser/projects/<slug>/api/screencast
```

Chromium runs at device scale factor 2 on its display (`--force-device-scale-factor=2` in its
unit; the Xvnc display is 3840x2160, so a window filling the screen still shows a 1920x1080 CSS
pixel page). A page is drawn with two display pixels per CSS pixel, so a viewer on a
high-density screen gets its frames one to one, while window sizes, the screen and CDP input stay
in CSS pixels (DIP). The window keeper reads the factor from the windows it measures
(`readWindowSizes`), so a Chromium started without the flag is kept at factor 1, sharp only at
ratio 1. The live view used to emulate ratio 2 with `Emulation.setDeviceMetricsOverride` and
`scale: 2`, which halved the position of every CDP mouse event — the viewer's and the agent's.

The router attaches to the tab in front, follows tab switches, and streams DevTools screencast
frames: JPEG, sent on repaint only, each prefixed with the size of the page's viewport in CSS
pixels. A viewer that has not drawn its last two frames, or has 16 MiB waiting, misses the next
ones and gets the newest when it catches up. Viewers send mouse, wheel, key, paste and dialog
messages as JSON (the format is at `viewerMessage` in `project-browser-input.mjs`) and the CSS
size and pixel ratio of their view. Pointer moves and wheel turns that arrive while the page is
busy are merged. A viewer that stops answering pings for 30 seconds is dropped. The router
refuses a WebSocket whose `Origin` is another host.

A viewer that can play it gets H.264 video instead: ffmpeg grabs the page's area of the display
(in display pixels) and encodes it at the viewer's ratio as FLV, which the router rewrites as
fragmented MP4 the moment each frame arrives, one fragment per frame (ffmpeg's own MP4 muxer
held every frame back until the next one; and ffmpeg's input probing kept its first frames
queued in front of every later one until `-fflags nobuffer` dropped them). The grab's BGR to YUV
conversion runs in the tier's threads (at 4K and 60 fps: 87 % of a core instead of 132 % in one
thread, a quarter of the time per frame). A viewer plays the video with Media Source Extensions
(plain HTTP, the LAN today) or decodes it itself with WebCodecs (a secure context — HTTPS, or
Chromium's `--unsafely-treat-insecure-origin-as-secure`, which the kiosk sets); the client picks
whichever the page has (`videoPlayback` in `apps/web/src/utils/liveVideo.ts`). Viewers that
cannot or do not want to play video get the JPEG screencast at the same time; an encoder that
fails gives every viewer JPEG and is tried again after 5 s, doubling up to a minute, or at once
for a new page size. `docs/helena-decisions/browser-live-view.md` compares this with neko,
Selkies and others, with the measurements.

Video is adaptive: three quality tiers (`TIERS` in `project-browser-video.mjs`) trade resolution,
frame rate, encoder quality and thread count for how little bandwidth and CPU they need, from
"high" (the capture's own size, 60 fps) down to "low" (854 px long edge, 18 fps). A viewer
reports its round trip and the bytes it is receiving; the router puts it on the best tier its
numbers afford (`chooseTier`), dropping at once but rising only one step at a time. A viewer
more than its allowance behind (`videoAllowance`: two of its tier's recent keyframes plus what
the tier sends while a stats report comes back, at least 512 KiB — a fixed 512 KiB was less than
one keyframe at ratio 2 and cut the best tier to one frame every two seconds) waits for the next
keyframe. Viewers on the same tier of the same stream share its encoder — at most one ffmpeg
per tier, per project browser, never one per viewer — and a tier with no viewer left on it stops
its encoder, so nothing encodes while nobody is watching. A covered view (another panel, or the
browser tab itself backgrounded) tells the router it is hidden and gets no frames until it is
shown again, at which point it gets a fresh keyframe burst at once.

The page's size has one authority per browser. By default it follows the viewers: the page takes
the CSS size of the shown view someone most recently worked in (it changed size, or was pressed
or typed in — handed over once their input pauses for 800 ms, so no gesture lands on a page laid
out anew), and every other view shows the page scaled. A view that holds the size ("Größe
festhalten" in the browser bar, per device) only scales. The browser gateway, or any other
controller, can fix a working size while an agent steers — `setViewportAuthority(port, "fixed",
{width, height}, holder)` in `project-browser-screencast.mjs`, `setProjectViewportAuthority` in
`project-router.mjs`, or `POST api/viewport {"mode":"fixed","width":1440,"height":900,
"holder":"…"}` (1440x900 by default); `{"mode":"follow"}` hands it back. The viewers are told the
page's size, zoom and whether it is fixed (`{"type":"page"}`) and draw each frame one to one when
the page has their view's size, scaled to fit otherwise. The web client sends its view's size
once it has not changed for 300 ms, never while hidden, and again on every new connection.

When the size changes, the encoders stop first and start again on the new page once it has its
size and has drawn it, so no viewer sees the page mid-layout; the viewers keep their last frame
meanwhile. A page narrower than a window can be (Chromium keeps windows 500 DIP wide, so a
phone's view) is pinned at its width inside the window, and its JPEG frames are sent as kind 3 so
the view shows only the page. The window keeper never clears an emulation while a live view is
watched: a clear after the window changed size gave the page the size it had before (a 3839
pixel wide page in a 1280 pixel window), which after a router restart also kept the live view on
JPEG. Every clear is followed by a one-pixel nudge of the window, and a page whose size disagrees
with its window is nudged as well. For 15 s after the router starts the keeper leaves the windows'
size alone, so a live view that reconnects finds its page as it was.

The live view can follow the tab the agent is working in instead of the tab in front (a toggle in
the browser bar, on by default, sent as `{"type":"follow","agent":true|false}`).

## Browser gateway (agents)

Agents drive their project's browser only through the browser gateway, which runs inside this
router (`browser-gateway-server.mjs`, code in `packages/browser-gateway`; design:
`docs/volition-design-browser-gateway.md`, tool decision: `docs/helena-decisions/browser-tools.md`).
It speaks Playwright MCP's tools (`browser_navigate`, `browser_snapshot`, `browser_click`, …) plus
Helena's own (`browser_acquire`/`_release`, `browser_handover`, `browser_login`/`_login_code`,
`browser_downloads`), through the MCP server `projekt-browser`, a stdio shim installed as
`/usr/local/libexec/helena-browser-mcp`.

- One Unix socket per project: `/run/volition-browser/gateway/<slug>/gateway.sock` (directory
  0750, socket 0660, group `volition-agents`). The isolation launcher binds only the project's own
  directory into an agent's unit, at `/run/volition-agents/browser`, where the shim looks by
  default; without isolation the Hermes catalog passes `BROWSER_GATEWAY_SOCKET`. Only the
  Home-Master reaches Home's socket, and only through it may a call name another project.
- Every call is resolved by Helena (`/internal/browser-gateway/*`, service token from
  `BROWSER_GATEWAY_TOKEN_FILE`, installed by `native/install-browser-gateway.sh`): the agent's
  key, its project, whether it has the tool, the project's settings. Every call that is not a read
  is decided by Helena's policy on its action category (a click that submits a form is `send`) and
  audited in the project's activity.
- The control lock: one holder per browser (an agent by name, or the owner). An agent's first
  page action takes it when the browser is free; `browser_acquire` waits. The live view shows
  "Steuert: …" with "Übernehmen", and "Zurückgeben" for the owner (`POST api/lock-takeover`,
  `api/lock-release`), asks before the owner's first input goes into a page an agent steers, and
  after 10 idle minutes. While an agent holds the lock the page has the project's working size
  (`setViewportAuthority(port, "fixed", size, agentName)`, 1440x900 by default, Projekt →
  Einstellungen → Browser); with the owner or nobody it follows the live view again.
- `browser_handover` shows "Bitte übernehmen" in the live view and as a card in Freigaben with a
  link to the live view (`?tool=browser`), and waits until the owner took over and gave control
  back.
- Downloads go through Chromium's download flow into `/var/lib/volition/project-browser/downloads`
  (the router's `TMPDIR`, writable by the browser units) and from there through Helena into the
  project's `Inbox` (Home: `Home/Inbox`). Uploads are read by the shim with the agent's own rights
  and sent as bytes.
- Home → Browser shows every project browser as a tile (`GET api/overview` of the router, a
  thumbnail per browser from `api/thumbnail`).

- Local and private addresses (localhost, the LAN, `*.local`, names resolving inside) are closed
  to agents unless the project opens them ("Lokale Adressen erlauben"). Links and redirects inside
  a page are caught only while the project has a domain list; for the rest the container pins
  `kingston-server.local` to 127.0.0.1 in `/etc/hosts`, so a project browser that opens Helena is
  never signed in as the owner (the LAN auto sign-in never applies to loopback).
- Without agent isolation the runner hands each agent its project's socket as
  `BROWSER_GATEWAY_SOCKET`, from the installed catalog script
  (`/usr/local/libexec/volition-hermes-catalog.py`) when the runner starts. Enabling the gateway
  for an agent later needs no restart; a new catalog script does (deploy.sh installs it and
  restarts the runner; in dev mode that is a manual step).
- `native/install-browser-gateway.sh` creates what is missing and never changes a directory that
  exists (`/etc/volition` keeps its 0751; `install-browser-gateway.test.mjs` here).

With the gateway on for an agent, the runner removes Hermes' own `browser` toolset and the
`browser-harness` MCP server from its profile. The built-in "Hermes-eigener Browser (alt)" (off by
default) keeps both for an agent that needs the old way; only then does Hermes drive the
Chromium directly over the catalog's `BROWSER_CDP_URL` (with agent isolation on, a unit cannot
reach a browser's DevTools port at all).

With "Hermes-eigener Browser (alt)", the agent works on the page the person sees through
browser-harness. It takes screenshots in window pixels and clicks at CSS pixels read from them, and Hermes halves a screenshot until its long edge is at
most 1568 pixels: a page at ratio 2 whose long edge is under 785 CSS pixels would put its clicks
off by 2. So while an agent is in the browser (its session marks the tab title with 🐴, noticed at
once) or acts, such a page is pinned at ratio 1, and so is a page this small once nobody watches.
When the agent acts (trusted input on the page that did not come from a viewer, or a
navigation), the page keeps its CSS size, and a JPEG stream drops to ratio 1, quality 75 and at
most 20 frames a second, for 30 seconds after its last action: a 2x JPEG stream at full rate fills
the browser's DevTools connection, which the agent's commands then wait for. A new view size is
applied once the agent is quiet. A viewer's own click is recognised as its own (the page records
the press before the router has sent the release).

The stream shows the page only. JavaScript dialogs are shown in the live view and answered from
it; `<select>` popups, file choosers and Chromium's own menus are drawn by the browser outside
the page and need the VNC view.

```sh
systemctl status volition-project-browser@<slug>.target
systemctl restart volition-project-browser@<slug>.target
systemctl status volition-project-browser-router.service
```

Restarting a browser keeps its profile and sign-ins. Deleting the project moves the profile to
the trash, which is purged after its retention period.
