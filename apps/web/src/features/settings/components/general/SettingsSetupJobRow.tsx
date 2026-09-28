import { CheckCircle2, CircleAlert, Clock3 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ProjectSetupJob } from '@/lib/api/endpoints/projects';
import { useRelativeTime } from '@/context/relativeTimeContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { Inline, Stack, Text } from '@/design-system';

// One setup job: its status, how many attempts it took, when it last changed and the
// last error. A failed job gets a retry button for a reader who may run it.
export default function SettingsSetupJobRow({
  title,
  description,
  job,
  canRetry,
  retrying,
  onRetry,
}: {
  title: string;
  description: string;
  job: ProjectSetupJob | null;
  canRetry: boolean;
  retrying: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations('settings.general.setup');
  const relativeTime = useRelativeTime();
  const Icon =
    job?.status === 'succeeded' ? CheckCircle2 : job?.status === 'failed' ? CircleAlert : Clock3;

  return (
    <Inline gap={4} justify="between" pad={4} className="flex items-center justify-between">
      <Stack gap={1} className="max-w-2xl">
        <div className="text-sm font-medium">{title}</div>
        <Text as="p" size="xs" tone="muted">
          {description}
        </Text>
        <Text as="p" size="xs" tone="muted">
          {job
            ? t('meta', { attempts: job.attempts, ago: relativeTime(job.updatedAt) })
            : t('missing')}
        </Text>
        {job?.lastError && (
          <Text as="p" size="xs" tone="danger" dir="auto">
            {t('lastError', { error: job.lastError })}
          </Text>
        )}
      </Stack>
      <Inline gap={2} className="flex shrink-0 items-center">
        {job && (
          <Badge variant="outline" className="gap-1">
            <Icon className="size-3.5" /> {t(`status.${job.status}`)}
          </Badge>
        )}
        {job?.status === 'failed' && canRetry && (
          <Button size="sm" variant="outline" disabled={retrying} onClick={onRetry}>
            {t('retry')}
          </Button>
        )}
      </Inline>
    </Inline>
  );
}
