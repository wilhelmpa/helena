import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { browserTabsQueryKey } from '@/utils/browserControl';
import {
  JPEG_FRAME,
  readFrame,
  screencastUrl,
  VIDEO_FRAGMENT,
  VIDEO_INIT,
  type LiveDialog,
  type LiveMessage,
  type Size,
} from '@/utils/browserLive';
import { mseVideo, videoPlayback, webCodecsVideo, type LiveVideo } from '@/utils/liveVideo';

// The view's size in CSS pixels and the screen's pixel ratio, which the page is shown at.
export interface LiveViewport extends Size {
  dpr: number;
}

export type ScreencastStatus = 'connecting' | 'live' | 'reconnecting';

// The router streams video when every viewer can play it, and JPEG frames otherwise.
export type ScreencastMode = 'jpeg' | 'video';

const RETRY_FIRST_MS = 500;
const RETRY_MAX_MS = 10_000;
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
  | { type: 'video'; codec: string; tier?: string; width: number; height: number }
  | { type: 'tab' }
  | { type: 'pong'; t: number }
  | { type: 'control'; by: 'agent' | 'owner' };

// Who last acted on the page, purely informational (see the router's ScreencastStream).
export type LiveControl = 'agent' | 'owner';

// video and jpeg force that stream regardless of the measured round trip; auto (the default)
// follows it, preferring video but falling back to JPEG on a connection where video's own
// extra latency would make it the worse choice (see AUTO_JPEG_RTT_MS).
export type VideoPreference = 'auto' | 'video' | 'jpeg';

// The live view's connection to the browser router. Video is played as it arrives: on the
// canvas with WebCodecs, or in the video element with Media Source Extensions where WebCodecs
// is missing. JPEG frames are drawn on the canvas, the newest one first, and acknowledged
// after drawing, so the router sends no faster than the view draws. A hidden view plays and
// acknowledges nothing, which stops the JPEG frames, and restarts its video at the next
// keyframe when it is shown again. A dropped connection is opened again, waiting longer after
// each attempt that ends before a frame arrives: the router accepts the connection before it
// reaches the browser.
export function useBrowserScreencast(
  controlBase: string,
  active: boolean,
  reloadToken: number,
  canvas: RefObject<HTMLCanvasElement | null>,
  videoElement: RefObject<HTMLVideoElement | null>,
  followAgent: boolean,
) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ScreencastStatus>('connecting');
  const [mode, setMode] = useState<ScreencastMode>('jpeg');
  const [hasFrame, setHasFrame] = useState(false);
  const [dialog, setDialog] = useState<LiveDialog | null>(null);
  const [controlBy, setControlBy] = useState<LiveControl>('owner');
  // video and jpeg force that stream; auto (the default) follows the measured round trip (see
  // AUTO_JPEG_RTT_MS below). Read from a ref inside the stats timer so changing it does not
  // itself reconnect the socket; autoWantsVideo tracks what "auto" currently prefers, so a
  // caller can tell an automatic fallback (videoPreference is "auto" but mode is "jpeg", with
  // playback not null: the browser can play video, the connection is why it is not) from
  // asking for JPEG outright, or from a browser that cannot play video at all.
  const [videoPreference, setVideoPreferenceState] = useState<VideoPreference>('auto');
  const videoPreferenceRef = useRef<VideoPreference>('auto');
  const autoWantsVideo = useRef(true);
  const socket = useRef<WebSocket | null>(null);
  // The page size of the frame shown, which pointer positions are mapped to.
  const frameSize = useRef<Size | null>(null);
  const viewport = useRef<LiveViewport | null>(null);
  const pending = useRef<ArrayBuffer | null>(null);
  const unacknowledged = useRef(0);
  const drawing = useRef(false);
  const shown = useRef(active);
  const video = useRef<LiveVideo | null>(null);
  const announced = useRef<{ codec: string; tier?: string; size: Size } | null>(null);
  const waitingForKeyframe = useRef(true);
  const playback = useRef(videoPlayback());
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
  const reportedHidden = useRef<boolean | null>(null);
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

  const sendViewport = useCallback(() => {
    if (viewport.current && shown.current) {
      send({ type: 'viewport', ...viewport.current, video: wantsVideo() });
    }
  }, [send, wantsVideo]);

  // Exposed so a caller can offer a manual video/JPEG toggle; changing it re-sends the
  // viewport at once rather than waiting for the next resize or stats report.
  const setVideoPreference = useCallback(
    (next: VideoPreference) => {
      videoPreferenceRef.current = next;
      setVideoPreferenceState(next);
      sendViewport();
    },
    [sendViewport],
  );

  const draw = useCallback(async () => {
    if (drawing.current || !shown.current) return;
    const data = pending.current;
    if (data) {
      pending.current = null;
      drawing.current = true;
      try {
        const { size, jpeg } = readFrame(data);
        const bitmap = await createImageBitmap(jpeg);
        const target = canvas.current;
        if (target) {
          if (target.width !== bitmap.width) target.width = bitmap.width;
          if (target.height !== bitmap.height) target.height = bitmap.height;
          target.getContext('2d')?.drawImage(bitmap, 0, 0);
          frameSize.current = size;
          setHasFrame(true);
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
  }, [canvas, send]);

  const closeVideo = useCallback(() => {
    video.current?.close();
    video.current = null;
  }, []);

  const startVideo = useCallback(
    (init: Uint8Array) => {
      closeVideo();
      const current = announced.current;
      if (!current) return;
      const shownFrame = () => {
        frameSize.current = current.size;
        setHasFrame(true);
      };
      try {
        if (playback.current === 'webcodecs' && canvas.current) {
          video.current = webCodecsVideo(canvas.current, current.codec, init, shownFrame);
        } else if (playback.current === 'mse' && videoElement.current) {
          video.current = mseVideo(videoElement.current, current.codec, init, shownFrame);
        }
      } catch {
        // The router keeps sending JPEG frames to a view that shows no video.
      }
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
    [canvas, closeVideo, videoElement],
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
      if (bytes[0] === JPEG_FRAME) {
        closeVideo();
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
        if (!shown.current) waitingForKeyframe.current = true;
        if (waitingForKeyframe.current && waitingSinceMs.current === null) {
          waitingSinceMs.current = performance.now();
        }
        if (!shown.current || (waitingForKeyframe.current && !keyframe)) return;
        waitingForKeyframe.current = false;
        waitingSinceMs.current = null;
        video.current?.push(bytes.subarray(2), keyframe);
      }
    },
    [closeVideo, draw, startVideo],
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
    shown.current = active;
    if (active) void draw();
  }, [active, draw]);

  // A covered view (another panel, or the browser tab itself put in the background) is told
  // to the router, which stops sending it frames; document.hidden is read again on each check
  // since visibilitychange fires no React update on its own.
  useEffect(() => {
    const reportHidden = () => {
      const hidden = !active || document.hidden;
      if (reportedHidden.current === hidden) return;
      reportedHidden.current = hidden;
      send({ type: 'hidden', hidden });
    };
    reportHidden();
    document.addEventListener('visibilitychange', reportHidden);
    return () => document.removeEventListener('visibilitychange', reportHidden);
  }, [active, send]);

  // Tells the router the streamed tab to follow, again whenever the choice changes.
  useEffect(() => {
    followAgentRef.current = followAgent;
    send({ type: 'follow', agent: followAgent });
  }, [followAgent, send]);

  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let statsTimer: ReturnType<typeof setInterval> | undefined;
    const connect = () => {
      const current = new WebSocket(screencastUrl(controlBase));
      current.binaryType = 'arraybuffer';
      socket.current = current;
      current.onopen = () => {
        // A hidden view leaves the page size to the views that are shown; a fresh connection
        // (the first one, or a reconnect) tells its hidden state again, since the router's
        // side of a new one starts out shown.
        sendViewport();
        const hidden = !shown.current || document.hidden;
        reportedHidden.current = hidden;
        send({ type: 'hidden', hidden });
        send({ type: 'follow', agent: followAgentRef.current });
        rttMs.current = 0;
        pingSentAt.current = null;
        received.current = [];
        // A fresh connection (the first one, or a reconnect) starts "auto" preferring video
        // again, the same as rttMs above starting over as if the round trip were excellent:
        // both are corrected within one stats report if that turns out to be wrong.
        autoWantsVideo.current = true;
        // A fresh connection's first real round trip is measured right away rather than
        // waiting out the first interval: until it arrives, rttMs stays 0, which chooseTier
        // reads as an excellent connection, so a slow one would otherwise be let onto a tier
        // it cannot afford for up to PING_INTERVAL_MS.
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
          // "auto" follows the round trip either way: it is measured by ping/pong, which
          // keeps running regardless of which stream is playing, so a connection that has
          // recovered is noticed even while showing JPEG. The two thresholds (see
          // AUTO_JPEG_RTT_MS/AUTO_VIDEO_RTT_MS) keep a round trip that hovers near one number
          // from flipping the mode back and forth on every report.
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
        if (typeof event.data !== 'string') {
          attempt = 0;
          setStatus('live');
          return receive(event.data);
        }
        const message = JSON.parse(event.data) as ServerText;
        if (message.type === 'dialog') setDialog(message.open ? message : null);
        else if (message.type === 'video') {
          announced.current = {
            codec: message.codec,
            tier: message.tier,
            size: { width: message.width, height: message.height },
          };
          if (video.current) frameSize.current = announced.current.size;
        } else if (message.type === 'pong') {
          if (pingSentAt.current === message.t)
            rttMs.current = Math.round(performance.now() - message.t);
        } else if (message.type === 'control') {
          setControlBy(message.by);
        } else void queryClient.invalidateQueries({ queryKey: browserTabsQueryKey(controlBase) });
      };
      current.onclose = () => {
        clearInterval(pingTimer);
        clearInterval(statsTimer);
        if (stopped) return;
        setDialog(null);
        setControlBy('owner');
        closeVideo();
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
      clearInterval(pingTimer);
      clearInterval(statsTimer);
      closeVideo();
      socket.current?.close();
      socket.current = null;
    };
  }, [
    controlBase,
    reloadToken,
    closeVideo,
    downlinkKbps,
    queryClient,
    receive,
    send,
    sendViewport,
  ]);

  // Sent again after a reconnect while the view is shown.
  const setViewport = useCallback(
    (size: LiveViewport) => {
      viewport.current = size;
      sendViewport();
    },
    [sendViewport],
  );

  return {
    status,
    mode,
    playback: playback.current,
    hasFrame,
    frameSize,
    dialog,
    controlBy,
    send,
    setViewport,
    videoPreference,
    setVideoPreference,
  };
}
