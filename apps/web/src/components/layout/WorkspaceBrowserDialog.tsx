'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { LiveDialog, LiveHandover } from '@/utils/browserLive';
import { Button } from '@/components/ui/button';

// What the live view shows centered over the page, one at a time: a JavaScript dialog of the
// page, answered for it; an agent's request to take over (browser_handover, design §4, §7);
// the question whether to take over when the owner starts using a page an agent controls
// (design §5); and, after 10 minutes without input from an owner in control, whether they are
// done.
export type LiveCard =
  | ({ type: 'dialog' } & LiveDialog)
  | ({ type: 'handover'; ownerControls: boolean } & LiveHandover)
  | { type: 'takeOver'; agentName: string | null }
  | { type: 'idle' };

export default function WorkspaceBrowserDialog({
  card,
  busy,
  onAnswer,
  onTakeOver,
  onHandBack,
  onDismiss,
}: {
  card: LiveCard;
  busy: boolean;
  onAnswer: (accept: boolean, text?: string) => void;
  onTakeOver: () => void;
  onHandBack: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('nav.workspace.browserBar');
  return (
    // Presses on the card are for the card, not for the page under it.
    <div
      data-live-dialog
      className="absolute inset-0 flex items-center justify-center bg-background/60 p-4 select-text"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
    >
      {card.type === 'dialog' ? (
        <JsDialog dialog={card} onAnswer={onAnswer} />
      ) : card.type === 'handover' ? (
        <Card
          title={t('handoverTitle', { agentName: card.agentName || t('controlledByAgentGeneric') })}
          body={card.reason}
          actions={
            card.ownerControls ? (
              <Button size="sm" autoFocus disabled={busy} onClick={onHandBack}>
                {t('handoverDone')}
              </Button>
            ) : (
              <Button size="sm" autoFocus disabled={busy} onClick={onTakeOver}>
                {t('takeOver')}
              </Button>
            )
          }
        />
      ) : card.type === 'takeOver' ? (
        <Card
          title={t('takeOverTitle', { agentName: card.agentName ?? t('controlledByAgentGeneric') })}
          body={t('takeOverHint')}
          actions={
            <>
              <Button size="sm" variant="ghost" onClick={onDismiss}>
                {t('dialogCancel')}
              </Button>
              <Button size="sm" autoFocus disabled={busy} onClick={onTakeOver}>
                {t('takeOver')}
              </Button>
            </>
          }
        />
      ) : (
        <Card
          title={t('idleTitle')}
          body={t('idleHint')}
          actions={
            <>
              <Button size="sm" variant="ghost" onClick={onDismiss}>
                {t('idleKeep')}
              </Button>
              <Button size="sm" autoFocus disabled={busy} onClick={onHandBack}>
                {t('handBack')}
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}

function Card({ title, body, actions }: { title: string; body: string; actions: ReactNode }) {
  return (
    <div
      role="alertdialog"
      aria-label={title}
      className="flex w-full max-w-sm flex-col gap-3 rounded-md border bg-background p-4 shadow-lg"
    >
      <p className="text-md font-medium">{title}</p>
      {body && (
        <p className="text-sm break-words whitespace-pre-wrap text-muted-foreground" dir="auto">
          {body}
        </p>
      )}
      <div className="flex justify-end gap-2">{actions}</div>
    </div>
  );
}

function JsDialog({
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
    <form
      role="alertdialog"
      aria-label={t('dialogTitle')}
      className="flex w-full max-w-sm flex-col gap-3 rounded-md border bg-background p-4 shadow-lg"
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
