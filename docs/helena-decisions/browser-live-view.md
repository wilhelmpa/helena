# Decision: how Helena streams a project browser to the live view

Date: 2026-09-24 · Branch: `hub/browser-live-4` · Status: decided

## The job

The browser tool shows the page of a project's Chromium, the same browser the project's agents
work in, in a panel of the Helena web app. The owner and the agents take turns controlling it.
The design is `docs/volition-design-browser-perfekt.md` §3.1–3.3 (orchestrator docs). It asks for:

- Frames that are sharp one to one at every pixel ratio.
- The right page size after every change.
- No flicker.
- Clicks accurate to within 1 CSS px.
- Frames under 100 ms old and input under 80 ms over WLAN.
- Several viewers at once.
- A fixed working size while an agent steers.

The browser runs headful on its own X display (KasmVNC), with a persistent profile per project.

## Candidates

| | What it streams | Transport / client | Size and input model | Fit for Helena |
|---|---|---|---|---|
| **CDP screencast** (OpenClaw, browserless liveURL, Browserbase) | the page, JPEG per repaint, ack-based backpressure | WebSocket, canvas | page CSS pixels, exact | Simple and exact. Measured on the bench: 1280x800 at 60 fps and 29–58 ms on the LAN, but 2560x1600 costs 219 Mbit/s and 33 fps (104 ms). Over WLAN from the Mac it managed only 10 fps at 273 ms input latency. Too heavy for sharp 2x over WLAN. |
| **neko** (Apache-2.0) | the whole X desktop | WebRTC, needs UDP/TURN; its own client, users and control model | desktop pixels, one desktop size | Replaces the desktop view, not the page view. It knows nothing of the page's CSS size, the agent's page size, or the page's pixel ratio. It adds WebRTC/TURN to a LAN and tunnel setup. |
| **Selkies** (MPL-2.0) | the whole X desktop | WebSocket by default (WebRTC optional); GStreamer pipeline, GPU oriented | desktop pixels | The same page/desktop mismatch as neko. It brings a large GStreamer stack for what ffmpeg already does here, and there is no GPU in the container (no `/dev/dri`). A reasonable future replacement for the KasmVNC **desktop** view. |
| **Steel** live view | the whole headful session; moved from CDP screencast to WebRTC at 25 fps so native popups show | WebRTC, hosted | desktop | Confirms the direction (grab the real display, encode video), but it is a hosted product, not a component. |
| **This branch**: CDP screencast **and** H.264 of the page's display area | the page: JPEG, or H.264 grabbed with `x11grab` and encoded by `libx264` (ffmpeg), fragmented MP4 per frame | WebSocket; WebCodecs in a secure context, Media Source Extensions otherwise | page CSS pixels, exact; Chromium at device scale factor 2 | Standard parts (CDP, ffmpeg/x264, fMP4, MSE, WebCodecs); the router is the glue plus Helena's own rules (viewport authority, agent safety, per-project routing behind Helena's auth). |

## Measurements that decided it (bench on Kingston, and the Mac over WLAN through an SSH tunnel)

- **Accuracy and flicker** (the real `WorkspaceBrowserLive` in a headless viewer). Both video (WebCodecs and MSE) and JPEG got 90/90 clicks per mode with an error of 0.00 CSS px. That held at dpr 1, 2 and 3 (touch), in follow, hold (letterboxed) and fixed 1440x900 mode, and after a router restart. There were 0 blank frames over a 3 s panel drag, 10 navigations, 5 tab switches and a router restart, and no page relayout during the drag.
- **Latency from the Mac over WLAN** (dpr 2, 2560x1600 frames):

  | Path | fps | Frame age p50/p95 | Input → display p50/p95 | Bandwidth |
  |---|---|---|---|---|
  | H.264/WebCodecs | 56 | 20/143 ms | 41/113 ms | 4.8 Mbit/s |
  | JPEG | 10 | 178/228 ms | 273/382 ms | 66 Mbit/s |

- **CPU on Kingston:** H.264 at 4K60 takes about 160 % of one core, and 1280x800 at 2x about 80–100 %.

## Choice

Keep the page-level stream with **video as the default and JPEG as the fallback** ("Automatisch").
Video meets the latency target over WLAN at 2x, which JPEG misses by far, and it is as exact and as
flicker-free as JPEG in the acceptance tests. Both paths use the same CDP input and the same
viewport controller.

The desktop-level streamers (neko, Selkies) solve a different problem, the whole desktop. They
would not do the page-exact work the live view needs with less code. Selkies is the candidate if
the **desktop** view (KasmVNC today) is ever replaced.

What would change this decision:

- A GPU in the container, which would make hardware H.264 (VA-API) worth it and perhaps Selkies.
- A requirement to show native browser UI (select popups, permission prompts) in the live view.
  The desktop view covers it today.
- HTTPS on every origin. That makes WebCodecs available everywhere; the plain-HTTP LAN uses MSE,
  which is about 20 ms slower.
