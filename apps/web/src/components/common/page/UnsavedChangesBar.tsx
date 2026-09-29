'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// The floating save bar settings pages use instead of a "Save" button pinned in the
// header (docs/volition-design-helena-ui.md "Bausteine"): it only appears once a
// field actually changed, names that plainly, and offers Discard next to Save. Also
// warns before the tab closes or navigates away with unsaved changes.
//
// A page that saves a field immediately (a switch, most single-field settings) has
// no unsaved state and never mounts this; it toasts on change instead.
export default function UnsavedChangesBar({
  dirty,
  saving = false,
  onSave,
  onDiscard,
  className,
}: {
  dirty: boolean;
  saving?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  className?: string;
}) {
  const t = useTranslations('common');

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome ignores the returned string and shows its own text, but still needs a
      // truthy return (or the now-deprecated returnValue set) to prompt at all.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  if (!dirty) return null;

  return (
    <div
      role="status"
      className={cn(
        'fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit items-center gap-3 rounded-md border bg-popover px-4 py-2.5 text-sm shadow-[var(--modal-shadow)]',
        className,
      )}
    >
      <span className="text-muted-foreground">{t('unsavedChanges')}</span>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDiscard} disabled={saving}>
          {t('discard')}
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={saving}>
          {saving ? t('saving') : t('save')}
        </Button>
      </div>
    </div>
  );
}
