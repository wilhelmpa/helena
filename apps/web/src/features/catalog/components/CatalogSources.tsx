'use client';

import { useState } from 'react';
import { GitBranch, Package, Power, RefreshCw } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button, EmptyState, Inline, List, ListRow, Pill, Stack, Text } from '@/design-system';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import type { CatalogSource } from '@/lib/api/endpoints/catalog';
import {
  useAddCatalogSource,
  useCatalogIndex,
  useCatalogSourcesQuery,
  useRefreshCatalogSource,
  useRemoveCatalogSource,
} from '@/services/catalog.service';
import { sourceLabel } from '../utils/catalog';
import CatalogError from './CatalogError';

type Outcome =
  { state: 'busy' } | { state: 'ok'; count: number } | { state: 'error'; error: unknown };

// The curated sources: every one is a GitHub repository or a package the owner named.
// Refreshing reads its entries; removing only switches it off, so installed pins and their
// way back stay.
export default function CatalogSources({ teamId, onAdd }: { teamId: number; onAdd: () => void }) {
  const t = useTranslations('catalog.sources');
  const format = useFormatter();
  const sources = useCatalogSourcesQuery(teamId);
  const index = useCatalogIndex(teamId);
  const refresh = useRefreshCatalogSource(teamId);
  const remove = useRemoveCatalogSource(teamId);
  const add = useAddCatalogSource(teamId);
  const [outcomes, setOutcomes] = useState<Record<number, Outcome>>({});
  const [removing, setRemoving] = useState<CatalogSource | null>(null);
  const set = (id: number, outcome: Outcome | null) =>
    setOutcomes((current) => {
      const next = { ...current };
      if (outcome) next[id] = outcome;
      else delete next[id];
      return next;
    });

  async function run(source: CatalogSource) {
    set(source.id, { state: 'busy' });
    try {
      const result = await refresh.mutateAsync(source.id);
      set(source.id, { state: 'ok', count: result.count });
    } catch (error) {
      set(source.id, { state: 'error', error });
    }
  }
  async function enable(source: CatalogSource) {
    set(source.id, { state: 'busy' });
    try {
      await add.mutateAsync({ kind: source.kind, locator: source.locator, role: source.role });
      set(source.id, null);
    } catch (error) {
      set(source.id, { state: 'error', error });
    }
  }

  if (sources.isPending) return <ListSkeleton rows={3} rowClassName="h-12" />;
  const rows = sources.data ?? [];
  if (rows.length === 0)
    return (
      <EmptyState
        icon={<Package />}
        title={t('empty.title')}
        action={<Button onClick={onAdd}>{t('add.open')}</Button>}
      >
        {t('empty.text')}
      </EmptyState>
    );
  const countOf = (source: CatalogSource) =>
    (index.data ?? []).filter((item) => item.source === source.locator).length;

  return (
    <Stack gap={4}>
      <Text size="sm" tone="muted">
        {t('intro')}
      </Text>
      <List label={t('title')}>
        {rows.map((source) => {
          const outcome = outcomes[source.id];
          const count = countOf(source);
          const busy = outcome?.state === 'busy';
          return (
            <div key={source.id}>
              <ListRow
                wrap
                icon={source.kind.startsWith('github') ? <GitBranch /> : <Package />}
                title={sourceLabel(source.locator)}
                subtitle={[
                  t(`kinds.${source.kind}`),
                  source.role,
                  outcome?.state === 'ok'
                    ? t('justRefreshed', { count: outcome.count })
                    : count > 0
                      ? t('entries', { count })
                      : t('noEntries'),
                  t('addedOn', {
                    date: format.dateTime(new Date(source.createdAt), { dateStyle: 'medium' }),
                  }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
                meta={
                  <Pill tone={source.enabled ? 'success' : 'neutral'}>
                    {source.enabled ? t('on') : t('off')}
                  </Pill>
                }
                control={
                  <Inline gap={2}>
                    {source.enabled ? (
                      <>
                        <Button
                          size="small"
                          icon={<RefreshCw />}
                          disabled={busy}
                          onClick={() => void run(source)}
                        >
                          {busy ? t('refreshing') : t('refresh')}
                        </Button>
                        <Button
                          size="small"
                          icon={<Power />}
                          disabled={busy}
                          onClick={() => setRemoving(source)}
                        >
                          {t('disable')}
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="small"
                        icon={<Power />}
                        disabled={busy}
                        onClick={() => void enable(source)}
                      >
                        {t('enable')}
                      </Button>
                    )}
                  </Inline>
                }
              />
              {outcome?.state === 'error' && <CatalogError error={outcome.error} compact />}
            </div>
          );
        })}
      </List>
      {removing && (
        <ConfirmDialog
          title={t('disableTitle')}
          confirmLabel={t('disable')}
          onConfirm={async () => {
            try {
              await remove.mutateAsync(removing.id);
            } catch (error) {
              set(removing.id, { state: 'error', error });
            }
            setRemoving(null);
          }}
          onClose={() => setRemoving(null)}
        >
          <Text size="sm" tone="muted">
            {t('disableText', { name: sourceLabel(removing.locator) })}
          </Text>
        </ConfirmDialog>
      )}
    </Stack>
  );
}
