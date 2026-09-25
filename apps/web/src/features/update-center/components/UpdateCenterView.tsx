'use client';

import { useState } from 'react';
import { CircleCheck, CircleHelp, Info, LoaderCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { RowList, SectionLabel } from '@/components/common/page/RowList';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PageActions } from '@/components/layout/PageToolbar';
import type { UpdateItem, UpdateScope } from '@/lib/api/endpoints/updateCenter';
import { cn } from '@/lib/utils';
import { formatDateTime, formatDurationShort } from '@/utils/dates';
import ApplyUpdateDialog from './ApplyUpdateDialog';
import UpdateCard, { useSourceText } from './UpdateCard';
import UpdateGroupCard from './UpdateGroupCard';
import UpdateHistory from './UpdateHistory';
import UpdateSettingsSection from './UpdateSettingsSection';
import {
  useApplyUpdate,
  useCheckForUpdates,
  useUpdateCenter,
} from '../services/updateCenter.service';
import { groupItems, justNow, runningAction, splitItems, versionStep } from '../utils/updateFormat';

// The update center's page content (owner, 2026-09-24: "alles updaten … regelmäßig nach
// Updates suchen … den Status auch im Dashboard anzeigen"): every component Helena runs on
// with its installed and newest version, what a new version changes and how risky it looks
// (a small model's summary), "Aktualisieren" where Helena can do it, the history, and the
// settings. Mounted as the Updates tab of Administrator → Server
// (features/server/updatesTab.tsx; /god/updates redirects there): the host puts
// <UpdateCheckAction /> into its one toolbar row (docs/volition/ui-standard.md) and
// <UpdateCenterView /> into its body.

// "Jetzt prüfen", for the page's toolbar (inside a <PageToolbar>).
export function UpdateCheckAction() {
  const t = useTranslations('updates');
  const query = useUpdateCenter();
  const check = useCheckForUpdates();
  const checking = check.isPending || query.data?.job.lastStatus === 'running';
  return (
    <PageActions
      primary={{
        id: 'check',
        label: checking ? t('checking') : t('check'),
        icon: checking ? LoaderCircle : RefreshCw,
        disabled: checking,
        onClick: () => check.mutate(),
      }}
    />
  );
}

export default function UpdateCenterView() {
  const t = useTranslations('updates');
  const text = useSourceText();
  const query = useUpdateCenter();
  const apply = useApplyUpdate();
  const [confirming, setConfirming] = useState<{ item: UpdateItem; scope: UpdateScope } | null>(
    null,
  );
  const center = query.data;

  if (!center) return <ListSkeleton rows={6} rowClassName="h-16" />;
  const { open, current } = splitItems(center.items);
  const failedSources = center.sources.filter((source) => source.error);
  const coverage = (item: UpdateItem, scope: UpdateScope) =>
    scope === 'item'
      ? [item]
      : open.filter(
          (entry) =>
            entry.source === item.source &&
            entry.group === item.group &&
            entry.applicable &&
            (scope === 'group' || entry.security),
        );

  async function confirmApply(item: UpdateItem, scope: UpdateScope) {
    await apply.mutateAsync({ itemId: item.id, scope });
    toast.success(t('action.started'));
  }

  return (
    <>
      <div className="space-y-2">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
          <span className="text-sm font-medium text-foreground">
            {center.counts.updates === 0
              ? t('allCurrent')
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
        {!center.helper.installed && <Notice>{t('helperMissing')}</Notice>}
        {center.helper.installed && center.helper.error && (
          <Notice>{t('helperError', { error: center.helper.error })}</Notice>
        )}
        {center.job.lastStatus === 'failed' && center.job.lastError && (
          <Notice>{t('jobFailed', { error: center.job.lastError })}</Notice>
        )}
        {failedSources.map((source) => (
          <Notice key={source.id}>
            {t('sourceFailed', { source: text(source.label), error: source.error ?? '' })}
          </Notice>
        ))}
      </div>

      {open.length > 0 && (
        <section className="min-w-0 space-y-2">
          <SectionLabel>{t('open')}</SectionLabel>
          {groupItems(open).map((group) =>
            group.items.length > 1 || group.items[0]!.group ? (
              <UpdateGroupCard
                key={group.key}
                items={group.items}
                running={runningAction(center, group.items[0]!)}
                agentId={center.digest.agentId}
                onApply={(item, scope) => setConfirming({ item, scope })}
              />
            ) : (
              <UpdateCard
                key={group.key}
                item={group.items[0]!}
                running={runningAction(center, group.items[0]!)}
                agentId={center.digest.agentId}
                onApply={(item, scope) => setConfirming({ item, scope })}
              />
            ),
          )}
        </section>
      )}

      {current.length > 0 && (
        <section className="min-w-0">
          <SectionLabel>{t('current')}</SectionLabel>
          <RowList className="bg-card">
            {current.map((item) => (
              <div
                key={item.id}
                className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-sm"
              >
                {item.error || !item.installed ? (
                  <CircleHelp
                    className={cn(
                      'size-4 shrink-0',
                      item.error ? 'text-status-waiting' : 'text-muted-foreground',
                    )}
                    aria-hidden="true"
                  />
                ) : (
                  <CircleCheck className="size-4 shrink-0 text-status-success" aria-hidden="true" />
                )}
                <span className="min-w-0 shrink truncate" dir="auto">
                  {item.name}
                </span>
                <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                  {versionStep(item)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" dir="auto">
                  {item.error ?? text(item.hint) ?? ''}
                </span>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                  {text(item.sourceLabel)}
                </span>
              </div>
            ))}
          </RowList>
        </section>
      )}

      <UpdateHistory actions={center.actions} />

      <UpdateSettingsSection center={center} />

      {confirming && (
        <ApplyUpdateDialog
          item={confirming.item}
          scope={confirming.scope}
          items={coverage(confirming.item, confirming.scope)}
          onConfirm={confirmApply}
          onClose={() => setConfirming(null)}
        />
      )}
    </>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <Alert className="bg-status-waiting/10 px-3 py-2 text-status-waiting">
      <Info />
      <AlertDescription className="text-xs text-current">{children}</AlertDescription>
    </Alert>
  );
}
