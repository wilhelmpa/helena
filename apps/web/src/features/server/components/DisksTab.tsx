'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { HardDriveDownload, LifeBuoy, Play, Square, Stethoscope } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import StatusBadge from '@/components/common/page/StatusBadge';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import type { HostDisk, HostEvents, RaidArray, StorageStatus } from '@/lib/api/endpoints/server';
import { formatDateTime, formatDuration } from '@/utils/dates';
import { byKey } from '@/utils/messageKey';
import {
  serverKeys,
  useBootReserveOnce,
  useCancelBootReserve,
  useMarkEventsSeen,
  useServerDisks,
  useStartRaidCheck,
  useStartSelfTest,
  useStopRaidCheck,
  useAreaHealth,
} from '../services/server.service';
import {
  formatCelsius,
  formatDiskSize,
  formatPercent,
  healthStatus,
  type ServerTab,
} from '../utils/serverFormat';
import ReplaceDiskDialog from './ReplaceDiskDialog';
import { CardHeader, Fact, Facts, HealthLine, Meter, ServerSections } from './ServerParts';
import ServerToolbar from './ServerToolbar';

const CARD = 'min-w-0 space-y-3 rounded-lg border border-sidebar-border bg-card p-4';

// Server → Platten & RAID: the mirror and its rebuilds and checks, each disk with its SMART
// health, the two EFI partitions and the firmware's boot entries, what mdadm and smartd
// reported, and the guided replacement of a disk.
export default function DisksTab({ tabs }: { tabs: ServerTab[] }) {
  const t = useTranslations('server.disks');
  const tServer = useTranslations('server');
  const qc = useQueryClient();
  const disks = useServerDisks();
  const [replacing, setReplacing] = useState(false);
  const storage = disks.data?.storage;

  return (
    <>
      <ServerToolbar
        tab="disks"
        tabs={tabs}
        refreshing={disks.isFetching}
        onRefresh={() => void qc.invalidateQueries({ queryKey: serverKeys.disks })}
        actions={
          storage
            ? [
                {
                  id: 'replace',
                  label: t('replace.open'),
                  icon: LifeBuoy,
                  onClick: () => setReplacing(true),
                },
              ]
            : []
        }
      />
      {!storage ? (
        disks.isError ? (
          <p className="text-sm text-muted-foreground">{tServer('readFailed')}</p>
        ) : (
          <ListSkeleton rows={4} rowClassName="h-20" />
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {storage.arrays.map((array) => (
            <ArrayCard key={array.kname} array={array} storage={storage} />
          ))}
          {storage.arrays.length === 0 && (
            <section className={CARD}>
              <CardHeader title={t('arrays')} />
              <p className="text-sm text-muted-foreground">{t('noArrays')}</p>
            </section>
          )}
          <BootCard storage={storage} />
          {storage.disks.map((disk) => (
            <DiskCard key={disk.kname} disk={disk} />
          ))}
          <EventsCard events={disks.data?.events ?? null} />
          <ServerSections area="disks" />
        </div>
      )}
      {replacing && storage && (
        <ReplaceDiskDialog storage={storage} onClose={() => setReplacing(false)} />
      )}
    </>
  );
}

// "Platte A" from the partition labels, else the kernel's name.
function useDiskLabel() {
  const t = useTranslations('server.disks');
  return (disk: Pick<HostDisk, 'letter' | 'kname'>) =>
    disk.letter ? t('diskLetter', { letter: disk.letter }) : disk.kname;
}

function ArrayCard({ array, storage }: { array: RaidArray; storage: StorageStatus }) {
  const t = useTranslations('server.disks');
  const start = useStartRaidCheck();
  const stop = useStopRaidCheck();
  const [confirmStart, setConfirmStart] = useState(false);
  const diskLabel = useDiskLabel();
  const health = useAreaHealth('disks').find((item) => item.id === `raid:${array.name}`);
  const action = array.syncAction ?? 'idle';
  const syncing = action !== 'idle';
  const diskOf = (device: string) =>
    storage.disks.find((disk) => disk.partitions.some((part) => part.kname === device));

  return (
    <section className={CARD}>
      <CardHeader title={t('arrayTitle', { name: array.name, level: array.level ?? '' })}>
        {array.syncAction === 'idle' && array.degraded === 0 && (
          <Button variant="outline" size="sm" onClick={() => setConfirmStart(true)}>
            <Play />
            {t('checkStart')}
          </Button>
        )}
        {(array.syncAction === 'check' || array.syncAction === 'repair') && (
          <Button
            variant="outline"
            size="sm"
            disabled={stop.isPending}
            onClick={() =>
              stop.mutate(array.name, { onSuccess: () => toast.success(t('checkStopped')) })
            }
          >
            <Square />
            {t('checkStop')}
          </Button>
        )}
      </CardHeader>
      {health && (
        <ul>
          <HealthLine item={health} className="px-0" />
        </ul>
      )}
      {syncing && array.syncPercent !== null && (
        <div className="space-y-1">
          <Meter
            percent={array.syncPercent}
            tone={array.degraded > 0 ? 'waiting' : 'running'}
            label={t(`syncAction.${action}`)}
          />
          <p className="text-xs text-muted-foreground">
            {t('syncProgress', {
              action: t(`syncAction.${action}`),
              percent: formatPercent(array.syncPercent),
              remaining: array.syncRemainingSeconds
                ? formatDuration(array.syncRemainingSeconds * 1000)
                : '–',
              speed: array.syncSpeedKiB ? formatDiskSize(array.syncSpeedKiB * 1024) : '–',
            })}
          </p>
        </div>
      )}
      <ul className="space-y-1">
        {array.members.map((member) => {
          const disk = diskOf(member.device);
          const inSync = member.states.includes('in_sync');
          const faulty = member.states.includes('faulty');
          return (
            <li key={member.device} className="flex min-w-0 items-center gap-2 text-sm">
              <StatusBadge status={faulty ? 'danger' : inSync ? 'success' : 'running'} dotOnly />
              <span className="min-w-0 flex-1 truncate">
                {disk ? diskLabel(disk) : member.device}
                <span className="text-muted-foreground" dir="ltr">
                  {' · '}
                  {member.device}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {faulty ? t('member.faulty') : inSync ? t('member.inSync') : t('member.rebuilding')}
              </span>
            </li>
          );
        })}
        {array.degraded > 0 &&
          array.members.length < (array.raidDisks ?? 0) &&
          Array.from({ length: (array.raidDisks ?? 0) - array.members.length }, (_, index) => (
            <li key={`missing-${index}`} className="flex items-center gap-2 text-sm">
              <StatusBadge status="danger" dotOnly />
              <span className="text-muted-foreground">{t('member.missing')}</span>
            </li>
          ))}
      </ul>
      {array.mismatchCount !== null && array.syncAction === 'idle' && (
        <p className="text-xs text-muted-foreground">
          {t('mismatches', { count: array.mismatchCount })}
        </p>
      )}
      {confirmStart && (
        <ConfirmDialog
          title={t('checkConfirmTitle')}
          confirmLabel={t('checkStart')}
          onClose={() => setConfirmStart(false)}
          onConfirm={async () => {
            await start.mutateAsync(array.name);
            toast.success(t('checkStarted'));
            setConfirmStart(false);
          }}
        >
          <p className="text-sm">{t('checkConfirmBody')}</p>
        </ConfirmDialog>
      )}
    </section>
  );
}

function DiskCard({ disk }: { disk: HostDisk }) {
  const t = useTranslations('server.disks');
  const diskLabel = useDiskLabel();
  const selfTest = useStartSelfTest();
  const smart = disk.smart && !disk.smart.error ? disk.smart : null;
  return (
    <section className={CARD}>
      <CardHeader
        title={
          <span className="flex min-w-0 items-center gap-2">
            <StatusBadge status={healthStatus(disk.health)} dotOnly />
            <span className="truncate">{diskLabel(disk)}</span>
          </span>
        }
      >
        {smart?.selfTestSupported && (
          <Button
            variant="outline"
            size="sm"
            disabled={selfTest.isPending || !!smart.selfTestRunning}
            onClick={() =>
              selfTest.mutate(disk.kname, { onSuccess: () => toast.success(t('selfTestStarted')) })
            }
          >
            <Stethoscope />
            {smart.selfTestRunning ? t('selfTestRunning') : t('selfTest')}
          </Button>
        )}
      </CardHeader>
      <p className="truncate text-sm">
        {disk.model ?? '–'}
        <span className="text-muted-foreground">
          {' · '}
          {formatDiskSize(disk.sizeBytes)}
          {disk.serial ? ` · ${t('serial', { serial: disk.serial })}` : ''}
        </span>
      </p>
      {smart ? (
        <Facts>
          <Fact label={t('smart.state')}>
            {smart.failing
              ? t('smart.failing')
              : smart.passed
                ? t('smart.passed')
                : t('smart.unknown')}
          </Fact>
          <Fact label={t('smart.temperature')}>{formatCelsius(smart.temperatureC)}</Fact>
          <Fact label={t('smart.wear')}>{formatPercent(smart.wearPercent)}</Fact>
          <Fact label={t('smart.spare')}>
            {smart.availableSpare !== null
              ? t('smart.spareValue', {
                  spare: formatPercent(smart.availableSpare),
                  threshold: formatPercent(smart.availableSpareThreshold),
                })
              : '–'}
          </Fact>
          <Fact label={t('smart.powerOn')}>
            {smart.powerOnHours !== null ? t('smart.hours', { hours: smart.powerOnHours }) : '–'}
          </Fact>
          <Fact label={t('smart.written')}>{formatDiskSize(smart.dataWrittenBytes)}</Fact>
          <Fact label={t('smart.mediaErrors')}>{smart.mediaErrors ?? '–'}</Fact>
          <Fact label={t('smart.unsafeShutdowns')}>{smart.unsafeShutdowns ?? '–'}</Fact>
          <Fact label={t('smart.firmware')}>{smart.firmware ?? '–'}</Fact>
        </Facts>
      ) : (
        <p className="text-sm text-muted-foreground">{t('smart.none')}</p>
      )}
      {disk.arrays.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('memberOf', { arrays: disk.arrays.join(', ') })}
          {disk.mountpoints.length > 0 ? ` · ${disk.mountpoints.join(', ')}` : ''}
        </p>
      )}
    </section>
  );
}

function BootCard({ storage }: { storage: StorageStatus }) {
  const t = useTranslations('server.disks');
  const reserve = useBootReserveOnce();
  const cancel = useCancelBootReserve();
  const [confirm, setConfirm] = useState(false);
  const boot = storage.boot;
  const esp = storage.esp;
  const nextIsReserve = !!boot?.next && boot.next === storage.reserveEntry?.number;
  const espState = esp.mounts.some((mount) => !mount.mounted)
    ? 'attention'
    : esp.inSync === false
      ? 'attention'
      : esp.inSync
        ? 'ok'
        : 'unknown';

  return (
    <section className={CARD}>
      <CardHeader title={t('boot.title')}>
        {storage.reserveEntry && !nextIsReserve && (
          <Button variant="outline" size="sm" onClick={() => setConfirm(true)}>
            <HardDriveDownload />
            {t('boot.reserveOnce')}
          </Button>
        )}
        {nextIsReserve && (
          <Button
            variant="outline"
            size="sm"
            disabled={cancel.isPending}
            onClick={() =>
              cancel.mutate(undefined, { onSuccess: () => toast.success(t('boot.canceled')) })
            }
          >
            {t('boot.cancel')}
          </Button>
        )}
      </CardHeader>
      <ul className="space-y-1">
        <li className="flex min-w-0 items-center gap-2 text-sm">
          <StatusBadge status={healthStatus(espState)} dotOnly />
          <span className="min-w-0 flex-1">
            {esp.mounts.some((mount) => !mount.mounted)
              ? t('boot.espMissing', {
                  mounts: esp.mounts
                    .filter((mount) => !mount.mounted)
                    .map((mount) => mount.mount)
                    .join(', '),
                })
              : esp.inSync === false
                ? t('boot.espDiffer', { count: esp.differenceCount })
                : esp.inSync
                  ? t('boot.espInSync', {
                      mounts: esp.mounts.map((mount) => mount.mount).join(' = '),
                    })
                  : t('boot.espUnknown')}
          </span>
        </li>
        {esp.differences.length > 0 && (
          <li className="ps-4 text-xs text-muted-foreground" dir="ltr">
            {esp.differences.join(', ')}
          </li>
        )}
      </ul>
      {boot && !boot.error ? (
        <ul className="space-y-1">
          {boot.entries.map((entry) => (
            <li key={entry.number} className="flex min-w-0 items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {entry.label}
                <span className="text-muted-foreground">
                  {entry.disk ? ` · ${t('diskLetter', { letter: entry.disk })}` : ''}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {[
                  boot.current === entry.number ? t('boot.current') : null,
                  boot.next === entry.number ? t('boot.next') : null,
                  boot.order[0] === entry.number ? t('boot.first') : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('boot.none')}</p>
      )}
      {nextIsReserve && <p className="text-xs text-status-waiting">{t('boot.pending')}</p>}
      {confirm && (
        <ConfirmDialog
          title={t('boot.confirmTitle')}
          confirmLabel={t('boot.reserveOnce')}
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            await reserve.mutateAsync(undefined);
            toast.success(t('boot.set'));
            setConfirm(false);
          }}
        >
          <p className="text-sm">{t('boot.confirmBody')}</p>
        </ConfirmDialog>
      )}
    </section>
  );
}

function EventsCard({ events }: { events: HostEvents | null }) {
  const t = useTranslations('server.events');
  const read = byKey(useTranslations('server.events.codes'));
  const tCodes = useTranslations('server.events.codes');
  const seen = useMarkEventsSeen();
  const list = events?.events ?? [];
  // mdadm reports a rebuild's progress as Rebuild20, Rebuild40, …
  const eventTitle = (code: string) => {
    const progress = /^Rebuild(\d+)$/.exec(code);
    if (progress) return tCodes('RebuildProgress', { percent: Number(progress[1]) });
    return tCodes.has(code as never) ? read(code) : code;
  };
  return (
    <section className={`${CARD} xl:col-span-2`}>
      <CardHeader title={t('title')}>
        {events && events.unseen > 0 && list[0] && (
          <Button
            variant="outline"
            size="sm"
            disabled={seen.isPending}
            onClick={() => seen.mutate(list[0]!.id)}
          >
            {t('markSeen', { count: events.unseen })}
          </Button>
        )}
      </CardHeader>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {list.slice(0, 50).map((event) => (
            <li key={event.id} className="flex min-w-0 items-start gap-2 text-sm">
              <span className="mt-1.5">
                <StatusBadge
                  status={
                    event.severity === 'critical'
                      ? 'danger'
                      : event.severity === 'warning'
                        ? 'waiting'
                        : 'idle'
                  }
                  dotOnly
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className={event.id > (events?.seenUpTo ?? 0) ? 'font-medium' : undefined}>
                  {eventTitle(event.code)}
                </span>
                <span className="text-muted-foreground">
                  {' · '}
                  {t(`source.${event.source}` as never)}
                  {event.device ? ` · ${event.device}` : ''}
                </span>
                {event.message && (
                  <span className="block truncate text-xs text-muted-foreground" dir="auto">
                    {event.message}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatDateTime(event.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
