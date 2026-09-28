import { Code2, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/core/client';

// Why a folder could not be listed. A workspace Plan may not read and a private folder
// that is not set up are states of the server, not failures to retry.
export default function FileLoadError({
  error,
  codeUrl,
  onRetry,
}: {
  error: Error;
  codeUrl: string;
  onRetry: () => void;
}) {
  const t = useTranslations('files');
  const unreadable = error instanceof ApiError && error.code === 'not_readable';
  const missing = error instanceof ApiError && error.status === 404;

  if (unreadable || missing) {
    return (
      <div className="rounded-md border p-4">
        <Lock className="size-6 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">
          {unreadable ? t('unreadable.title') : t('unreadable.missing')}
        </p>
        {unreadable && <p className="mt-1 text-sm text-muted-foreground">{t('unreadable.body')}</p>}
        {unreadable && codeUrl && (
          <Button size="sm" className="mt-4" asChild>
            <a href={codeUrl} target="_blank" rel="noopener noreferrer">
              <Code2 />
              {t('toolbar.openInCode')}
            </a>
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4">
      <p className="text-sm text-destructive">{t('loadError')}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        {t('retry')}
      </Button>
    </div>
  );
}
