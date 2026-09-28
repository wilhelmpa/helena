'use client';

import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { resolveText } from '@helena/sdk/web';
import { byKey } from '@/utils/messageKey';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { formatDuration } from '@/utils/dates';
import { serverPath } from '@/utils/paths';
import {
  serverKeys,
  useRestartLocalAi,
  useServerOverview,
  useServerSystem,
} from '../services/server.service';
import { formatMemory, isServerTab, orderedHealth, type ServerTab } from '../utils/serverFormat';
import { CardHeader, Fact, Facts, HealthLine, ServerSections } from './ServerParts';
import ServerToolbar from './ServerToolbar';

// Server → Übersicht: the machine at a glance, its memory (the GPU's share is the owner's
// firmware choice for local models and is shown as it is, without judging it), and every
// health line of every area, problems first.
export default function OverviewTab({ tabs }: { tabs: ServerTab[] }) {
  const t = useTranslations('server');
  const tRoot = useTranslations();
  const locale = useLocale();
  const qc = useQueryClient();
  const overview = useServerOverview();
  const system = useServerSystem();
  const restart = useRestartLocalAi();
  const data = system.data;
  const refreshing = overview.isFetching || system.isFetching;

  const areas = (overview.data?.capabilities ?? [])
    .filter((capability) => capability.available && capability.health.length > 0)
    .map((capability) => ({ capability, items: orderedHealth(capability.health) }));

  return (
    <>
      <ServerToolbar
        tab="overview"
        tabs={tabs}
        refreshing={refreshing}
        onRefresh={() => void qc.invalidateQueries({ queryKey: serverKeys.all })}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="space-y-3 rounded-md border border-sidebar-border bg-card p-4">
          <CardHeader title={t('overview.machine')} />
          {data ? (
            <Facts>
              <Fact label={t('overview.board')}>
                {[data.boardVendor, data.boardName, data.productName].filter(Boolean).join(' · ') ||
                  '–'}
              </Fact>
              <Fact label={t('overview.cpu')}>
                {data.cpuModel ?? '–'}
                {data.cpuCount ? ` · ${t('overview.threads', { count: data.cpuCount })}` : ''}
              </Fact>
              <Fact label={t('overview.hostname')}>{data.hostname ?? '–'}</Fact>
              <Fact label={t('overview.kernel')}>
                <span dir="ltr">{data.kernel ?? '–'}</span>
              </Fact>
              <Fact label={t('overview.uptime')}>
                {data.uptimeSeconds !== null ? formatDuration(data.uptimeSeconds * 1000) : '–'}
              </Fact>
              <Fact label={t('overview.load')}>
                <span dir="ltr">
                  {data.load.map((value) => value.toFixed(2)).join(' · ') || '–'}
                </span>
              </Fact>
            </Facts>
          ) : (
            <ListSkeleton rows={2} />
          )}
        </section>

        <section className="space-y-3 rounded-md border border-sidebar-border bg-card p-4">
          <CardHeader title={t('overview.memory')} />
          {data ? (
            <Facts>
              <Fact label={t('overview.memorySystem')}>{formatMemory(data.memory.totalBytes)}</Fact>
              <Fact label={t('overview.memoryAvailable')}>
                {formatMemory(data.memory.availableBytes)}
              </Fact>
              {data.gpuMemory && (
                <Fact label={t('overview.memoryGpu')}>
                  {formatMemory(data.gpuMemory.vramTotalBytes)}
                </Fact>
              )}
              {data.gpuMemory && (
                <Fact label={t('overview.memoryGpuUsed')}>
                  {formatMemory(data.gpuMemory.vramUsedBytes)}
                </Fact>
              )}
              {!!data.memory.swapTotalBytes && (
                <Fact label={t('overview.swap')}>
                  {t('overview.swapUsed', {
                    used: formatMemory(
                      (data.memory.swapTotalBytes ?? 0) - (data.memory.swapFreeBytes ?? 0),
                    ),
                    total: formatMemory(data.memory.swapTotalBytes),
                  })}
                </Fact>
              )}
            </Facts>
          ) : (
            <ListSkeleton rows={2} />
          )}
        </section>

        <section className="space-y-3 rounded-md border border-sidebar-border bg-card p-4 xl:col-span-2">
          <CardHeader title={t('overview.localAiGuard')}>
            <Button
              variant="outline"
              size="sm"
              disabled={restart.isPending || !data?.guard?.problem}
              onClick={() =>
                restart.mutate(undefined, {
                  onSuccess: () => toast.success(t('overview.restartDone')),
                  onError: (error) => toast.error(error.message),
                })
              }
            >
              {t('overview.restartLocalAi')}
            </Button>
          </CardHeader>
          {data ? (
            <Facts>
              {!data.gpuProcesses?.length && (
                <Fact label={t('overview.eviction')}>{t('overview.notMeasured')}</Fact>
              )}
              {(data.gpuProcesses ?? []).map((process) => (
                <Fact
                  key={`${process.gpu}:${process.pid}`}
                  label={`${t('overview.eviction')} · GPU ${process.gpu} · ${process.name || process.pid}`}
                >
                  {process.evictedMs5m == null
                    ? t('overview.notMeasured')
                    : `${(process.evictedMs5m / 1000).toFixed(1)} s`}
                </Fact>
              ))}
              <Fact label={t('overview.probe')}>
                {data.guard?.probeMs == null
                  ? t('overview.notMeasured')
                  : `${(data.guard.probeMs / 1000).toFixed(1)} s`}
              </Fact>
            </Facts>
          ) : (
            <ListSkeleton rows={1} />
          )}
        </section>

        <section className="space-y-2 rounded-md border border-sidebar-border bg-card p-4 xl:col-span-2">
          <CardHeader title={t('overview.health')} />
          {overview.data ? (
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 lg:grid-cols-2">
              {areas.map(({ capability, items }) => (
                <div key={capability.id} className="min-w-0">
                  {isServerTab(capability.area) ? (
                    <Link
                      href={serverPath(capability.area)}
                      className="flex h-8 items-center px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      {resolveText(capability.label, locale, (key) => byKey(tRoot)(key))}
                    </Link>
                  ) : (
                    <div className="flex h-8 items-center px-2 text-xs font-medium text-muted-foreground">
                      {resolveText(capability.label, locale, (key) => byKey(tRoot)(key))}
                    </div>
                  )}
                  <ul>
                    {items.map((item) => (
                      <HealthLine key={item.id} item={item} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <ListSkeleton rows={3} />
          )}
          {overview.data?.helper.version && (
            <p className="px-2 pt-2 text-xs text-muted-foreground">
              {t('overview.helper', { version: overview.data.helper.version })}
            </p>
          )}
        </section>
        <ServerSections area="overview" />
      </div>
    </>
  );
}
