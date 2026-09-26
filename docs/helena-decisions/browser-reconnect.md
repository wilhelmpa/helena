# Reconnecting existing project browser tabs

## Failure and regression evidence

A failed `Page.startScreencast` must clear the stream's running flag. Otherwise every later
mode update skips the start, although no frame was produced. Attaching another tab clears that
flag, which explains why opening a new tab can restore the live view. The integration regression
rejects the first CDP start on an existing tab. With the stale flag behavior it receives no frame
and fails; with the fix it receives a frame in about one second and creates no new target.

A reconnect explicitly activates every existing HTTP(S) page before completing the WebSocket
handshake. A partially failed activation remains retryable and returns HTTP 503. It cannot mark
the entire project browser active after waking only one tab.

## Recovery boundaries

The existing Chrome DevTools Protocol connection remains the control mechanism. The official
[Page protocol](https://chromedevtools.github.io/devtools-protocol/tot/Page/) defines lifecycle
activation, screencast start/stop and frame events. No new browser dependency or browser profile
is introduced.

If a started screencast produces no first frame within seven seconds, the router activates that
same page session and stops/starts its screencast once. Another missing first frame ends the
broken transport; Helena's existing WebSocket reconnect with backoff reconnects to the project.
Two rejected screencast starts also end the broken transport. Receiving a frame cancels the
first-frame deadline. Hiding/stopping the stream, changing tabs and ending the transport
invalidate pending recovery. Ordinary quiet pages are not periodically restarted.

Router shutdown closes accepted HTTP/WebSocket/VNC connections, upstream connections, gateway
Unix clients, CDP streams and video encoders. It stops accepting late routes and waits at most
ten seconds for idle wakeups. Repeated shutdown requests share one operation. Chromium and its
project profile remain running; tabs, cookies, active logins and navigation history are retained.

## Idle lifecycle visibility

Chromium's [lifecycle implementation](https://github.com/chromium/chromium/blob/main/content/browser/devtools/protocol/page_handler.cc)
sets WebContents hidden when freezing. Activation only unfreezes it. The selected page can
remain hidden after a router restart and fail to produce fresh frames. Native activation of the
already selected tab does not reliably change that visibility.

After activating every page, the shared browser connection acquires a CDP focus/capture lease
only when the selected page is hidden. The lease makes that page paint for both owner viewers
and agent-only use. Other genuinely visible tabs take precedence over this lease's synthetic
visibility; selecting one releases the previous lease. Closing the last viewer without a holder,
ending the holder without viewers, idle freezing, shutdown and connection loss release it.
Release and wake are serialized, including reopening before the idle deadline and arriving
during release. All HTTP(S) pages remain eligible for the existing two-minute idle freeze.

The [capture implementation](https://github.com/chromium/chromium/blob/main/content/browser/devtools/protocol/emulation_handler.cc)
keeps visibility only for the owning CDP session. A brief true/false toggle does not permanently
repair hidden state. The implementation does not create tabs, reload pages or change the native
selected tab to force a repaint.

Focused regression checks cover agent wake/reacquire, shared viewers, immediate reopen, real
selection versus capture visibility, disconnect, and both wake/release arrival races. The explicit
`deployment/volition-stack/browser/project-browser-idle-x11-proof.mjs` proof runs only against its
own Xvfb display, Chromium profile and synthetic loopback pages with GPU disabled. It is not
part of the default test glob. The native proof passed single-tab and two-tab reconnects with
fresh frames, switching between existing targets, stopping a live JavaScript counter by
re-freezing, and releasing visibility on CDP disconnect. A separate synthetic X11 pixel probe
confirmed native window repainting as well as JPEG frames. No production page was inspected
or changed by these proofs.

These lifecycle and crop changes have no production acceptance claim until the owner-view
idle/restart checks below pass.

## Native crop measurement

Video uses only a verified native toolbar measurement. Unknown or changed geometry invalidates
the previous crop and selects the existing JPEG path. A fresh CDP connection also invalidates
the cache. With authoritative owner/free control and no fixed working viewport, the window
keeper measures the page during a small native bounds change and after restoration. Both
physical page dimensions must follow that change with the same toolbar and display scale.
Startup grace, unknown control and agent/fixed control do not perform this calibration. A
failed identical probe is not repeated; restoration does not overwrite independently changed
window bounds, and a changed live viewport supersedes the pending fit.

Device-metrics overrides belong to CDP sessions. Clearing a fresh session cannot remove an
active foreign override. Detaching a foreign session can reset the effective metrics after the
router set its own pin; Chromium may then skip an identical repeated set. For a known router
pin, owner authority permits clearing that own session before calibrating and applying the
requested pin again. Unproven foreign geometry never becomes a zero-height video crop.

The mock models per-session overrides, identical-set suppression and foreign detach. The
explicit `project-browser-crop-x11-proof.mjs` native proof uses a private GPU-off Chromium
instance. It verifies rejection of an active foreign zero-toolbar tuple, recalibration after
foreign detach, the requested CSS viewport, fresh frames, a real click at CSS coordinates and
restoration to desktop size without changing tab count. Live acceptance must additionally
check panel resizing, maximize/restore and correct toolbar exclusion in Helena.

## Live acceptance

The orchestrator deploys after the full gate and the zero-in-flight check. In VOL and a second
project:

1. Keep the existing target ids and tab count, leave the browser idle for at least two minutes,
   and reopen its live view without adding a tab. Verify a visible frame and interactive input.
2. Switch between two existing tabs and between projects. Verify the expected project profile,
   old page contents and unchanged tab counts.
3. In an idle maintenance window restart only the project browser router with the live view
   open. Verify bounded shutdown and automatic reconnection to the same existing targets.
4. Verify that closing the live view still permits idle page freezing and low idle CPU usage.

The deterministic tests exercise the stale running flag, first-frame recovery limit, stale
session cancellation, all-page activation, failed-handshake refusal and shutdown with live,
desktop and stalled upstream connections. They do not substitute for the actual idle/restart
checks in the owner's browser.

Verification on Kingston: the complete browser suite passes 94 tests with no failures. The
existing-tab regression fails when only the stale running-flag behavior is restored, and passes
with the correction. Tests use an isolated worktree and existing dependencies through the
shared heavy-work throttle. No live browser or service was changed for this verification.
