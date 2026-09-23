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

type ServerText =
  | ({ type: 'dialog'; open: boolean } & LiveDialog)
  | { type: 'video'; codec: string; width: number; height: number }
  | { type: 'tab' };

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
) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ScreencastStatus>('connecting');
  const [mode, setMode] = useState<ScreencastMode>('jpeg');
  const [hasFrame, setHasFrame] = useState(false);
  const [dialog, setDialog] = useState<LiveDialog | null>(null);
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

  useEffect(() => {
    shown.current = active;
    if (active) void draw();
  }, [active, draw]);

  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const connect = () => {
      const current = new WebSocket(screencastUrl(controlBase));
      current.binaryType = 'arraybuffer';
      socket.current = current;
      // A hidden view leaves the page size to the views that are shown.
      current.onopen = sendViewport;
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
            size: { width: message.width, height: message.height },
          };
          if (video.current) frameSize.current = announced.current.size;
        } else void queryClient.invalidateQueries({ queryKey: browserTabsQueryKey(controlBase) });
      };
      current.onclose = () => {
        if (stopped) return;
        setDialog(null);
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
      closeVideo();
      socket.current?.close();
      socket.current = null;
    };
  }, [controlBase, reloadToken, closeVideo, queryClient, receive, sendViewport]);

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
    send,
    setViewport,
  };
}
