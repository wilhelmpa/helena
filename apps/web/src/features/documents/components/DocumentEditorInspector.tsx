'use client';

import { Overlay } from '@/design-system';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTranslations } from 'next-intl';
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
  const isMobile = useIsMobile();

  if (!open) return null;

  const panel = (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
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
      <Overlay
        label={t('details')}
        tabs={[{ id: 'details', label: t('details') }]}
        onClose={() => onOpenChange(false)}
        bodyClassName="is-flush"
      >
        {panel}
      </Overlay>
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
