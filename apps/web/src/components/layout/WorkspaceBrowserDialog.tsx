'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { LiveOverlay } from '@/hooks/useBrowserScreencast';
import { Button } from '@/components/ui/button';

// What the live view shows centered over the page: a JS dialog the page opened, answered
// for it, or an agent's handover request (design §4, §7: "Bittet den Owner zu übernehmen
// (CAPTCHA, unbekannte Rückfrage). Erzeugt eine Freigabe-Karte... und wartet."), whose
// button does the same Übernehmen action as the live view's own banner
// (WorkspaceBrowserLive.tsx). The handover branch renders once the router starts sending
// `{"type":"handover",...}` (see LiveHandover in browserLive.ts) — it does not today.
export default function WorkspaceBrowserDialog({
  overlay,
  onAnswer,
  onTakeOver,
  takingOver,
}: {
  overlay: LiveOverlay;
  onAnswer: (accept: boolean, text?: string) => void;
  onTakeOver: () => void;
  takingOver: boolean;
}) {
  return (
    // Presses on the overlay are for the overlay, not for the page under it.
    <div
      data-live-dialog
      className="absolute inset-0 flex items-center justify-center bg-background/60 p-4 select-text"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
    >
      {overlay.type === 'dialog' ? (
        <JsDialog dialog={overlay} onAnswer={onAnswer} />
      ) : (
        <HandoverCard reason={overlay.reason} onTakeOver={onTakeOver} takingOver={takingOver} />
      )}
    </div>
  );
}

function JsDialog({
  dialog,
  onAnswer,
}: {
  dialog: Extract<LiveOverlay, { type: 'dialog' }>;
  onAnswer: (accept: boolean, text?: string) => void;
}) {
  const t = useTranslations('nav.workspace.browserBar');
  const [text, setText] = useState(dialog.defaultPrompt);
  const canCancel = dialog.kind !== 'alert';
  return (
    <form
      role="alertdialog"
      aria-label={t('dialogTitle')}
      className="flex w-full max-w-sm flex-col gap-3 rounded-lg border bg-background p-4 shadow-lg"
      onSubmit={(event) => {
        event.preventDefault();
        onAnswer(true, dialog.kind === 'prompt' ? text : undefined);
      }}
    >
      <p className="text-xs text-muted-foreground">{t('dialogTitle')}</p>
      <p className="text-sm break-words whitespace-pre-wrap" dir="auto">
        {dialog.message}
      </p>
      {dialog.kind === 'prompt' && (
        <input
          autoFocus
          dir="auto"
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      )}
      <div className="flex justify-end gap-2">
        {canCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onAnswer(false)}>
            {t('dialogCancel')}
          </Button>
        )}
        <Button type="submit" size="sm" autoFocus={dialog.kind !== 'prompt'}>
          {t('dialogOk')}
        </Button>
      </div>
    </form>
  );
}

// The CAPTCHA/handover card (design §7: "Freigabe-Karte mit Link zur Live-Ansicht" — this
// component *is* that card, already shown inside the live view it would link to). Its
// button calls the same lock-takeover action as the live view's own banner.
function HandoverCard({
  reason,
  onTakeOver,
  takingOver,
}: {
  reason: string;
  onTakeOver: () => void;
  takingOver: boolean;
}) {
  const t = useTranslations('nav.workspace.browserBar');
  return (
    <div
      role="alertdialog"
      aria-label={t('handoverTitle')}
      className="flex w-full max-w-sm flex-col gap-3 rounded-lg border bg-background p-4 shadow-lg"
    >
      <p className="text-sm break-words whitespace-pre-wrap" dir="auto">
        {t('handoverMessage', { reason })}
      </p>
      <div className="flex justify-end">
        <Button size="sm" autoFocus disabled={takingOver} onClick={onTakeOver}>
          {t('takeOver')}
        </Button>
      </div>
    </div>
  );
}
