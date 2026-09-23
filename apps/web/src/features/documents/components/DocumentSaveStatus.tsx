import { Check, CircleAlert, Eye, LoaderCircle, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { NoteSaveStatus } from '../utils/noteDraft';

export default function DocumentSaveStatus({
  status,
  dirty,
  editable,
  onRetry,
}: {
  status: NoteSaveStatus;
  dirty: boolean;
  editable: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations('documents');
  const failed = status === 'error' || status === 'conflict';
  const text = !editable
    ? t('readOnly')
    : status === 'conflict'
      ? t('conflict')
      : status === 'error'
        ? t('saveFailed')
        : status === 'saving' || dirty
          ? t('saving')
          : t('saved');
  const Icon = !editable
    ? Eye
    : failed
      ? CircleAlert
      : status === 'saving' || dirty
        ? LoaderCircle
        : Check;

  return (
    <>
      <div
        className={cn(
          'me-1 flex h-7 items-center gap-1.5 px-1 text-xs',
          status === 'error'
            ? 'text-destructive'
            : status === 'conflict'
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-muted-foreground',
        )}
        role="status"
        aria-live="polite"
        title={text}
      >
        <Icon className={cn('size-3', Icon === LoaderCircle && 'animate-spin')} />
        <span className="hidden lg:inline">{text}</span>
      </div>
      {status === 'error' && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('retrySave')}
          title={t('retrySave')}
          onClick={onRetry}
        >
          <RefreshCw />
        </Button>
      )}
    </>
  );
}
