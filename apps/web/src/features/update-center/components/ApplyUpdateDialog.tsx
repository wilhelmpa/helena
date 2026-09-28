'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { UpdateItem, UpdateScope } from '@/lib/api/endpoints/updateCenter';
import { versionStep } from '../utils/updateFormat';

// The owner's approval of one update: what is downloaded and installed, from where, and
// the way back. "Jetzt aktualisieren" is the approval itself (owner rule: every download
// needs his OK); nothing else starts an update.
export default function ApplyUpdateDialog({
  item,
  items,
  scope,
  onConfirm,
  onClose,
}: {
  // The component clicked, and every component the update covers (a group's packages).
  item: UpdateItem;
  items: UpdateItem[];
  scope: UpdateScope;
  onConfirm: (item: UpdateItem, scope: UpdateScope) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('updates');
  const tCommon = useTranslations('common');
  const [busy, setBusy] = useState(false);
  const group = scope !== 'item';
  const apt = item.source === 'apt';
  const hermes = item.source === 'hermes';
  let source = '';
  try {
    source = item.sourceUrl ? new URL(item.sourceUrl).host : '';
  } catch {
    source = '';
  }

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm(item, scope);
      onClose();
    } catch {
      // Shown by the global mutation error toast; the dialog stays for another try.
      setBusy(false);
    }
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent size="small">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {group
              ? t('dialog.titleGroup', { count: items.length })
              : t('dialog.title', { name: item.name })}
          </AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogDescription asChild>
          <div className="space-y-3 text-sm text-foreground">
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-sidebar-border bg-card p-2 text-xs">
              {items.map((entry) => (
                <li key={entry.id} className="flex min-w-0 items-baseline gap-2">
                  <span className="min-w-0 truncate font-medium" dir="auto">
                    {entry.name}
                  </span>
                  <span className="ms-auto shrink-0 font-mono text-muted-foreground" dir="ltr">
                    {versionStep(entry)}
                  </span>
                </li>
              ))}
            </ul>
            <p>
              {apt
                ? t('dialog.downloadApt')
                : hermes
                  ? t('dialog.downloadHermes')
                  : t('dialog.download', { source: source || item.name })}
            </p>
            <p className="text-muted-foreground">
              {apt
                ? t('dialog.wayBackApt')
                : hermes
                  ? t('dialog.wayBackHermes')
                  : t('dialog.wayBack')}
            </p>
            <p className="text-xs text-muted-foreground">{t('dialog.approval')}</p>
          </div>
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{tCommon('cancel')}</AlertDialogCancel>
          <Button onClick={() => void confirm()} disabled={busy}>
            {t('dialog.confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
