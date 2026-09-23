'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useRelativeTime } from '@/context/relativeTimeContext';
import { useBrowserLiveInput } from '@/hooks/useBrowserLiveInput';
import { useBrowserLock } from '@/hooks/useBrowserLock';
import { useBrowserScreencast } from '@/hooks/useBrowserScreencast';
import { useDevicePixelRatio } from '@/hooks/useDevicePixelRatio';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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
  const relativeTime = useRelativeTime();
  const view = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const keyboard = useRef<HTMLTextAreaElement>(null);
  const { status, mode, playback, hasFrame, frameSize, overlay, control, send, setViewport } =
    useBrowserScreencast(base, active, reloadToken, canvas, video, followAgent);
  const inVideoElement = mode === 'video' && playback === 'mse';
  const { pointer, keys } = useBrowserLiveInput(view, keyboard, frameSize, send);
  const dpr = useDevicePixelRatio();
  const { takeOver, takingOver, release, releasing } = useBrowserLock(base);

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
      {overlay && (
        <WorkspaceBrowserDialog
          key={
            overlay.type === 'dialog' ? `dialog:${overlay.message}` : `handover:${overlay.reason}`
          }
          overlay={overlay}
          onAnswer={(accept, text) => send({ type: 'dialog', accept, text })}
          onTakeOver={() => takeOver()}
          takingOver={takingOver}
        />
      )}
      {/* Who has the control lock right now (design §5): "Steuert: <Agent> · seit <Zeit>" with
          an Übernehmen button while an agent controls it, "Steuert: Sie" with a Zurückgeben
          button while the owner does. agentName/since are not sent by the router yet (see
          LiveControlState), so the agent case falls back to a generic label and omits the
          "seit …" clause until it starts including them. */}
      <div className="absolute start-2 top-2 flex items-center gap-1.5 rounded-full bg-background/80 py-1 ps-2.5 pe-1 text-xs text-muted-foreground shadow-sm">
        <span>
          {t('controlPrefix')}{' '}
          <strong className="font-medium text-foreground">
            {control.by === 'agent'
              ? (control.agentName ?? t('controlledByAgentGeneric'))
              : t('you')}
          </strong>
          {control.by === 'agent' && control.since && <> · {relativeTime(control.since)}</>}
        </span>
        {control.by === 'agent' ? (
          <Button
            size="sm"
            variant="secondary"
            className="h-6 px-2 text-xs"
            disabled={takingOver}
            onClick={() => takeOver()}
          >
            {t('takeOver')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            disabled={releasing}
            onClick={() => release()}
          >
            {t('handBack')}
          </Button>
        )}
      </div>
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
