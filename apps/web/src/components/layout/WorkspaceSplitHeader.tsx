'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

// The label row of the second half of a split panel, with the button that closes it. A
// tool with a toolbar of its own shows that instead of its name.
export default function WorkspaceSplitHeader({
  title,
  toolbar,
  onClose,
}: {
  title: string;
  toolbar?: ReactNode;
  onClose: () => void;
}) {
  const t = useTranslations('nav.workspace');
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b ps-3 pe-1">
      {toolbar ?? (
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          {title}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="size-6 text-muted-foreground hover:text-foreground"
        onClick={onClose}
        title={t('closeSplit')}
        aria-label={t('closeSplit')}
      >
        <X />
      </Button>
    </div>
  );
}
