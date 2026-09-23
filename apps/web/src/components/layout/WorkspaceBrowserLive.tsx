'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useBrowserLiveInput } from '@/hooks/useBrowserLiveInput';
import { useBrowserScreencast } from '@/hooks/useBrowserScreencast';
import { cn } from '@/lib/utils';

// The view's size is sent once it has not changed for this long, so dragging the panel's
// edge resizes the browser window once.
const RESIZE_DELAY_MS = 300;

// The tab in front of the project browser, streamed by the browser router and controlled
// with the mouse and the keyboard. The page is shown at the size of this view; a click into
// the view gives it the keyboard.
export default function WorkspaceBrowserLive({
  base,
  active,
  reloadToken,
  className,
}: {
  base: string;
  active: boolean;
  reloadToken: number;
  className?: string;
}) {
  const t = useTranslations('nav.workspace.browserBar');
  const view = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const keyboard = useRef<HTMLTextAreaElement>(null);
  const { status, hasFrame, frameSize, send, setViewport } = useBrowserScreencast(
    base,
    active,
    reloadToken,
    canvas,
  );
  const { pointer, keys } = useBrowserLiveInput(view, keyboard, frameSize, send);

  useEffect(() => {
    const element = view.current;
    if (!element || !active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      clearTimeout(timer);
      timer = setTimeout(
        () => setViewport({ width: Math.round(width), height: Math.round(height) }),
        RESIZE_DELAY_MS,
      );
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [active, setViewport]);

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
      <canvas ref={canvas} className="size-full object-contain" />
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
      {notice && (
        <div
          aria-live="polite"
          className="absolute inset-0 flex items-center justify-center bg-background/80 p-6 text-center text-sm text-muted-foreground"
        >
          {notice}
        </div>
      )}
    </div>
  );
}
