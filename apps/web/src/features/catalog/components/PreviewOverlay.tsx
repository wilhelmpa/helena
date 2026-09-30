'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Inline, Notice, Overlay, Pill, Stack, Text } from '@/design-system';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import type { CatalogProposal } from '@/lib/api/endpoints/catalog';
import { useCatalogPreviewQuery, useInspectCatalogItem } from '@/services/catalog.service';
import { isSkillKind, verdictOf } from '../utils/catalog';
import CatalogError from './CatalogError';
import PreviewAdopt from './PreviewAdopt';
import PreviewFiles from './PreviewFiles';
import PreviewOverview from './PreviewOverview';
import PreviewVersions from './PreviewVersions';

export type PreviewTab = 'overview' | 'files' | 'versions' | 'adopt';

// One catalog entry in the one overlay on the right (docs/design-system.md §9): its
// overview, its files, what the inspection found, its versions with their differences
// and the adoption. Opened from the catalog, from an agent's proposal or from the updates.
export default function PreviewOverlay({
  teamId,
  itemId,
  initialTab = 'overview',
  proposal = null,
  onClose,
}: {
  teamId: number;
  itemId: number;
  initialTab?: PreviewTab;
  proposal?: CatalogProposal | null;
  onClose: () => void;
}) {
  const t = useTranslations('catalog.preview');
  const [tab, setTab] = useState<PreviewTab>(initialTab);
  const [error, setError] = useState<unknown>(null);
  const query = useCatalogPreviewQuery(teamId, itemId);
  const inspect = useInspectCatalogItem(teamId);
  const preview = query.data;
  const runInspect = () => {
    setError(null);
    inspect.mutate(itemId, { onError: setError });
  };
  const title = preview?.item.name ?? t('title');
  const latest = preview?.latest ?? null;
  const newVersion =
    preview != null &&
    preview.install != null &&
    preview.item.latestRevisionId != null &&
    preview.install.revisionId !== preview.item.latestRevisionId;

  return (
    <Overlay
      label={title}
      tabs={[
        { id: 'overview', label: t('tabs.overview') },
        { id: 'files', label: t('tabs.files') },
        { id: 'versions', label: t('tabs.versions') },
        { id: 'adopt', label: t('tabs.adopt') },
      ]}
      activeTab={tab}
      onTab={(id) => setTab(id as PreviewTab)}
      onClose={onClose}
      closeOnOutsideClick={false}
      className="ds-catalog-overlay"
    >
      {query.isPending ? (
        <ListSkeleton rows={5} rowClassName="h-8" />
      ) : query.isError || !preview ? (
        <Notice tone="danger" title={t('loadFailed.title')}>
          {t('loadFailed.text')}
        </Notice>
      ) : (
        <Stack gap={5}>
          <Stack gap={2}>
            <Inline gap={2} wrap>
              <Text size="lg" weight="semibold">
                {preview.item.name}
              </Text>
              <Pill tone="neutral">
                {isSkillKind(preview.source.kind) ? t('kindSkill') : t('kindMcp')}
              </Pill>
              {preview.install && <Pill tone="success">{t('installedYes')}</Pill>}
              {newVersion && <Pill tone="accent">{t('newVersion')}</Pill>}
              {latest && verdictOf(latest.findings) === 'blocked' && (
                <Pill tone="danger">{t('blockedTag')}</Pill>
              )}
              {latest && verdictOf(latest.findings) === 'review' && (
                <Pill tone="warning">{t('reviewTag')}</Pill>
              )}
            </Inline>
          </Stack>
          <CatalogError error={error} />
          {tab === 'overview' && (
            <PreviewOverview
              teamId={teamId}
              preview={preview}
              busy={inspect.isPending}
              onInspect={runInspect}
            />
          )}
          {tab === 'files' && <PreviewFiles revision={latest} />}
          {tab === 'versions' && (
            <PreviewVersions
              teamId={teamId}
              preview={preview}
              busy={inspect.isPending}
              onInspect={runInspect}
              onUpdate={() => setTab('adopt')}
            />
          )}
          {tab === 'adopt' && (
            <PreviewAdopt
              teamId={teamId}
              preview={preview}
              proposal={proposal}
              busy={inspect.isPending}
              onInspect={runInspect}
              onClose={onClose}
            />
          )}
        </Stack>
      )}
    </Overlay>
  );
}
