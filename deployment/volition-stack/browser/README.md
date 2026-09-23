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
| `project-browser-screencast.mjs` | the live view: screencast frames out, mouse and keyboard input in |
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
frames: JPEG, sent on repaint only, at most 20 a second, each prefixed with the size of the
page's viewport in CSS pixels, which takes the page zoom into account. A viewer that has not
drawn its last two frames misses the next ones and gets the newest when it catches up. Viewers
send mouse, wheel, key and paste messages as JSON (the format is at `viewerMessage` in
`project-browser-screencast.mjs`) and the size of their view. While someone watches, the window
keeper sizes the browser window so the page has the size of the most recent viewer's view, and
the agent works on the page the person sees; once the last viewer leaves, the window fills the
screen again. A viewer that stops answering pings for 30 seconds is dropped. The router refuses
a WebSocket whose `Origin` is another host. The stream shows the page only: `<select>` popups,
JavaScript dialogs and Chromium's own menus are drawn by the browser outside the page and need
the VNC view.

The Hermes catalog passes the same project's `BROWSER_CDP_URL=http://127.0.0.1:<port>` to the
project coordinator, so Hermes controls the Chromium profile shown in Plan.

```sh
systemctl status volition-project-browser@<slug>.target
systemctl restart volition-project-browser@<slug>.target
systemctl status volition-project-browser-router.service
```

Restarting a browser keeps its profile and sign-ins. Deleting the project moves the profile to
the trash, which is purged after its retention period.
