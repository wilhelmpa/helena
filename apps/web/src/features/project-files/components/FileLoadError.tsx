import { Card, Notice } from '@/design-system';
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
      <Card>
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
      </Card>
    );
  }
  return (
    <Notice
      tone="danger"
      action={
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('retry')}
        </Button>
      }
    >
      {t('loadError')}
    </Notice>
  );
}
