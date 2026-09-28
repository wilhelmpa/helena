# Project browsers on demand, Full HD display

Stand: 28.09.2026 · Branch `hub/browser-ondemand` · Auftrag: `docs/plan-lokal-halogen.md`, Phase 6 Punkt 1.

## Problem

Every provisioned project had its browser running all the time: KasmVNC (`Xvnc`, a
3840x2160 display) and Chromium (device scale factor 2), live nine of them (elli, fam, home,
p6brow26, priv, res, trade, verve, vol). Read-only live measurement on 28.09. (PSS of every
process in the two units' cgroups): about 0.6 GB for the nine Chromiums and 0.6 GB for the nine
displays, around 1.2 GB together, although only one or two browsers are ever watched or used
at once. Only ffmpeg already ran solely for a viewer. With the local model holding most of the
memory, the owner wants the browsers on demand.

## Decision

1. **Start on use, stop after idle, in the router.** The browser router already is the one
   process that serves every use of a project browser (live view, toolbar, desktop view, the
   agents' gateway) and already tracks use (`BrowserIdle`: viewers, the control lock, last
   action). It gains `BrowserPower` (`deployment/volition-stack/browser/project-browser-power.mjs`):
   `ensure(slug)` starts `volition-project-browser@<slug>.target` (and its two units by name)
   through systemd and waits for DevTools; `BrowserIdle` stops the target once nobody watched it,
   no agent held its lock and nothing used it for the idle time. Browsers marked "immer an" are
   started and kept running by the same poll (also after a boot: the router is enabled; the old
   boot restore of every browser is retired).
2. **systemd stop keeps the tabs.** Chromium ends on SIGTERM like on a shutdown and saves its
   session; its unit starts it with `--restore-last-session`. Logins stay in the profile. No
   extra tab store: the existing Chromium session restore is what the reboots relied on already.
3. **polkit, not a root helper.** The router's user (`volition-browser` with isolation,
   `volition-hermes` without) may start and stop exactly the per-project target and its two
   units (`native/systemd/61-helena-browser-on-demand.rules`), the same mechanism provisioning
   uses (`60-volition-project-browser.rules`).
4. **Settings in Helena.** One instance setting (`app_setting` `browser-power`): idle minutes
   (default 15, 0 = never) and the projects kept running, plus Home's browser
   (Helena → Einstellungen → Browser, `BrowserPowerSettingsPage`). The router reads it by slug
   from `GET /internal/browser-gateway/power` (gateway token) every minute and keeps a copy in its
   state directory.
5. **Display Full HD, factor 2 kept.** `Xvnc -geometry 1920x1080` instead of 3840x2160. Chromium
   stays at device scale factor 2 so a Retina viewer still gets frames one to one: the window
   keeper sizes windows to the live view's or the agent's page, not to the display, and Chromium
   draws a window larger than the display in full. Measured (see below): frames and clicks are
   exact up to 1720x1000 CSS pixels on a 1920x1080 display. The video path already grows the
   display to the area it grabs (`fitScreen`, xrandr `--fb`, maximum 32768x32768).

## Alternatives rejected

- **systemd socket activation of the CDP/websocket ports**: Chromium cannot take its DevTools
  socket from systemd, and KasmVNC's websocket neither; a proxy socket per port would add a
  process per browser for what the router already sees.
- **`StopWhenUnneeded=` / a timer per browser**: systemd does not know about viewers, agents or
  the gateway's lock; the router does.
- **Keeping the browsers and only freezing pages** (the existing `Page.setWebLifecycleState`):
  saves CPU, not the memory of the display and the renderer processes.
- **Headless Chromium for agents**: agents and the owner must share one visible browser (live
  view, "Übernehmen"), design `volition-design-browser-perfekt.md` §1.
- **Display at factor 1 (Full HD, 1920x1080 CSS)**: blurry on every high-density screen, and
  emulating factor 2 halved CDP input coordinates (measured on 24.09.).
- **A root helper to start units**: polkit already scopes this per unit name.

## Behaviour details

- The live view of a stopped browser is accepted at once and told
  `{"type":"browser","state":"starting"}`; the web shows "Browser startet …" (over the last
  frame, if any), `"running"` once it runs, `"failed"` (and a close) if not, after which the view
  reconnects as after any drop. What the view sent meanwhile (its viewport) is replayed.
- Agents: every gateway tool call runs `ensure` first (a use; the tool waits up to 45 s) and gets
  "The project browser did not start in time. Try again in a moment." when it does not.
- The overview never starts a browser (`power` per browser, tiles say "Pausiert · Startet beim
  Öffnen"); its thumbnail answers 404 for a stopped browser. The toolbar's tab list and actions
  start it (they are shown only with the live view).
- A browser stopped behind the router's back (an admin, a crash past the restart limit): a use
  re-checks a running browser after 5 s and starts it; a failed use re-checks at once.
- The worker's reconciliation re-provisions a project whose browser is *failed*, no longer one
  that is merely stopped (`createProjectBrowserStatus`).
- Without `PROJECT_BROWSER_ON_DEMAND=1` (the router's unit sets it) nothing changes: every
  browser is taken to run, as before.

## Measurements

Test bed on Kingston, never the live units: the repo's units in `wilhelmpa`'s systemd user
manager (same ExecStart; `User=` and the system sandbox dropped, `RestrictAddressFamilies` kept —
KasmVNC fails with "Address already in use" when it may also bind IPv6), own state root, display
:901, ports 47201/47401, the real router with on-demand on (`~/agent-work/bod/{setup.sh,e2e.mjs}`).

| What | Result |
|---|---|
| Live view opens a stopped browser | told "starting" after 5 ms; DevTools up after 0.5–0.8 s; first frame after 0.9 s (2 restored tabs) to 5.9 s (12 restored tabs) |
| Idle stop (bed: 1 min) | both units inactive 65–70 s after the last viewer left; overview says `stopped`; memory 0 |
| Restart after the stop | all tabs back (2/2, 12/12, same URLs), first frame 0.6 s / 6.3 s |
| Toolbar tab list on a stopped browser | starts it, 200 after 0.5 s (2 tabs) / 6.9 s (12 tabs) |
| Display (Xvnc) PSS, unwatched | 3840x2160: 62 / 77 / 96 MiB · 1920x1080: 22 / 40 / 16 MiB |
| Display (Xvnc) PSS, watched at 1440x900 CSS, factor 2 | 3840x2160: 123 / 118 / 124 MiB · 1920x1080: 45 / 69 / 69 MiB |
| Chromium PSS | 44–913 MiB, dominated by the pages and how long they ran, not by the display size (same window size in both) |
| CPU of a running, unwatched browser (frozen pages) | 0.7–2 % of one core |
| A stopped browser | 0 MiB, 0 processes, 0 CPU |

Sharpness and click accuracy on the Full HD display (`HELENA_PROOF_SCREEN=1920x1080 node
project-browser-resize-x11-proof.mjs`): views 620x632, 1280x680, 800x632, 1440x900, 1720x1000
and back all gave JPEG frames of exactly view × 2 and 5/5 clicks (corners and centre) within
1 CSS pixel, the same as on 3200x2000.

Live, read-only, before: nine browsers ≈ 1.2 GB PSS (Chromium 44–127 MiB each, displays 56–100
MiB each). With on demand, an unused browser costs nothing; the Full HD display saves about
40–55 MiB per running browser on top.
