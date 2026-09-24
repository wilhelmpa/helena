import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import HelenaMark from '@/components/brand/HelenaMark';
import { Button } from '@/components/ui/button';

// An address no page answers (a mistyped or outdated link): said in the reader's
// language, in Helena's frame, with the way back to Start — instead of the framework's
// bare English 404 on black.
export default async function NotFound() {
  const t = await getTranslations('common.notFound');
  return (
    <main className="flex min-h-svh items-center justify-center bg-card p-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-xl border border-sidebar-border bg-background p-8 text-center shadow-[var(--overlay-shadow)]">
        <HelenaMark className="size-12" />
        <h1 className="text-base font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
        <Button asChild variant="outline">
          <Link href="/">{t('home')}</Link>
        </Button>
      </div>
    </main>
  );
}
