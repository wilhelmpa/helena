import type { ReactNode } from 'react';
import { useGodSectionText } from '@/hooks/useSectionLabels';
import SectionPageView from '@/components/common/page/SectionPageView';

import { Stack } from '@/design-system';

// The chrome shared by every Administrator page: title and description taken from the
// section entry (both only for assistive technology: the header's breadcrumb names the
// page), and 24px between the page's sections. The directory pages pass a
// `widthClassName` that spans the whole shell, because their tables are wide.
export default function GodSectionPage({
  slug,
  actions,
  widthClassName,
  children,
}: {
  slug: string;
  actions?: ReactNode;
  widthClassName?: string;
  children: ReactNode;
}) {
  const section = useGodSectionText().section(slug);
  return (
    <SectionPageView title={section.label} widthClassName={widthClassName} actions={actions}>
      <Stack gap={5} className="flex flex-1 flex-col">
        {children}
      </Stack>
    </SectionPageView>
  );
}
