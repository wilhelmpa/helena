import { type ReactNode, useState } from 'react';
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

// A confirmation with a destructive confirm button that owns the busy state and the
// try/catch around the action. Callers put the dialog-specific body in `children`
// and supply the action. A failed action is toasted globally; the dialog stays
// open so the user can retry. Used by the delete confirmations (label/type/state/
// project) and the members/roles flows.
//
// An alert dialog (Radix AlertDialog): announced as one, focus starts on Cancel, and a
// click beside it does not dismiss it; Cancel and Escape do.
export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  confirmDisabled = false,
  onConfirm,
  onClose,
}: {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  confirmDisabled?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('common');
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
    } catch {
      // The failed action is toasted by the global mutation handler; keep the
      // dialog open so the user can retry or cancel.
      setBusy(false);
    }
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent className="sm:max-w-[440px]">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
        </AlertDialogHeader>
        {children ? (
          <AlertDialogDescription asChild>
            <div className="space-y-4 text-foreground">{children}</div>
          </AlertDialogDescription>
        ) : (
          <AlertDialogDescription className="sr-only">{title}</AlertDialogDescription>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t('cancel')}</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={busy || confirmDisabled}>
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
