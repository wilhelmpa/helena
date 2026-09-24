import { cn } from '@/lib/utils';
import { PAGE_GUTTER_CLASS, SECTION_COLUMN_CLASS } from '@/components/common/page/SectionPageView';
import PageSkeleton from './PageSkeleton';

// Stands in for a section page: the column and padding SectionPageView renders in,
// so the loaded section lands where the skeleton was.
export default function SectionPageSkeleton({ rows }: { rows?: number }) {
  return (
    <PageSkeleton rows={rows} className={cn('mx-0', PAGE_GUTTER_CLASS, SECTION_COLUMN_CLASS)} />
  );
}
