'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { EmptyState } from '@/components/common/page/EmptyState';
import { SectionLabel } from '@/components/common/page/RowList';
import { Button } from '@/components/ui/button';
import type { UpdateItem, UpdateScope } from '@/lib/api/endpoints/updateCenter';
import ApplyUpdateDialog from './ApplyUpdateDialog';
import UpdateCard from './UpdateCard';
import UpdateGroupCard from './UpdateGroupCard';
import UpdateHistory from './UpdateHistory';
import UpdateCheckStatus from './UpdateCheckStatus';
import UpdateCurrentList from './UpdateCurrentList';
import UpdateSettingsSection from './UpdateSettingsSection';
import { useApplyUpdate, useUpdateCenter } from '../services/updateCenter.service';
import { groupItems, runningAction, splitItems } from '../utils/updateFormat';
import { Sections, Stack } from '@/design-system';

// The update center's page content (owner, 2026-09-24: "alles updaten … regelmäßig nach
// Updates suchen … den Status auch im Dashboard anzeigen"): every component Helena runs on
// with its installed and newest version, what a new version changes and how risky it looks
// (a small model's summary), "Aktualisieren" where Helena can do it, the history, and the
// settings. Mounted as the Updates tab of Administrator → Server
// (features/server/updatesTab.tsx; /god/updates redirects there): the host puts
// <UpdateCheckAction /> into its one toolbar row (docs/volition/ui-standard.md) and
// <UpdateCenterView /> into its body.

export default function UpdateCenterView() {
  const t = useTranslations('updates');
  const tCommon = useTranslations('common');
  const query = useUpdateCenter();
  const apply = useApplyUpdate();
  const [confirming, setConfirming] = useState<{ item: UpdateItem; scope: UpdateScope } | null>(
    null,
  );
  const center = query.data;

  if (!center)
    return query.isError ? (
      <EmptyState title={t('loadFailed')} description={t('loadFailedHint')}>
        <Button
          size="sm"
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {tCommon('reload')}
        </Button>
      </EmptyState>
    ) : (
      <ListSkeleton rows={6} rowClassName="h-16" />
    );
  const { open, current, unknown } = splitItems(center.items);
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
    <Sections>
      <UpdateCheckStatus center={center} />

      {open.length > 0 && (
        <section className="min-w-0">
          <SectionLabel>{t('open')}</SectionLabel>
          <Stack gap={4}>
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
          </Stack>
        </section>
      )}

      <UpdateCurrentList current={current} />
      <UpdateCurrentList current={unknown} title="unverified" />

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
    </Sections>
  );
}
