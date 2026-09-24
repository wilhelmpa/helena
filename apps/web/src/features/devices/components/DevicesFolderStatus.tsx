import { useTranslations } from 'next-intl';
import { useRelativeTime } from '@/context/relativeTimeContext';
import type { SyncFolder } from '@/lib/api/endpoints/deviceSync';
import StatusBadge, { type Status } from '@/components/common/page/StatusBadge';
import { folderStateKind } from '../utils/folderState';
import DevicesNotice from './DevicesNotice';
import DevicesSection from './DevicesSection';

const TONES: Record<string, Status> = {
  idle: 'success',
  scanning: 'running',
  syncing: 'running',
  error: 'danger',
  other: 'idle',
};

export default function DevicesFolderStatus({ folder }: { folder: SyncFolder | null }) {
  const t = useTranslations('devices.folder');
  const relativeTime = useRelativeTime();
  if (!folder) return <DevicesNotice>{t('notSetUp')}</DevicesNotice>;

  const kind = folderStateKind(folder.state, folder.error);
  return (
    <DevicesSection title={t('title')}>
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={TONES[kind] ?? 'idle'}>
          {kind === 'other' ? folder.state : t(`state.${kind}`)}
        </StatusBadge>
        <code dir="ltr" className="text-xs text-muted-foreground">
          {folder.path}
        </code>
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">{t('lastFile')}</dt>
        <dd className="min-w-0 truncate">
          {folder.lastFileAt
            ? t('lastFileValue', {
                time: relativeTime(folder.lastFileAt),
                name: folder.lastFileName ?? '',
              })
            : t('never')}
        </dd>
        <dt className="text-muted-foreground">{t('lastScan')}</dt>
        <dd>{folder.lastScanAt ? relativeTime(folder.lastScanAt) : t('never')}</dd>
      </dl>
      {folder.needItems > 0 ? (
        <p className="mt-3 text-sm">{t('needItems', { count: folder.needItems })}</p>
      ) : null}
      {folder.error ? (
        <p className="mt-3 text-sm text-destructive">{t('error', { error: folder.error })}</p>
      ) : null}
      {folder.fileErrorCount > 0 ? (
        <div className="mt-3 space-y-1 text-sm">
          <p className="text-destructive">{t('fileErrors', { count: folder.fileErrorCount })}</p>
          <ul dir="ltr" className="space-y-1 text-xs text-muted-foreground">
            {folder.fileErrors.map((error) => (
              <li key={error.path}>
                <code>{error.path}</code>: {error.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </DevicesSection>
  );
}
