'use client';

import { useCallback, useEffect, useRef } from 'react';
import { Loader2, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useBrowserLiveInput, type LiveGeometry } from '@/hooks/useBrowserLiveInput';
import {
  useBrowserScreencast,
  type ShownFrame,
  type VideoPreference,
} from '@/hooks/useBrowserScreencast';
import { useDevicePixelRatio } from '@/hooks/useDevicePixelRatio';
import { cn } from '@/lib/utils';
import { frameRect, type Size } from '@/utils/browserLive';
import WorkspaceBrowserDialog from './WorkspaceBrowserDialog';

const BADGE_CLASS =
  'pointer-events-none absolute flex items-center gap-1 rounded-full bg-background/85 px-2 py-0.5 text-xs text-muted-foreground shadow-sm';

// The tab in front of the project browser, streamed by the browser router and controlled
// with the mouse and the keyboard. The page takes this view's CSS size once the view stops
// changing size (the hook's viewport controller) and is drawn in the screen's pixels, so a
// frame fills the view one to one; while the view changes size, or when the page has another
// size (a fixed working size while an agent steers, another viewer's, or this device holds
// the size), the last frame is scaled to fit. The surface is never cleared: the last frame
// stays through resizes, reconnects and switches between video and single frames. A click
// into the view gives it the keyboard.
export default function WorkspaceBrowserLive({
  base,
  active,
  reloadToken,
  followAgent,
  videoPreference,
  holdSize,
  className,
}: {
  base: string;
  active: boolean;
  reloadToken: number;
  followAgent: boolean;
  videoPreference: VideoPreference;
  holdSize: boolean;
  className?: string;
}) {
  const t = useTranslations('nav.workspace.browserBar');
  const view = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const keyboard = useRef<HTMLTextAreaElement>(null);
  const geometry = useRef<LiveGeometry | null>(null);
  // The view's size and the frame on screen, which place the frame (layout).
  const box = useRef<Size | null>(null);
  const shown = useRef<ShownFrame | null>(null);

  // Places the canvas and the video element where the frame on screen is drawn — one to one
  // when the page has the view's size, else scaled to fit (see frameRect) — and keeps the
  // input's mapping in step. Runs when the view changes size and in the same task a frame of
  // a new size is drawn, so no frame is ever shown stretched.
  const layout = useCallback(() => {
    const frame = shown.current;
    const size = box.current;
    if (!frame || !size) return;
    const rect = frameRect(size, frame.natural);
    for (const element of [canvas.current, video.current]) {
      if (!element) continue;
      element.style.left = `${rect.left}px`;
      element.style.top = `${rect.top}px`;
      element.style.width = `${rect.width}px`;
      element.style.height = `${rect.height}px`;
    }
    geometry.current = { rect, page: frame.page };
  }, []);

  const onShown = useCallback(
    (frame: ShownFrame) => {
      const previous = shown.current;
      shown.current = frame;
      const same =
        previous &&
        previous.natural.width === frame.natural.width &&
        previous.natural.height === frame.natural.height &&
        previous.page.width === frame.page.width &&
        previous.page.height === frame.page.height;
      if (!same) layout();
    },
    [layout],
  );

  const {
    status,
    mode,
    playback,
    hasFrame,
    videoElementShown,
    page,
    dialog,
    controlBy,
    send,
    setViewport,
  } = useBrowserScreencast(
    base,
    active,
    reloadToken,
    canvas,
    video,
    followAgent,
    videoPreference,
    holdSize,
    onShown,
  );
  const inVideoElement = mode === 'video' && playback === 'mse' && videoElementShown;
  // "auto" chose single frames itself (the connection is slow enough that video's own extra
  // latency would make it the worse choice) — distinct from a browser that cannot play video
  // at all, which never claims to prefer it.
  const autoFallback =
    videoPreference === 'auto' && mode === 'jpeg' && playback !== null && hasFrame;
  const { pointer, keys } = useBrowserLiveInput(view, keyboard, geometry, send);
  const dpr = useDevicePixelRatio();

  // Every size the view takes goes to the viewport controller, which sends it once it
  // settles. A hidden panel has no size and reports none.
  useEffect(() => {
    const element = view.current;
    if (!element || !active) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      box.current = { width, height };
      layout();
      setViewport({ width: Math.round(width), height: Math.round(height), dpr });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [active, dpr, layout, setViewport]);

  const connecting = !hasFrame;
  const reconnecting = status === 'reconnecting' && hasFrame;

  return (
    <div
      ref={view}
      dir="ltr"
      className={cn(
        'relative min-h-0 flex-1 touch-none overflow-hidden bg-muted select-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-inset',
        !active && 'hidden',
        className,
      )}
      {...pointer}
    >
      {/* Placed by layout(); until the first frame they fill the view. */}
      <canvas
        ref={canvas}
        className={cn('absolute start-0 top-0 size-full', inVideoElement && 'invisible')}
      />
      <video
        ref={video}
        muted
        playsInline
        className={cn(
          'absolute start-0 top-0 size-full object-fill',
          !inVideoElement && 'invisible',
        )}
      />
      <textarea
        ref={keyboard}
        aria-label={t('liveKeyboard')}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="absolute start-0 top-0 size-px resize-none opacity-0"
        {...keys}
      />
      {dialog && (
        <WorkspaceBrowserDialog
          key={dialog.message}
          dialog={dialog}
          onAnswer={(accept, text) => send({ type: 'dialog', accept, text })}
        />
      )}
      {/* Informational only: who last acted on the page. The lock this hands off to later is
          the browser gateway's, not this view's. */}
      {controlBy === 'agent' && (
        <div className={cn(BADGE_CLASS, 'start-2 top-2')}>{t('controlAgent')}</div>
      )}
      <div className="pointer-events-none absolute end-2 top-2 flex flex-col items-end gap-1">
        {page?.fixed && (
          <div className={cn(BADGE_CLASS, 'relative')} title={t('fixedSizeHint')}>
            <Lock className="size-3" />
            {t('fixedSize', { width: page.width, height: page.height })}
          </div>
        )}
        {autoFallback && (
          <div className={cn(BADGE_CLASS, 'relative')} title={t('videoAutoFallback')}>
            {t('videoAutoFallback')}
          </div>
        )}
      </div>
      {reconnecting && (
        <div
          aria-live="polite"
          className={cn(BADGE_CLASS, 'start-1/2 bottom-3 -translate-x-1/2 gap-1.5')}
        >
          <Loader2 className="size-3 animate-spin" />
          {t('reconnectingShort')}
        </div>
      )}
      {connecting && (
        <div
          aria-live="polite"
          className="absolute inset-0 flex items-center justify-center bg-background/80 p-4 text-center text-sm text-muted-foreground"
        >
          {status === 'reconnecting' ? t('reconnecting') : t('connecting')}
        </div>
      )}
    </div>
  );
}
