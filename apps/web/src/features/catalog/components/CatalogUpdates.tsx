'use client';

import { useState } from 'react';
import { PackageCheck, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Button,
  EmptyState,
  Inline,
  List,
  ListRow,
  Notice,
  Pill,
  Stack,
  Text,
} from '@/design-system';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import type { CatalogItemRow } from '@/lib/api/endpoints/catalog';
import {
  useCatalogIndex,
  useCatalogSourcesQuery,
  useInspectCatalogItem,
} from '@/services/catalog.service';
import { hasNewVersion, isSkillKind, shortPin, sourceLabel } from '../utils/catalog';
import CatalogError from './CatalogError';

type Outcome = { state: 'busy' } | { state: 'checked' } | { state: 'error'; error: unknown };

// The installed entries and their pins. "Nach Updates suchen" reads the newest state of
// every source, inspects it and shows what is new; the pin only moves when the owner adopts
// the new version from its preview, after seeing the differences.
export default function CatalogUpdates({
  teamId,
  onOpen,
}: {
  teamId: number;
  onOpen: (itemId: number, tab: 'versions') => void;
}) {
  const t = useTranslations('catalog.updates');
  const index = useCatalogIndex(teamId);
  const inspect = useInspectCatalogItem(teamId);
  const sources = useCatalogSourcesQuery(teamId);
  const [outcomes, setOutcomes] = useState<Record<number, Outcome>>({});
  const [running, setRunning] = useState(false);

  if (index.isPending) return <ListSkeleton rows={3} rowClassName="h-12" />;
  const installed = (index.data ?? []).filter((item) => item.installed);
  if (installed.length === 0)
    return (
      <EmptyState icon={<PackageCheck />} title={t('empty.title')}>
        {t('empty.text')}
      </EmptyState>
    );
  // A disabled source is not read: what is installed from it stays as it is.
  const isOff = (item: CatalogItemRow) =>
    (sources.data ?? []).some((source) => source.locator === item.source && !source.enabled);
  const news = installed.filter(hasNewVersion);
  const rest = installed.filter((item) => !hasNewVersion(item));

  async function check(item: CatalogItemRow) {
    setOutcomes((current) => ({ ...current, [item.id]: { state: 'busy' } }));
    try {
      await inspect.mutateAsync(item.id);
      setOutcomes((current) => ({ ...current, [item.id]: { state: 'checked' } }));
    } catch (error) {
      setOutcomes((current) => ({ ...current, [item.id]: { state: 'error', error } }));
    }
  }
  async function checkAll() {
    setRunning(true);
    for (const item of installed.filter((entry) => !isOff(entry))) await check(item);
    setRunning(false);
  }
  const row = (item: CatalogItemRow) => {
    const outcome = outcomes[item.id];
    const fresh = hasNewVersion(item);
    const off = isOff(item);
    return (
      <div key={item.id}>
        <ListRow
          wrap
          stack
          icon={<PackageCheck />}
          title={item.name}
          subtitle={[
            sourceLabel(item.source),
            isSkillKind(item.kind) ? t('kindSkill') : t('kindMcp'),
            item.installedPin ? t('pinnedTo', { pin: shortPin(item.installedPin) }) : null,
            outcome?.state === 'checked' && !fresh ? t('upToDate') : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          meta={
            off ? (
              <Pill>{t('sourceOff')}</Pill>
            ) : fresh ? (
              <Pill tone="accent">{t('available', { pin: shortPin(item.latestPin ?? '') })}</Pill>
            ) : (
              <Pill>{t('current')}</Pill>
            )
          }
          onSelect={() => onOpen(item.id, 'versions')}
          control={
            <Inline gap={2}>
              {fresh && (
                <Button size="small" variant="primary" onClick={() => onOpen(item.id, 'versions')}>
                  {t('showChanges')}
                </Button>
              )}
              {!off && (
                <Button
                  size="small"
                  icon={<RefreshCw />}
                  disabled={outcome?.state === 'busy'}
                  onClick={() => void check(item)}
                >
                  {outcome?.state === 'busy' ? t('checking') : t('check')}
                </Button>
              )}
            </Inline>
          }
        />
        {outcome?.state === 'error' && <CatalogError error={outcome.error} compact />}
      </div>
    );
  };

  return (
    <Stack gap={5}>
      <Inline gap={3} wrap justify="between">
        <Text size="sm" tone="muted">
          {t('intro')}
        </Text>
        <Button icon={<RefreshCw />} disabled={running} onClick={() => void checkAll()}>
          {running ? t('checkingAll') : t('checkAll')}
        </Button>
      </Inline>
      {news.length > 0 && (
        <Notice icon={<RefreshCw />} title={t('news', { count: news.length })}>
          {t('newsText')}
        </Notice>
      )}
      <List label={t('title')}>
        {news.map(row)}
        {rest.map(row)}
      </List>
    </Stack>
  );
}
