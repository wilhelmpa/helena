import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { browserTabsQueryKey } from '@/utils/browserControl';
import {
  FREE_CONTROL,
  JPEG_FRAME,
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

// The view's size in CSS pixels and the screen's pixel ratio, which the page is shown at.
export interface LiveViewport extends Size {
  dpr: number;
}

export type ScreencastStatus = 'connecting' | 'live' | 'reconnecting';

// The router streams video when every viewer can play it, and JPEG frames otherwise.
export type ScreencastMode = 'jpeg' | 'video';

const RETRY_FIRST_MS = 500;
const RETRY_MAX_MS = 10_000;
// How often the round trip is measured and the connection's stats are reported to the router,
// which puts this view on the quality tier they afford.
const PING_INTERVAL_MS = 4_000;
const STATS_INTERVAL_MS = 3_000;
// The downlink is the bytes received over this trailing window, so a burst of a few frames
// does not read as a much faster connection than it is.
const THROUGHPUT_WINDOW_MS = 4_000;

type ServerText =
  | ({ type: 'dialog'; open: boolean } & LiveDialog)
  | ({ type: 'handover'; open: boolean } & Partial<LiveHandover>)
  | { type: 'video'; codec: string; width: number; height: number }
  | { type: 'tab' }
  | { type: 'pong'; t: number }
  | ({ type: 'control' } & LiveControlState);

// What the live view shows centered over the page right now: a JS dialog the page opened,
// or an agent's handover request (design §4, §7 — see LiveHandover). At most one at a time.
export type LiveOverlay = ({ type: 'dialog' } & LiveDialog) | ({ type: 'handover' } & LiveHandover);

// Who last acted on the page (design §5). `by` is always known; `agentName`/`since` are
// filled in once the router sends them (see LiveControlState).
export type LiveControl = LiveControlState['by'];

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
  // A dialog of the page and an agent's handover request are kept apart: the dialog is shown
  // first (it has to be answered before anything else), the request once it is gone.
  const [dialog, setDialog] = useState<({ type: 'dialog' } & LiveDialog) | null>(null);
  const [handover, setHandover] = useState<({ type: 'handover' } & LiveHandover) | null>(null);
  const overlay: LiveOverlay | null = dialog ?? handover;
  const [control, setControl] = useState<LiveControlState>(FREE_CONTROL);
  const socket = useRef<WebSocket | null>(null);
  // The page size of the frame shown, which pointer positions are mapped to.
  const frameSize = useRef<Size | null>(null);
  const viewport = useRef<LiveViewport | null>(null);
  const pending = useRef<ArrayBuffer | null>(null);
  const unacknowledged = useRef(0);
  const drawing = useRef(false);
  const shown = useRef(active);
  const video = useRef<LiveVideo | null>(null);
  const announced = useRef<{ codec: string; size: Size } | null>(null);
  const waitingForKeyframe = useRef(true);
  const playback = useRef(videoPlayback());
  // The connection's last measured round trip and the bytes received in the trailing window,
  // which the router is periodically told so it can put this view on the tier they afford.
  const rttMs = useRef(0);
  const pingSentAt = useRef<number | null>(null);
  const received = useRef<{ at: number; bytes: number }[]>([]);
  const reportedHidden = useRef<boolean | null>(null);
  const followAgentRef = useRef(followAgent);

  const send = useCallback((message: LiveMessage) => {
    const current = socket.current;
    if (current?.readyState === WebSocket.OPEN) current.send(JSON.stringify(message));
  }, []);

  const sendViewport = useCallback(() => {
    if (viewport.current && shown.current) {
      send({ type: 'viewport', ...viewport.current, video: playback.current !== null });
    }
  }, [send]);

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
        const keyframe = bytes[1] === 1;
        if (!shown.current) waitingForKeyframe.current = true;
        if (!shown.current || (waitingForKeyframe.current && !keyframe)) return;
        waitingForKeyframe.current = false;
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
        pingTimer = setInterval(() => {
          pingSentAt.current = performance.now();
          send({ type: 'ping', t: pingSentAt.current });
        }, PING_INTERVAL_MS);
        statsTimer = setInterval(() => {
          send({ type: 'stats', rttMs: rttMs.current, downlinkKbps: downlinkKbps() });
        }, STATS_INTERVAL_MS);
      };
      current.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
        if (typeof event.data !== 'string') {
          attempt = 0;
          setStatus('live');
          return receive(event.data);
        }
        const message = JSON.parse(event.data) as ServerText;
        if (message.type === 'dialog') {
          setDialog(message.open ? { ...message } : null);
        } else if (message.type === 'handover') {
          setHandover(
            message.open
              ? {
                  type: 'handover',
                  reason: message.reason ?? '',
                  agentName: message.agentName ?? '',
                  since: message.since ?? Date.now(),
                }
              : null,
          );
        } else if (message.type === 'video') {
          announced.current = {
            codec: message.codec,
            size: { width: message.width, height: message.height },
          };
          if (video.current) frameSize.current = announced.current.size;
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
    overlay,
    control,
    send,
    setViewport,
  };
}
