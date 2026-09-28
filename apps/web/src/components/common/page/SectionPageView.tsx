'use client';

import type { ReactNode } from 'react';
import { Page } from '@/design-system/layout/PageTemplate';

// Kept for the pages written before the page template: a section page is a <Page>
// (docs/ui-framework.md). Full width on every page (owner, O30); `wide` and
// `widthClassName` no longer narrow anything and stay only so older call sites compile.
export const SECTION_COLUMN_CLASS = 'w-full';
export const PAGE_GUTTER_CLASS = 'px-8 py-6';

export default function SectionPageView({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  wide?: boolean;
  widthClassName?: string;
  children: ReactNode;
}) {
  return (
    <Page title={title} actions={actions}>
      {children}
    </Page>
  );
}
