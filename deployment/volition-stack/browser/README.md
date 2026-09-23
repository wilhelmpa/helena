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
| `project-browser-screencast.mjs` | the live view: screencast frames out, page size, agent activity, dialogs |
| `project-browser-input.mjs` | the viewers' messages and the order their input reaches the page in |
| `websocket.mjs` | the server side of WebSocket for the live view |
| `bin/wait-for-x` | `/usr/local/libexec/volition-wait-for-x`, the `ExecStartPre` of the Chromium unit |

The KasmVNC and Chromium units and the polkit rule that lets `volition-hermes` start, stop and
restart them are in `../native/systemd/`; `../native/install-browser.sh` installs KasmVNC and
those units.

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
