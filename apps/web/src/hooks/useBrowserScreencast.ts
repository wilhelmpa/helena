import { useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import { browserTabsQueryKey } from '@/utils/browserControl';
import {
  FREE_CONTROL,
  JPEG_FRAME,
  JPEG_FRAME_CROPPED,
  readFrame,
  screencastUrl,
  VIDEO_FRAGMENT,
  VIDEO_INIT,
  type LiveControlState,
  type LiveDialog,
  type LiveHandover,
  type LiveMessage,
  type Size,
} from '@/utils/browserLive';
import { mseVideo, videoPlayback, webCodecsVideo, type LiveVideo } from '@/utils/liveVideo';

function subscribeVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

// The view's size in CSS pixels and the screen's pixel ratio, which the page is shown at.
export interface LiveViewport extends Size {
  dpr: number;
}

export type ScreencastStatus = 'connecting' | 'live' | 'reconnecting';

// The router streams video to a view that plays it, and JPEG frames otherwise.
export type ScreencastMode = 'jpeg' | 'video';

// The frame on screen: the page's size in CSS pixels at 100 % zoom, which it is drawn at to
// be one to one (natural), and in the CSS pixels input is given in, at the page's zoom (page).
export interface ShownFrame {
  natural: Size;
  page: Size;
}

// The page as the router last announced it: its size in CSS pixels at 100 % zoom, its zoom,
// and whether the browser gateway holds it at a fixed working size while an agent steers.
export interface LivePage extends Size {
  zoom: number;
  fixed: boolean;
  // Who holds the fixed size (an agent, through the browser gateway), when it says.
  holder?: string;
}

const RETRY_FIRST_MS = 500;
const RETRY_MAX_MS = 10_000;
// A view's new size is sent once it has not changed for this long: while the panel is dragged
// the view only scales the last frame, and the page is laid out once, at the size it ends at.
const VIEWPORT_SETTLE_MS = 300;
// A size sent that the page has not taken this long after is sent again, once.
const VIEWPORT_CONFIRM_MS = 3_000;
// A JPEG frame that arrives this soon after a video started was on its way before the router
// switched this view to video; it must not replace the newer video.
const LATE_JPEG_MS = 500;
// How often the round trip is measured, and the connection's stats — including the running
// count of video bytes received, this view's side of the ack the router uses as its main
// backlog signal — are reported to the router, which puts this view on the quality tier they
// afford. Frequent enough that bytes sent but not yet acknowledged stay a small, informative
// number instead of however much a tier sends between reports.
const PING_INTERVAL_MS = 4_000;
const STATS_INTERVAL_MS = 200;
// The downlink is the bytes received over this trailing window, so a burst of a few frames
// does not read as a much faster connection than it is.
const THROUGHPUT_WINDOW_MS = 4_000;
// A decoder this far behind what has arrived gives up on the gap and asks the router for a
// fresh keyframe rather than wait out its tier's own keyframe interval.
const REQUEST_KEYFRAME_LAG_MS = 800;
// A round trip video's own pipeline (encode, transport, decode) this long makes worse to
// control through than the single-frame JPEG screencast, whose latency is close to the round
// trip alone: "auto" then asks for JPEG instead. Recovery uses a lower threshold than falling
// back does (a Schmitt trigger), so a round trip hovering right at one number does not flip
// the mode back and forth on every stats report.
const AUTO_JPEG_RTT_MS = 300;
const AUTO_VIDEO_RTT_MS = 180;

type ServerText =
  | ({ type: 'dialog'; open: boolean } & LiveDialog)
  | {
      type: 'video';
      codec: string;
      tier?: string;
      width: number;
      height: number;
      pageWidth?: number;
      pageHeight?: number;
    }
  | {
      type: 'page';
      width: number;
      height: number;
      zoom?: number;
      fixed?: boolean;
      holder?: string;
    }
  | { type: 'tab' }
  | { type: 'pong'; t: number }
  | ({ type: 'handover'; open: boolean } & Partial<LiveHandover>)
  | ({ type: 'control' } & LiveControlState);

// Who last acted on the page, purely informational (see the router's ScreencastStream).
export type LiveControl = LiveControlState['by'];

// video and jpeg force that stream regardless of the measured round trip; auto (the default)
// follows it, preferring video but falling back to JPEG on a connection where video's own
// extra latency would make it the worse choice (see AUTO_JPEG_RTT_MS).
export type VideoPreference = 'auto' | 'video' | 'jpeg';

const sameSize = (a: Size | null | undefined, b: Size | null | undefined) =>
  !!a && !!b && a.width === b.width && a.height === b.height;

// The live view's connection to the browser router. Video is played as it arrives: on the
// canvas with WebCodecs, or in the video element with Media Source Extensions where WebCodecs
// is missing. JPEG frames are drawn on the canvas, the newest one first, and acknowledged
// after drawing, so the router sends no faster than the view draws. A hidden view plays and
// acknowledges nothing, which stops the JPEG frames, and restarts its video at the next
// keyframe when it is shown again. A dropped connection is opened again, waiting longer after
// each attempt that ends before a frame arrives: the router accepts the connection before it
// reaches the browser.
//
// The view never goes blank: a frame is drawn only once it is decoded, the last one stays
// through a reconnect and a switch between video and JPEG (the video element's last frame is
// copied onto the canvas first), and a JPEG frame late from before a switch to video is
// dropped. The view's size is the one viewport controller: setViewport takes every size the
// view has, and the size is sent once it settles (VIEWPORT_SETTLE_MS), never while the view is
// hidden or empty, not again when unchanged, again when the page has not taken it, and always
// on every new connection.
export function useBrowserScreencast(
  controlBase: string,
  active: boolean,
  reloadToken: number,
  canvas: RefObject<HTMLCanvasElement | null>,
  videoElement: RefObject<HTMLVideoElement | null>,
  followAgent: boolean,
  videoPreference: VideoPreference,
  hold: boolean,
  // Called in the same task a frame is drawn in, before the browser paints it, so the view
  // can place a frame of a new size without showing it stretched for a paint.
  onShown: (frame: ShownFrame) => void,
) {
  const queryClient = useQueryClient();
  const documentVisible = useSyncExternalStore(
    subscribeVisibility,
    () => !document.hidden,
    () => false,
  );
  const [status, setStatus] = useState<ScreencastStatus>('connecting');
  const [mode, setMode] = useState<ScreencastMode>('jpeg');
  const [hasFrame, setHasFrame] = useState(false);
  // Whether the video element shows a frame of the current MSE video; until it does, the
  // canvas keeps showing the frame before it.
  const [videoElementShown, setVideoElementShown] = useState(false);
  // A dialog of the page and an agent's handover request are kept apart: the view shows the
  // dialog first (it has to be answered before anything else), the request once it is gone.
  const [dialog, setDialog] = useState<LiveDialog | null>(null);
  const [handover, setHandover] = useState<LiveHandover | null>(null);
  // Who controls the page: the browser gateway's control lock once it runs, else who last
  // acted on it (see the router's controlMessageFor).
  const [control, setControl] = useState<LiveControlState>(FREE_CONTROL);
  const [page, setPage] = useState<LivePage | null>(null);
  const onShownRef = useRef(onShown);
  useEffect(() => {
    onShownRef.current = onShown;
  }, [onShown]);
  const videoPreferenceRef = useRef<VideoPreference>(videoPreference);
  const holdRef = useRef(hold);
  // What "auto" currently prefers, so a caller can tell an automatic fallback (preference
  // "auto" but mode "jpeg", with playback not null) from asking for JPEG outright, or from a
  // browser that cannot play video at all.
  const autoWantsVideo = useRef(true);
  const socket = useRef<WebSocket | null>(null);
  const pageRef = useRef<LivePage | null>(null);
  const pending = useRef<ArrayBuffer | null>(null);
  const unacknowledged = useRef(0);
  const drawing = useRef(false);
  const shownRef = useRef(active);
  const video = useRef<LiveVideo | null>(null);
  const videoKind = useRef<'webcodecs' | 'mse' | null>(null);
  const videoStartedAt = useRef(0);
  const announced = useRef<{ codec: string; tier?: string; frame: ShownFrame } | null>(null);
  const waitingForKeyframe = useRef(true);
  const playback = useRef(videoPlayback());
  // The viewport controller: the view's latest size, the message last sent on this
  // connection, when it was sent and whether the page has taken it, and the settle timer.
  const view = useRef<LiveViewport | null>(null);
  const lastSent = useRef<string | null>(null);
  const sentAt = useRef(0);
  const confirmed = useRef(true);
  const resent = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The connection's last measured round trip and the bytes received in the trailing window,
  // which the router is periodically told so it can put this view on the tier they afford.
  const rttMs = useRef(0);
  const pingSentAt = useRef<number | null>(null);
  const received = useRef<{ at: number; bytes: number }[]>([]);
  // The running total of video bytes received since the current video (re)started: this
  // view's side of the ack the router uses as its main backlog signal, reported with every
  // stats message. Reset together with the router's own count, in startVideo below.
  const receivedBytesTotal = useRef(0);
  // When the view first started waiting for a keyframe this time, so a wait long enough asks
  // the router for a fresh one instead of waiting out the tier's own keyframe interval; null
  // once asked, so one stall asks once, not on every frame it is still missing one.
  const waitingSinceMs = useRef<number | null>(null);
  const followAgentRef = useRef(followAgent);

  const send = useCallback((message: LiveMessage) => {
    const current = socket.current;
    if (current?.readyState === WebSocket.OPEN) current.send(JSON.stringify(message));
  }, []);

  // A browser that cannot play video at all asks for JPEG regardless of preference; video and
  // jpeg force their stream; auto follows what the round trip currently prefers.
  const wantsVideo = useCallback(() => {
    if (playback.current === null) return false;
    if (videoPreferenceRef.current === 'video') return true;
    if (videoPreferenceRef.current === 'jpeg') return false;
    return autoWantsVideo.current;
  }, []);

  // Sends the view's size unless it is hidden, empty, or the same message was already sent on
  // this connection; force sends it again all the same (a size the page did not take).
  const sendViewport = useCallback(
    (force = false) => {
      const current = view.current;
      const open = socket.current?.readyState === WebSocket.OPEN;
      if (!current || !shownRef.current || !current.width || !current.height || !open) return;
      const message: LiveMessage = {
        type: 'viewport',
        width: Math.round(current.width),
        height: Math.round(current.height),
        dpr: current.dpr,
        video: wantsVideo(),
        hold: holdRef.current,
      };
      const text = JSON.stringify(message);
      if (!force && text === lastSent.current) return;
      const previous = lastSent.current ? (JSON.parse(lastSent.current) as Size) : null;
      lastSent.current = text;
      sentAt.current = performance.now();
      // A new size is confirmed by the page taking it (checkConfirmed); a view that holds the
      // size expects none.
      if (!sameSize(previous, message)) {
        confirmed.current = message.hold;
        resent.current = force;
      }
      send(message);
    },
    [send, wantsVideo],
  );

  // Every size the view takes, as it changes; sent once it settles.
  const setViewport = useCallback(
    (size: LiveViewport | null) => {
      view.current = size;
      clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => sendViewport(), VIEWPORT_SETTLE_MS);
    },
    [sendViewport],
  );

  // The page took the size this view asked for, or holds another on purpose (a fixed working
  // size, or this view holds the size): nothing to send again.
  const checkConfirmed = useCallback((next: LivePage) => {
    const asked = lastSent.current ? (JSON.parse(lastSent.current) as LiveViewport) : null;
    if (!asked) return;
    const near =
      Math.abs(asked.width - next.width) <= 2 && Math.abs(asked.height - next.height) <= 2;
    if (near || next.fixed || holdRef.current) confirmed.current = true;
  }, []);

  const showFrame = useCallback((frame: ShownFrame) => {
    onShownRef.current(frame);
    setHasFrame(true);
  }, []);

  const draw = useCallback(async () => {
    if (drawing.current || !shownRef.current) return;
    const data = pending.current;
    if (data) {
      pending.current = null;
      drawing.current = true;
      try {
        const { size, crop, jpeg } = readFrame(data);
        const bitmap = await createImageBitmap(jpeg);
        const target = canvas.current;
        // A video that started meanwhile is newer than this frame.
        if (target && !video.current) {
          // A cropped frame shows only its left part, the page (see readFrame).
          const width = Math.round(bitmap.width * (crop?.width ?? 1));
          const height = Math.round(bitmap.height * (crop?.height ?? 1));
          if (target.width !== width) target.width = width;
          if (target.height !== height) target.height = height;
          target.getContext('2d')?.drawImage(bitmap, 0, 0, width, height, 0, 0, width, height);
          const zoom = pageRef.current?.zoom ?? 1;
          showFrame({
            natural: {
              width: Math.round(size.width * zoom),
              height: Math.round(size.height * zoom),
            },
            page: size,
          });
        }
        bitmap.close();
      } catch {
        // A frame that does not decode is skipped; the next one replaces it.
      } finally {
        drawing.current = false;
      }
    }
    for (; unacknowledged.current > 0; unacknowledged.current--) send({ type: 'ack' });
    if (pending.current) void draw();
  }, [canvas, send, showFrame]);

  // Ends the current video. An MSE video's last frame is copied onto the canvas first, which
  // shows it until the next frame is drawn, so the view never goes blank.
  const closeVideo = useCallback(() => {
    const element = videoElement.current;
    const target = canvas.current;
    if (videoKind.current === 'mse' && element && target && element.videoWidth > 0) {
      if (target.width !== element.videoWidth) target.width = element.videoWidth;
      if (target.height !== element.videoHeight) target.height = element.videoHeight;
      target.getContext('2d')?.drawImage(element, 0, 0);
    }
    video.current?.close();
    video.current = null;
    videoKind.current = null;
    setVideoElementShown(false);
  }, [canvas, videoElement]);

  const startVideo = useCallback(
    (init: Uint8Array) => {
      closeVideo();
      const current = announced.current;
      if (!current) return;
      const frame = current.frame;
      try {
        if (playback.current === 'webcodecs' && canvas.current) {
          video.current = webCodecsVideo(canvas.current, current.codec, init, () =>
            showFrame(frame),
          );
          videoKind.current = 'webcodecs';
        } else if (playback.current === 'mse' && videoElement.current) {
          video.current = mseVideo(videoElement.current, current.codec, init, () => {
            showFrame(frame);
            setVideoElementShown(true);
          });
          videoKind.current = 'mse';
        }
      } catch {
        // The router keeps sending JPEG frames to a view that shows no video.
      }
      videoStartedAt.current = performance.now();
      waitingForKeyframe.current = true;
      // Starts the stall clock from the moment a fresh video is expected, not only once a
      // (still-gated) fragment actually arrives: on a badly congested connection, nothing may
      // arrive at all for a while, and that silence is itself the stall a keyframe request is
      // meant to cut short, not just a gap between otherwise-flowing fragments.
      waitingSinceMs.current = performance.now();
      // The router's own count for this viewer starts over with every fresh video too (see
      // Viewer.startVideo, which does not count the init segment either), so the ack stays
      // meaningful across a tier or area change instead of comparing against bytes sent under
      // a stream this one replaced.
      receivedBytesTotal.current = 0;
      setMode('video');
    },
    [canvas, closeVideo, showFrame, videoElement],
  );

  const receive = useCallback(
    (data: ArrayBuffer) => {
      const bytes = new Uint8Array(data);
      if (bytes[0] === VIDEO_INIT || bytes[0] === VIDEO_FRAGMENT) {
        const now = performance.now();
        received.current.push({ at: now, bytes: data.byteLength });
        const cutoff = now - THROUGHPUT_WINDOW_MS;
        while (received.current.length && received.current[0].at < cutoff) received.current.shift();
      }
      if (bytes[0] === JPEG_FRAME || bytes[0] === JPEG_FRAME_CROPPED) {
        // A frame that was on its way before the router switched this view to video.
        if (video.current && performance.now() - videoStartedAt.current < LATE_JPEG_MS) {
          send({ type: 'ack' });
          return;
        }
        if (video.current) closeVideo();
        setMode('jpeg');
        unacknowledged.current++;
        pending.current = data;
        void draw();
      } else if (bytes[0] === VIDEO_INIT) {
        startVideo(bytes.subarray(1));
      } else if (bytes[0] === VIDEO_FRAGMENT) {
        // Counted as soon as it arrives, matching Viewer.offerVideo on the router's side,
        // which counts a fragment as sent whether or not this view ends up using it: the ack
        // this feeds is about what the connection has carried, not what got drawn.
        receivedBytesTotal.current += data.byteLength;
        const keyframe = bytes[1] === 1;
        if (!shownRef.current) waitingForKeyframe.current = true;
        if (waitingForKeyframe.current && waitingSinceMs.current === null) {
          waitingSinceMs.current = performance.now();
        }
        if (!shownRef.current || (waitingForKeyframe.current && !keyframe)) return;
        waitingForKeyframe.current = false;
        waitingSinceMs.current = null;
        video.current?.push(bytes.subarray(2), keyframe);
      }
    },
    [closeVideo, draw, send, startVideo],
  );

  // The bytes received for video over the trailing window, as a bitrate: what the router is
  // told the connection currently affords.
  const downlinkKbps = useCallback(() => {
    if (received.current.length < 2) return 0;
    const bytes = received.current.reduce((sum, sample) => sum + sample.bytes, 0);
    const seconds =
      (received.current[received.current.length - 1].at - received.current[0].at) / 1000;
    return seconds > 0 ? Math.round((bytes * 8) / 1000 / seconds) : 0;
  }, []);

  useEffect(() => {
    shownRef.current = active;
    if (active) {
      void draw();
      sendViewport();
    }
  }, [active, draw, sendViewport]);

  // A new choice of stream or of holding the size is sent at once.
  useEffect(() => {
    videoPreferenceRef.current = videoPreference;
    holdRef.current = hold;
    sendViewport();
  }, [hold, sendViewport, videoPreference]);

  // A covered view has no subscriber at all. The connection effect below closes it
  // on panel/document hiding and opens a fresh visible handshake when shown again.

  // Tells the router the streamed tab to follow, again whenever the choice changes.
  useEffect(() => {
    followAgentRef.current = followAgent;
    send({ type: 'follow', agent: followAgent });
  }, [followAgent, send]);

  useEffect(() => {
    if (!active || !documentVisible) return;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let statsTimer: ReturnType<typeof setInterval> | undefined;
    const connect = () => {
      if (stopped || document.hidden) return;
      const current = new WebSocket(screencastUrl(controlBase));
      current.binaryType = 'arraybuffer';
      socket.current = current;
      current.onopen = () => {
        if (stopped || !shownRef.current || document.hidden) {
          current.close();
          return;
        }
        // A new connection — the first one, or one after a reconnect or a restart of the
        // router — declares visibility explicitly before sending its current viewport.
        // Existing clients send the same hidden:false signal just after their viewport.
        lastSent.current = null;
        send({ type: 'hidden', hidden: false });
        sendViewport(true);
        send({ type: 'follow', agent: followAgentRef.current });
        rttMs.current = 0;
        pingSentAt.current = null;
        received.current = [];
        // A fresh connection starts "auto" preferring video again, the same as rttMs above
        // starting over as if the round trip were excellent: both are corrected within one
        // stats report if that turns out to be wrong.
        autoWantsVideo.current = true;
        // A fresh connection's first real round trip is measured right away rather than
        // waiting out the first interval: until it arrives, rttMs stays 0, which the router
        // reads as an excellent connection.
        const ping = () => {
          pingSentAt.current = performance.now();
          send({ type: 'ping', t: pingSentAt.current });
        };
        ping();
        pingTimer = setInterval(ping, PING_INTERVAL_MS);
        statsTimer = setInterval(() => {
          send({
            type: 'stats',
            rttMs: rttMs.current,
            downlinkKbps: downlinkKbps(),
            receivedBytes: receivedBytesTotal.current,
          });
          const since = waitingSinceMs.current;
          if (since !== null && since > 0 && performance.now() - since > REQUEST_KEYFRAME_LAG_MS) {
            // One request per stall: set to a non-null, non-positive value that fails this
            // check without looking like "no stall", so it does not repeat every report
            // until the keyframe it asked for arrives (or a new stall starts one afresh,
            // since receive() only sets waitingSinceMs when it is exactly null).
            waitingSinceMs.current = 0;
            send({ type: 'requestKeyframe' });
          }
          // A size the page has not taken is sent once more.
          if (
            !confirmed.current &&
            !resent.current &&
            performance.now() - sentAt.current > VIEWPORT_CONFIRM_MS
          ) {
            sendViewport(true);
          }
          // "auto" follows the round trip either way: it is measured by ping/pong, which
          // keeps running regardless of which stream is playing, so a connection that has
          // recovered is noticed even while showing JPEG. The two thresholds keep a round
          // trip that hovers near one number from flipping the mode on every report.
          if (videoPreferenceRef.current === 'auto') {
            const rtt = rttMs.current;
            const nextWantsVideo = autoWantsVideo.current
              ? rtt <= AUTO_JPEG_RTT_MS
              : rtt < AUTO_VIDEO_RTT_MS;
            if (nextWantsVideo !== autoWantsVideo.current) {
              autoWantsVideo.current = nextWantsVideo;
              sendViewport();
            }
          }
        }, STATS_INTERVAL_MS);
      };
      current.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
        if (stopped || socket.current !== current) return;
        if (typeof event.data !== 'string') {
          attempt = 0;
          setStatus('live');
          return receive(event.data);
        }
        const message = JSON.parse(event.data) as ServerText;
        if (message.type === 'dialog') setDialog(message.open ? message : null);
        else if (message.type === 'handover') {
          setHandover(
            message.open
              ? {
                  reason: message.reason ?? '',
                  agentName: message.agentName ?? '',
                  since: message.since ?? Date.now(),
                }
              : null,
          );
        } else if (message.type === 'video') {
          const pageSize = { width: message.width, height: message.height };
          announced.current = {
            codec: message.codec,
            tier: message.tier,
            frame: {
              natural: {
                width: message.pageWidth ?? message.width,
                height: message.pageHeight ?? message.height,
              },
              page: pageSize,
            },
          };
        } else if (message.type === 'page') {
          const next: LivePage = {
            width: message.width,
            height: message.height,
            zoom: message.zoom ?? 1,
            fixed: message.fixed === true,
            holder: message.holder,
          };
          pageRef.current = next;
          setPage(next);
          checkConfirmed(next);
        } else if (message.type === 'pong') {
          if (pingSentAt.current === message.t)
            rttMs.current = Math.round(performance.now() - message.t);
        } else if (message.type === 'control') {
          setControl({
            by: message.by,
            agentName: message.agentName ?? null,
            since: message.since ?? null,
            locked: message.locked === true,
          });
        } else void queryClient.invalidateQueries({ queryKey: browserTabsQueryKey(controlBase) });
      };
      current.onclose = () => {
        clearInterval(pingTimer);
        clearInterval(statsTimer);
        if (stopped) return;
        setDialog(null);
        setHandover(null);
        setControl(FREE_CONTROL);
        // The last frame stays: an MSE video's is copied onto the canvas.
        closeVideo();
        setMode('jpeg');
        socket.current = null;
        pending.current = null;
        unacknowledged.current = 0;
        setStatus('reconnecting');
        retry = setTimeout(connect, Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** attempt++));
      };
    };
    setStatus('connecting');
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearTimeout(settleTimer.current);
      clearInterval(pingTimer);
      clearInterval(statsTimer);
      closeVideo();
      if (socket.current?.readyState === WebSocket.OPEN)
        socket.current.send(JSON.stringify({ type: 'hidden', hidden: true }));
      socket.current?.close();
      socket.current = null;
    };
  }, [
    active,
    documentVisible,
    controlBase,
    reloadToken,
    checkConfirmed,
    closeVideo,
    downlinkKbps,
    queryClient,
    receive,
    send,
    sendViewport,
  ]);

  return {
    status,
    mode,
    playback: playback.current,
    hasFrame,
    videoElementShown,
    page,
    dialog,
    handover,
    control,
    send,
    setViewport,
  };
}
