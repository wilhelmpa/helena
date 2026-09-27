import { useTranslations } from 'next-intl';
import type { UpdateCenter } from '@/lib/api/endpoints/updateCenter';
import { formatDateTime, formatDurationShort } from '@/utils/dates';
import { checkIncomplete, justNow } from '../utils/updateFormat';
import { useSourceText } from './UpdateCard';
import UpdateNotice from './UpdateNotice';

export default function UpdateCheckStatus({ center }: { center: UpdateCenter }) {
  const t = useTranslations('updates');
  const text = useSourceText();
  const failedSources = center.sources.filter((source) => source.error);
  return (
    <div className="space-y-2">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
        <span className="text-sm font-medium text-foreground">
          {center.counts.updates === 0
            ? t(checkIncomplete(center) ? 'checkIncomplete' : 'allCurrent')
            : [
                t('count', { count: center.counts.updates }),
                center.counts.security > 0
                  ? t('securityCount', { count: center.counts.security })
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
        </span>
        <span>
          {center.checkedAt
            ? justNow(center.checkedAt)
              ? t('checkedJustNow')
              : t('checkedAt', { time: formatDurationShort(center.checkedAt) })
            : t('neverChecked')}
        </span>
        {center.job.nextRunAt && (
          <span>{t('nextRun', { time: formatDateTime(center.job.nextRunAt) })}</span>
        )}
      </p>
      <p className="px-1 text-xs text-muted-foreground">
        {center.apt?.refreshedAt
          ? t('aptRefreshedAt', { time: formatDateTime(center.apt.refreshedAt) })
          : t('aptNotRefreshed')}
        {center.apt?.listsUpdatedAt && (
          <span> · {t('aptListsAt', { time: formatDateTime(center.apt.listsUpdatedAt) })}</span>
        )}
      </p>
      {!center.helper.installed && <UpdateNotice>{t('helperMissing')}</UpdateNotice>}
      {center.helper.installed && center.helper.error && (
        <UpdateNotice>{t('helperError', { error: center.helper.error })}</UpdateNotice>
      )}
      {center.job.lastStatus === 'failed' && center.job.lastError && (
        <UpdateNotice>{t('jobFailed', { error: center.job.lastError })}</UpdateNotice>
      )}
      {failedSources.map((source) => (
        <UpdateNotice key={source.id}>
          {t('sourceFailed', { source: text(source.label), error: source.error ?? '' })}
        </UpdateNotice>
      ))}
    </div>
  );
}
