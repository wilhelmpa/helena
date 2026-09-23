import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { browserTabsQueryKey } from '@/utils/browserControl';
import {
  readFrame,
  screencastUrl,
  type LiveDialog,
  type LiveMessage,
  type Size,
} from '@/utils/browserLive';

// The view's size in CSS pixels and the screen's pixel ratio, which the page is shown at.
export interface LiveViewport extends Size {
  dpr: number;
}

export type ScreencastStatus = 'connecting' | 'live' | 'reconnecting';

const RETRY_FIRST_MS = 500;
const RETRY_MAX_MS = 10_000;

// The live view's connection to the browser router. It draws the newest frame it received
// on the canvas and then acknowledges all of them, so the router sends no faster than the
// view draws. A hidden view acknowledges nothing, which stops the frames until it is shown
// again. A dropped connection is opened again, waiting longer after each attempt that ends
// before a frame arrives: the router accepts the connection before it reaches the browser.
export function useBrowserScreencast(
  controlBase: string,
  active: boolean,
  reloadToken: number,
  canvas: RefObject<HTMLCanvasElement | null>,
) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ScreencastStatus>('connecting');
  const [hasFrame, setHasFrame] = useState(false);
  const [dialog, setDialog] = useState<LiveDialog | null>(null);
  const socket = useRef<WebSocket | null>(null);
  // The page size of the frame on the canvas, which pointer positions are mapped to.
  const frameSize = useRef<Size | null>(null);
  const viewport = useRef<LiveViewport | null>(null);
  const pending = useRef<ArrayBuffer | null>(null);
  const unacknowledged = useRef(0);
  const drawing = useRef(false);
  const shown = useRef(active);

  const send = useCallback((message: LiveMessage) => {
    const current = socket.current;
    if (current?.readyState === WebSocket.OPEN) current.send(JSON.stringify(message));
  }, []);

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
      current.onopen = () => {
        // A hidden view leaves the page size to the views that are shown.
        if (viewport.current && shown.current) {
          current.send(JSON.stringify({ type: 'viewport', ...viewport.current }));
        }
      };
      current.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
        if (typeof event.data === 'string') {
          const message = JSON.parse(event.data) as { type: string; open?: boolean } & LiveDialog;
          if (message.type === 'dialog') setDialog(message.open ? message : null);
          else void queryClient.invalidateQueries({ queryKey: browserTabsQueryKey(controlBase) });
          return;
        }
        attempt = 0;
        setStatus('live');
        unacknowledged.current++;
        pending.current = event.data;
        void draw();
      };
      current.onclose = () => {
        if (stopped) return;
        setDialog(null);
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
      socket.current?.close();
      socket.current = null;
    };
  }, [controlBase, reloadToken, draw, queryClient]);

  // Sent again after a reconnect while the view is shown.
  const setViewport = useCallback(
    (size: LiveViewport) => {
      viewport.current = size;
      send({ type: 'viewport', ...size });
    },
    [send],
  );

  return { status, hasFrame, frameSize, dialog, send, setViewport };
}
