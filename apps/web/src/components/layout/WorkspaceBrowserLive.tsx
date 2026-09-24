'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useBrowserLiveInput } from '@/hooks/useBrowserLiveInput';
import { useBrowserScreencast } from '@/hooks/useBrowserScreencast';
import { useDevicePixelRatio } from '@/hooks/useDevicePixelRatio';
import { cn } from '@/lib/utils';
import WorkspaceBrowserDialog from './WorkspaceBrowserDialog';

// The view's size is sent once it has not changed for this long, so dragging the panel's
// edge resizes the browser window once.
const RESIZE_DELAY_MS = 200;

// The tab in front of the project browser, streamed by the browser router and controlled
// with the mouse and the keyboard. The page is shown at the CSS size of this view and in the
// screen's pixels, so the frames fill the view one to one; a click into the view gives it the
// keyboard.
export default function WorkspaceBrowserLive({
  base,
  active,
  reloadToken,
  followAgent,
  className,
}: {
  base: string;
  active: boolean;
  reloadToken: number;
  followAgent: boolean;
  className?: string;
}) {
  const t = useTranslations('nav.workspace.browserBar');
  const view = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const keyboard = useRef<HTMLTextAreaElement>(null);
  const {
    status,
    mode,
    playback,
    hasFrame,
    frameSize,
    dialog,
    controlBy,
    send,
    setViewport,
    videoPreference,
  } = useBrowserScreencast(base, active, reloadToken, canvas, video, followAgent);
  const inVideoElement = mode === 'video' && playback === 'mse';
  // "auto" chose single frames itself (the connection is slow enough that video's own extra
  // latency would make it the worse choice, see useBrowserScreencast's AUTO_JPEG_RTT_MS) —
  // distinct from a browser that cannot play video at all, which never claims to prefer it.
  const autoFallback = videoPreference === 'auto' && mode === 'jpeg' && playback !== null;
  const { pointer, keys } = useBrowserLiveInput(view, keyboard, frameSize, send);
  const dpr = useDevicePixelRatio();

  useEffect(() => {
    const element = view.current;
    if (!element || !active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      clearTimeout(timer);
      timer = setTimeout(
        () => setViewport({ width: Math.round(width), height: Math.round(height), dpr }),
        RESIZE_DELAY_MS,
      );
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [active, dpr, setViewport]);

  const notice = status === 'reconnecting' ? t('reconnecting') : hasFrame ? null : t('connecting');

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
      <canvas ref={canvas} className={cn('size-full object-contain', inVideoElement && 'hidden')} />
      <video
        ref={video}
        muted
        playsInline
        className={cn('size-full object-contain', !inVideoElement && 'hidden')}
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
        <div className="pointer-events-none absolute start-2 top-2 rounded-full bg-background/80 px-2 py-0.5 text-xs text-muted-foreground shadow-sm">
          {t('controlAgent')}
        </div>
      )}
      {/* "auto" (the default) fell back to single frames on its own: a manual video/single-frame
          toggle, and a fuller quality indicator (tier, fps, latency), belong with the browser
          panel's own redesign; this stays a plain, unobtrusive notice until then. */}
      {autoFallback && (
        <div
          className="pointer-events-none absolute end-2 top-2 rounded-full bg-background/80 px-2 py-0.5 text-xs text-muted-foreground shadow-sm"
          title={t('videoAutoFallback')}
        >
          {t('videoAutoFallback')}
        </div>
      )}
      {notice && (
        <div
          aria-live="polite"
          className="absolute inset-0 flex items-center justify-center bg-background/80 p-4 text-center text-sm text-muted-foreground"
        >
          {notice}
        </div>
      )}
    </div>
  );
}
