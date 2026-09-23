'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { LiveDialog } from '@/utils/browserLive';
import { Button } from '@/components/ui/button';

// A JavaScript dialog of the page in the live view. The browser draws it outside the page, so
// the stream does not show it; it is shown here and answered for the page.
export default function WorkspaceBrowserDialog({
  dialog,
  onAnswer,
}: {
  dialog: LiveDialog;
  onAnswer: (accept: boolean, text?: string) => void;
}) {
  const t = useTranslations('nav.workspace.browserBar');
  const [text, setText] = useState(dialog.defaultPrompt);
  const canCancel = dialog.kind !== 'alert';
  return (
    // Presses on the dialog are for the dialog, not for the page under it.
    <div
      data-live-dialog
      className="absolute inset-0 flex items-center justify-center bg-background/60 p-4 select-text"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
    >
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
    </div>
  );
}
