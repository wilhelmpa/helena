# Project browser factory

This package provides one persistent Chromium workspace per Plan project. The factory installs shared browser assets, systemd templates, and a loopback router. It does not create or start a shared browser profile.

Each provisioned project receives a private directory below `/home/pw/services/volition-stack/browser/projects/<slug>` containing its Chromium profile, cache, home, Xauthority, and runtime state. Directories use mode `0700`; state and Xauthority files use `0600`. A project restart preserves its profile, cookies, and sign-ins.

All control and display endpoints stay on loopback:

- Chromium CDP: a project-specific `127.0.0.1` port
- x11vnc: a project-specific `127.0.0.1` port
- noVNC/websockify: a project-specific `127.0.0.1` port
- project router: `127.0.0.1:6082`

The X server disables TCP and requires the project's Xauthority cookie. The router accepts only validated project slugs and reads private runtime state without exposing paths, ports, cookies, or tokens.

## Installation and provisioning

```bash
./install.sh
```

The installer copies the pre-extracted x11vnc, noVNC, and websockify runtime from `/home/pw/services/volition-browser`. It installs the project unit templates and starts only the loopback router. A project target starts through the existing canonical Plan `project.provision` job:

```text
volition-project-browser@<slug>.target
```

Provisioning is idempotent. It reuses the project's private runtime state and verifies the exact loopback CDP endpoint. A failed initial health probe causes one bounded target restart before provisioning fails closed.

Plan publishes a project only below its authenticated origin:

```text
https://plan.volition.one/browser/projects/<slug>/vnc.html
```

The gateway routes `/browser` to the loopback router. Cloudflare Access remains the public authentication boundary; no CDP, VNC, or noVNC port is exposed directly.

## Hermes control

The Hermes catalog reads the same project's private runtime descriptor and supplies:

```text
BROWSER_CDP_URL=http://127.0.0.1:<project-cdp-port>
```

to that project's runner. Hermes therefore controls the same Chromium process and persistent profile shown in Plan. The catalog rejects symlinks, mismatched project identities, unsafe permissions, and non-loopback descriptors. The browser toolset must be enabled.

Persistent profiles improve normal sign-in continuity. They do not guarantee that CAPTCHAs, device challenges, or site-specific bot protection will never require human action.

## Operations

```bash
systemctl --user status volition-project-browser@<slug>.target
systemctl --user restart volition-project-browser@<slug>.target
systemctl --user stop volition-project-browser@<slug>.target
systemctl --user status volition-project-browser-router.service
```

Stopping or restarting a target never clears its profile. Profile deletion is a separate destructive lifecycle action. Project deletion likewise does not silently erase saved logins.
