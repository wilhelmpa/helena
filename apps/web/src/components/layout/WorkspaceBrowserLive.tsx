'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useBrowserControlGate } from '@/hooks/useBrowserControlGate';
import { useBrowserLiveInput } from '@/hooks/useBrowserLiveInput';
import { useBrowserLock } from '@/hooks/useBrowserLock';
import { useBrowserScreencast } from '@/hooks/useBrowserScreencast';
import { useDevicePixelRatio } from '@/hooks/useDevicePixelRatio';
import { cn } from '@/lib/utils';
import WorkspaceBrowserControl from './WorkspaceBrowserControl';
import WorkspaceBrowserDialog, { type LiveCard } from './WorkspaceBrowserDialog';

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
  const { status, mode, playback, hasFrame, frameSize, overlay, control, send, setViewport } =
    useBrowserScreencast(base, active, reloadToken, canvas, video, followAgent);
  const inVideoElement = mode === 'video' && playback === 'mse';
  const { takeOver, takingOver, release, releasing } = useBrowserLock(base);
  const gate = useBrowserControlGate(control, send, release);
  const { pointer, keys } = useBrowserLiveInput(view, keyboard, frameSize, gate.guardedSend);
  const dpr = useDevicePixelRatio();
  const busy = takingOver || releasing;
  const ownerControls = control.locked && control.by === 'owner';
  // A dialog of the page first, then an agent's request, then the owner's own questions.
  const card: LiveCard | null =
    overlay?.type === 'dialog'
      ? overlay
      : overlay?.type === 'handover'
        ? { ...overlay, ownerControls }
        : gate.prompt === 'takeOver'
          ? { type: 'takeOver', agentName: control.agentName }
          : gate.prompt === 'idle'
            ? { type: 'idle' }
            : null;

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
      {card && (
        <WorkspaceBrowserDialog
          key={
            card.type === 'dialog'
              ? `dialog:${card.message}`
              : card.type === 'handover'
                ? `handover:${card.since}:${card.ownerControls}`
                : card.type
          }
          card={card}
          busy={busy}
          onAnswer={(accept, text) => send({ type: 'dialog', accept, text })}
          onTakeOver={() => {
            gate.dismiss();
            takeOver();
          }}
          onHandBack={() => {
            gate.dismiss();
            release();
          }}
          onDismiss={gate.dismiss}
        />
      )}
      <WorkspaceBrowserControl
        control={control}
        busy={busy}
        onTakeOver={() => takeOver()}
        onHandBack={() => release()}
      />
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
