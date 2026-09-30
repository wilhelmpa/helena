'use client';

import { useEffect } from 'react';
import { BookOpen, Plug, Search, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, EmptyState, List, ListRow, Pill } from '@/design-system';
import ListPager from '@/components/common/ListPager';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { usePaging } from '@/hooks/usePaging';
import type { CatalogItemRow } from '@/lib/api/endpoints/catalog';
import { useCatalogItemsPage, useCatalogSourcesQuery } from '@/services/catalog.service';
import { hasNewVersion, isSkillKind, shortPin, sourceLabel } from '../utils/catalog';

// One row of the catalog: name, origin and what it is for, with what matters at a glance —
// skill or MCP server, licence, whether it is inspected, blocked or installed.
export function CatalogRow({
  item,
  onOpen,
  selected,
}: {
  item: CatalogItemRow;
  onOpen: (itemId: number) => void;
  selected?: boolean;
}) {
  const t = useTranslations('catalog.browser');
  const skill = isSkillKind(item.kind);
  const newVersion = hasNewVersion(item);
  return (
    <ListRow
      icon={skill ? <Sparkles /> : <Plug />}
      title={item.name}
      subtitle={[sourceLabel(item.source), item.description].filter(Boolean).join(' · ')}
      selected={selected}
      onSelect={() => onOpen(item.id)}
      meta={
        <>
          <Pill>{skill ? t('kindSkill') : t('kindMcp')}</Pill>
          {item.findings == null ? (
            <Pill>{t('notInspected')}</Pill>
          ) : (
            <Pill>{item.license ?? t('licenseUnknown')}</Pill>
          )}
          {item.installed && (
            <Pill tone="success">
              {item.installedPin
                ? t('installedAt', { pin: shortPin(item.installedPin) })
                : t('installed')}
            </Pill>
          )}
          {newVersion && <Pill tone="accent">{t('newVersion')}</Pill>}
        </>
      }
    />
  );
}

// The catalog's entries, searched by name, description and purpose; a click opens the
// preview in the overlay.
export default function CatalogBrowser({
  teamId,
  query,
  onOpen,
  onOpenSources,
  openId,
}: {
  teamId: number;
  query: string;
  onOpen: (itemId: number) => void;
  onOpenSources: () => void;
  openId: number | null;
}) {
  const t = useTranslations('catalog.browser');
  const paging = usePaging(25);
  const items = useCatalogItemsPage(teamId, paging.params, query);
  const sources = useCatalogSourcesQuery(teamId);
  useEffect(() => paging.reset(), [query]); // eslint-disable-line react-hooks/exhaustive-deps

  if (items.isPending) return <ListSkeleton rows={6} rowClassName="h-12" />;
  const rows = items.data?.items ?? [];
  const total = items.data?.total ?? 0;
  if (total === 0) {
    if (query.trim())
      return (
        <EmptyState icon={<Search />} title={t('noMatch.title')}>
          {t('noMatch.text', { query: query.trim() })}
        </EmptyState>
      );
    const active = (sources.data ?? []).filter((source) => source.enabled);
    return (
      <EmptyState
        icon={<BookOpen />}
        title={active.length === 0 ? t('noSources.title') : t('noItems.title')}
        action={<Button onClick={onOpenSources}>{t('toSources')}</Button>}
      >
        {active.length === 0 ? t('noSources.text') : t('noItems.text')}
      </EmptyState>
    );
  }
  return (
    <>
      <List label={t('title')}>
        {rows.map((item) => (
          <CatalogRow key={item.id} item={item} onOpen={onOpen} selected={item.id === openId} />
        ))}
      </List>
      <ListPager paging={paging} total={total} />
    </>
  );
}
