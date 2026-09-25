'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, FolderSearch, ShieldCheck, TestTube2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import CopyableCommand from '@/components/common/page/CopyableCommand';
import { EmptyState } from '@/components/common/page/EmptyState';
import StatusBadge from '@/components/common/page/StatusBadge';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type {
  BackupReading,
  BackupRetention,
  BackupRunResult,
  BackupSchedule,
} from '@/lib/api/endpoints/server';
import { formatDateTime, formatDurationShort } from '@/utils/dates';
import {
  serverKeys,
  useAreaHealth,
  useBackupSnapshots,
  useRunBackup,
  useServerBackup,
  useSetBackupSettings,
} from '../services/server.service';
import { formatDiskSize, type ServerTab } from '../utils/serverFormat';
import BackupPasswordCard from './BackupPasswordCard';
import BackupTargetsCard from './BackupTargetsCard';
import SnapshotBrowser from './SnapshotBrowser';
import { CardHeader, Fact, Facts, HealthLine, ServerSections } from './ServerParts';
import ServerToolbar from './ServerToolbar';

const CARD = 'min-w-0 space-y-3 rounded-lg border border-sidebar-border bg-card p-4';

// Server → Backup: restic into the local repository on the RAID. The last run and the next,
// the password to write down once, when backups run and how many are kept, the snapshots
// (browse them, restore a file or a folder), the weekly check and the monthly restore test.
export default function BackupTab({ tabs }: { tabs: ServerTab[] }) {
  const t = useTranslations('server.backup');
  const tServer = useTranslations('server');
  const tCommon = useTranslations('common');
  const qc = useQueryClient();
  const backup = useServerBackup();
  const run = useRunBackup();
  const data = backup.data;
  const running = data ? Object.values(data.running).some(Boolean) : false;

  const start = (kind: 'backup' | 'maintenance' | 'restore-test') =>
    run.mutate(kind, { onSuccess: () => toast.success(t(`started.${kind}`)) });

  return (
    <>
      <ServerToolbar
        tab="backup"
        tabs={tabs}
        refreshing={backup.isFetching}
        onRefresh={() => void qc.invalidateQueries({ queryKey: serverKeys.backup })}
        actions={
          data?.initialized
            ? [
                {
                  id: 'check',
                  label: t('runMaintenance'),
                  icon: ShieldCheck,
                  onClick: () => start('maintenance'),
                  disabled: running,
                  menuOnly: true,
                },
                {
                  id: 'restore-test',
                  label: t('runRestoreTest'),
                  icon: TestTube2,
                  onClick: () => start('restore-test'),
                  disabled: running,
                  menuOnly: true,
                },
              ]
            : []
        }
        primary={
          data?.initialized
            ? {
                id: 'backup',
                label: running ? t('running') : t('runNow'),
                icon: Archive,
                onClick: () => start('backup'),
                disabled: running || run.isPending,
              }
            : undefined
        }
      />
      {!data ? (
        backup.isError ? (
          <p className="text-sm text-muted-foreground">{tServer('readFailed')}</p>
        ) : (
          <ListSkeleton rows={4} rowClassName="h-20" />
        )
      ) : !data.installed || !data.initialized ? (
        <EmptyState title={t('notSetUp.title')} description={t('notSetUp.description')}>
          <div className="w-full max-w-xl">
            <CopyableCommand
              command="sudo deployment/volition-stack/native/server/install.sh backup-init"
              copyLabel={tCommon('copy')}
              copiedLabel={tCommon('copied')}
            />
          </div>
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {data.passwordState === 'unrevealed' && <BackupPasswordCard />}
          <StatusCard data={data} />
          <ScheduleCard key={JSON.stringify([data.schedule, data.retention])} data={data} />
          <SnapshotsCard ownerHome={data.ownerHome} />
          <ChecksCard data={data} />
          <RestoresCard data={data} />
          {data.remoteTargets && <BackupTargetsCard targets={data.targets} />}
          <PathsCard paths={data.paths} />
          <ServerSections area="backup" />
        </div>
      )}
    </>
  );
}

function StatusCard({ data }: { data: BackupReading }) {
  const t = useTranslations('server.backup');
  const health = useAreaHealth('backup').filter((item) => item.id === 'backup:last');
  const last = data.last.backup;
  return (
    <section className={CARD}>
      <CardHeader title={t('status')} />
      <ul>
        {health.map((item) => (
          <HealthLine key={item.id} item={item} className="px-0" />
        ))}
        {data.running.backup && (
          <li className="flex min-h-8 items-center gap-2 text-sm">
            <StatusBadge status="running" dotOnly />
            {t('runningNow')}
          </li>
        )}
      </ul>
      <Facts>
        <Fact label={t('lastSnapshot')}>
          <span dir="ltr">{last?.snapshot ? last.snapshot.slice(0, 8) : '–'}</span>
        </Fact>
        <Fact label={t('added')}>{formatDiskSize(last?.dataAddedBytes)}</Fact>
        <Fact label={t('processed')}>
          {last?.filesTotal != null
            ? t('filesAndSize', { files: last.filesTotal, size: formatDiskSize(last.bytesTotal) })
            : '–'}
        </Fact>
        <Fact label={t('repositorySize')}>{formatDiskSize(last?.repositoryBytes)}</Fact>
        <Fact label={t('nextRun')}>
          {data.next.backup ? formatDateTime(data.next.backup) : t('noNextRun')}
        </Fact>
        <Fact label={t('repository')}>
          <span dir="ltr">{data.repository}</span>
        </Fact>
      </Facts>
      {last?.error && <p className="text-xs text-destructive">{last.error}</p>}
      {last?.warning === 'unreadable_files' && (
        <p className="text-xs text-status-waiting">
          {t('unreadable', { count: last.unreadable ?? 0 })}
        </p>
      )}
    </section>
  );
}

function ScheduleCard({ data }: { data: BackupReading }) {
  const t = useTranslations('server.backup');
  const tCommon = useTranslations('common');
  const save = useSetBackupSettings();
  const [schedule, setSchedule] = useState<BackupSchedule>(data.schedule);
  const [retention, setRetention] = useState<BackupRetention>(data.retention);
  // The card is keyed by the reading, so a schedule saved elsewhere starts a fresh draft.
  const dirty =
    JSON.stringify(schedule) !== JSON.stringify(data.schedule) ||
    JSON.stringify(retention) !== JSON.stringify(data.retention);
  const keeps = Object.values(retention).some((value) => value > 0);

  return (
    <section className={CARD}>
      <CardHeader title={t('schedule.title')}>
        {dirty && (
          <Button
            size="sm"
            disabled={save.isPending || !keeps}
            onClick={() =>
              save.mutate({ schedule, retention }, { onSuccess: () => toast.success(t('saved')) })
            }
          >
            {tCommon('save')}
          </Button>
        )}
      </CardHeader>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted-foreground">{t('schedule.frequency')}</span>
          <Select
            value={schedule.frequency}
            onValueChange={(frequency) =>
              setSchedule({ ...schedule, frequency: frequency as BackupSchedule['frequency'] })
            }
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['hourly', 'every6h', 'daily', 'off'] as const).map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`schedule.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        {schedule.frequency !== 'off' && (
          <label className="space-y-1 text-sm">
            <span className="block text-xs text-muted-foreground">
              {schedule.frequency === 'hourly' ? t('schedule.minute') : t('schedule.time')}
            </span>
            <Input
              type="time"
              value={schedule.time}
              onChange={(event) => setSchedule({ ...schedule, time: event.target.value })}
              className="w-32"
            />
          </label>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {t(`schedule.explain.${schedule.frequency}`, {
          time: schedule.time,
          minute: schedule.time.slice(3),
        })}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(['hourly', 'daily', 'weekly', 'monthly'] as const).map((key) => (
          <label key={key} className="space-y-1 text-sm">
            <span className="block text-xs text-muted-foreground">{t(`retention.${key}`)}</span>
            <Input
              type="number"
              min={0}
              value={retention[key]}
              onChange={(event) =>
                setRetention({ ...retention, [key]: Math.max(0, Number(event.target.value) || 0) })
              }
            />
          </label>
        ))}
      </div>
      {!keeps && <p className="text-xs text-destructive">{t('retention.keepSomething')}</p>}
      <div className="divide-y divide-sidebar-border rounded-md border border-sidebar-border">
        <ToggleRow
          label={t('checkWeekly')}
          checked={data.checkWeekly}
          onChange={(checkWeekly) => save.mutate({ checkWeekly })}
        />
        <ToggleRow
          label={t('restoreTestMonthly')}
          checked={data.restoreTestMonthly}
          onChange={(restoreTestMonthly) => save.mutate({ restoreTestMonthly })}
        />
      </div>
    </section>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex min-h-10 items-center justify-between gap-3 px-3 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function SnapshotsCard({ ownerHome }: { ownerHome: string | null }) {
  const t = useTranslations('server.backup');
  const snapshots = useBackupSnapshots();
  const [browsing, setBrowsing] = useState<string | null>(null);
  const list = snapshots.data?.snapshots ?? [];
  return (
    <section className={`${CARD} xl:col-span-2`}>
      <CardHeader title={t('snapshots.title')}>
        {list.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {t('snapshots.count', { count: list.length })}
          </span>
        )}
      </CardHeader>
      {snapshots.isPending ? (
        <ListSkeleton rows={3} />
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('snapshots.none')}</p>
      ) : (
        <ul className="max-h-96 divide-y divide-sidebar-border overflow-y-auto rounded-md border border-sidebar-border">
          {list.map((snapshot) => (
            <li
              key={snapshot.id}
              className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-sm"
            >
              <span className="min-w-0 flex-1">
                {formatDateTime(snapshot.time)}
                <span className="text-muted-foreground" dir="ltr">
                  {' · '}
                  {snapshot.shortId}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">
                {snapshot.dataAddedBytes != null
                  ? t('snapshots.added', { size: formatDiskSize(snapshot.dataAddedBytes) })
                  : ''}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setBrowsing(snapshot.id)}>
                <FolderSearch />
                {t('snapshots.browse')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {browsing && (
        <SnapshotBrowser
          snapshot={browsing}
          ownerHome={ownerHome}
          onClose={() => setBrowsing(null)}
        />
      )}
    </section>
  );
}

function RunLine({ label, result }: { label: string; result: BackupRunResult | null }) {
  const t = useTranslations('server.backup');
  return (
    <li className="flex min-h-8 min-w-0 items-center gap-2 text-sm">
      <StatusBadge status={!result ? 'idle' : result.ok ? 'success' : 'danger'} dotOnly />
      <span className="min-w-0 flex-1 truncate">
        {label}
        <span className="text-muted-foreground">
          {' · '}
          {!result
            ? t('never')
            : result.ok
              ? t('okAt', { time: result.finishedAt ? formatDurationShort(result.finishedAt) : '' })
              : t('failedAt', {
                  time: result.finishedAt ? formatDurationShort(result.finishedAt) : '',
                })}
        </span>
      </span>
    </li>
  );
}

function ChecksCard({ data }: { data: BackupReading }) {
  const t = useTranslations('server.backup');
  const test = data.last['restore-test'];
  return (
    <section className={CARD}>
      <CardHeader title={t('checks.title')} />
      <ul>
        <RunLine label={t('checks.maintenance')} result={data.last.maintenance} />
        <RunLine label={t('checks.restoreTest')} result={test} />
      </ul>
      {test?.ok && test.database && (
        <p className="text-xs text-muted-foreground">
          {t('checks.restoreTestDetail', {
            files: test.filesRestored ?? 0,
            database: test.database.name,
            tables: test.database.tables,
          })}
        </p>
      )}
      {[data.last.maintenance, test].map((result, index) =>
        result && !result.ok && result.error ? (
          <p key={index} className="text-xs text-destructive">
            {result.error}
          </p>
        ) : null,
      )}
      <p className="text-xs text-muted-foreground">
        {t('checks.next', {
          maintenance: data.next.maintenance ? formatDateTime(data.next.maintenance) : '–',
          restoreTest: data.next['restore-test'] ? formatDateTime(data.next['restore-test']) : '–',
        })}
      </p>
    </section>
  );
}

function RestoresCard({ data }: { data: BackupReading }) {
  const t = useTranslations('server.backup');
  if (data.restores.length === 0) return null;
  return (
    <section className={CARD}>
      <CardHeader title={t('restores.title')} />
      <ul className="space-y-2">
        {data.restores.slice(0, 8).map((job) => (
          <li key={job.id} className="space-y-0.5 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <StatusBadge
                status={
                  job.state === 'done' ? 'success' : job.state === 'failed' ? 'danger' : 'running'
                }
                dotOnly
              />
              <span className="min-w-0 flex-1 truncate" dir="ltr">
                {job.path}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatDateTime(job.createdAt)}
              </span>
            </div>
            {job.location && (
              <p className="ps-3.5 text-xs text-muted-foreground">
                {t('restores.location')} <span dir="ltr">{job.location}</span>
              </p>
            )}
            {job.movedAside && (
              <p className="ps-3.5 text-xs text-muted-foreground">
                {t('restores.movedAside')} <span dir="ltr">{job.movedAside}</span>
              </p>
            )}
            {job.error && <p className="ps-3.5 text-xs text-destructive">{job.error}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PathsCard({ paths }: { paths: string[] }) {
  const t = useTranslations('server.backup');
  return (
    <section className={CARD}>
      <CardHeader title={t('paths.title')} />
      <p className="text-xs text-muted-foreground">{t('paths.explain')}</p>
      <ul className="flex flex-wrap gap-1.5">
        {paths.map((path) => (
          <li
            key={path}
            dir="ltr"
            className="rounded-md border border-sidebar-border px-2 py-0.5 font-mono text-xs"
          >
            {path}
          </li>
        ))}
      </ul>
    </section>
  );
}
