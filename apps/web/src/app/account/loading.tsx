import SectionPageSkeleton from '@/components/common/skeleton/SectionPageSkeleton';

// The stand-in for an account page while it loads, inside the account shell (see
// layout.tsx), so the sidebar and the header stay put.
export default function Loading() {
  return <SectionPageSkeleton />;
}
