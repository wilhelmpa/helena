'use client';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { useLocale, useTranslations } from 'next-intl';
import type { Frontmatter } from '../utils/noteFrontmatter';
import DocumentBacklinks from './DocumentBacklinks';
import DocumentProperties from './DocumentProperties';

export default function DocumentEditorInspector({
  open,
  revision,
  path,
  frontmatter,
  editable,
  onFrontmatterChange,
  onOpenChange,
}: {
  open: boolean;
  revision: number;
  path: string;
  frontmatter: Frontmatter;
  editable: boolean;
  onFrontmatterChange: (frontmatter: Frontmatter) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('documents');
  const locale = useLocale();
  const isMobile = useIsMobile();

  if (!open) return null;

  const panel = (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
      <DocumentProperties
        key={revision}
        frontmatter={frontmatter}
        editable={editable}
        onChange={onFrontmatterChange}
      />
      <DocumentBacklinks path={path} />
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent
          side={locale === 'ar' ? 'left' : 'right'}
          className="w-[min(94vw,380px)] gap-0 sm:max-w-[380px]"
        >
          <SheetHeader className="shrink-0 border-b pe-12">
            <SheetTitle>{t('details')}</SheetTitle>
            <SheetDescription className="sr-only">{t('detailsDescription')}</SheetDescription>
          </SheetHeader>
          {panel}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside
      className="flex w-[19rem] shrink-0 animate-in flex-col border-s bg-muted/10 duration-200 slide-in-from-right"
      aria-label={t('details')}
    >
      {panel}
    </aside>
  );
}
