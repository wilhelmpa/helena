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
