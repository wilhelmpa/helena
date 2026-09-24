import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import PageHeader from './PageHeader';
import { useTranslations } from 'next-intl';

// The chrome for a standalone full-height page rendered outside any shell: a top bar
// built like the app header (48px, sidebar hairline, a back link and the page's name),
// and a centered column with a header (title and description). The account pages no
// longer use it — they have their own shell (AccountShell) — it stays for a page that
// has no sidebar to live in.
export default function FullPageView({
  label,
  title,
  description,
  actions,
  nav,
  children,
}: {
  label: string;
  title: string;
  description: ReactNode;
  // Rendered on the right of the header row.
  actions?: ReactNode;
  // A section rail placed left of the content column on wide viewports; the page
  // widens to make room for it.
  nav?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations('common');
  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-sidebar-border bg-background px-2 sm:px-3">
        <Button asChild variant="ghost" size="icon" className="size-8" title={t('back')}>
          <Link href="/">
            <ArrowLeft />
          </Link>
        </Button>
        <span className="text-sm font-medium">{label}</span>
      </header>
      <div
        className={cn(
          'mx-auto flex w-full gap-6 px-4 py-6 sm:px-6',
          nav ? 'max-w-[1000px]' : 'max-w-3xl',
        )}
      >
        {nav}
        <div className="w-full max-w-3xl min-w-0">
          <PageHeader title={title} description={description} actions={actions} />
          {children}
        </div>
      </div>
    </div>
  );
}
