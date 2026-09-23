# Project browser

Each Plan project gets one persistent Chromium on its own KasmVNC display. Provisioning
(`integration/project-browser.mjs`) creates the private state below
`/var/lib/volition/project-browser/projects/<slug>` and starts
`volition-project-browser-kasm@<slug>.service` and
`volition-project-browser-chromium@<slug>.service`. Deprovisioning stops both units and moves
the state to the project trash. Directories use mode `0700`; `runtime.json`, `runtime.env` and
`Xauthority` use mode `0600`.

This directory holds the two files installed next to the units:

| File | Installed as |
| --- | --- |
| `project-router.mjs` | `/usr/local/libexec/volition-project-browser-router.mjs`, run by `volition-project-browser-router.service` on `127.0.0.1:6082` |
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

The Hermes catalog passes the same project's `BROWSER_CDP_URL=http://127.0.0.1:<port>` to the
project coordinator, so Hermes controls the Chromium profile shown in Plan.

```sh
systemctl status volition-project-browser@<slug>.target
systemctl restart volition-project-browser@<slug>.target
systemctl status volition-project-browser-router.service
```

Restarting a browser keeps its profile and sign-ins. Deleting the project moves the profile to
the trash, which is purged after its retention period.
