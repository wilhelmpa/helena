'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTeamQuery } from '@/services/teams.service';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Page, PageActions, PageSearch, PageTabs, PageToolbarSpacer } from '@/design-system';
import type { CatalogProposal } from '@/lib/api/endpoints/catalog';
import { useCatalogIndex, useCatalogProposalsQuery } from '@/services/catalog.service';
import AddSourceDialog from '@/features/catalog/components/AddSourceDialog';
import CatalogBrowser from '@/features/catalog/components/CatalogBrowser';
import CatalogProposals from '@/features/catalog/components/CatalogProposals';
import CatalogSources from '@/features/catalog/components/CatalogSources';
import CatalogUpdates from '@/features/catalog/components/CatalogUpdates';
import PreviewOverlay, { type PreviewTab } from '@/features/catalog/components/PreviewOverlay';
import {
  CATALOG_TABS,
  catalogTabOf,
  type CatalogTab,
} from '@/features/catalog/components/CatalogTabs';
import { hasNewVersion } from '@/features/catalog/utils/catalog';
import { SkillCreateDialog } from './SkillCreateDialog';
import TeamAgentSkills from './TeamAgentSkills';

type Open = { itemId: number; tab: PreviewTab; proposal: CatalogProposal | null };

// The skill library of a team: the SKILL.md documents its projects' agents load on demand,
// shared by every one of them. The owner also sees the curated catalog next to it — search
// and preview, sources, what agents suggested, and updates of what is installed — as the
// tabs of this one page (the address keeps the tab in `?tab=`).
export default function TeamAgentSkillsSection({ teamId }: { teamId: number }) {
  const t = useTranslations('teams');
  const tc = useTranslations('catalog');
  const { data: team } = useTeamQuery(teamId);
  const permissions = team?.permissions.agent_skills;
  const owner = team?.role === 'owner';
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();
  const tab: CatalogTab = owner ? catalogTabOf(search.get('tab')) : 'library';
  const [creating, setCreating] = useState(false);
  const [addingSource, setAddingSource] = useState(false);
  const [query, setQuery] = useState('');
  const fromAddress = Number(search.get('entry')) || null;
  const [open, setOpen] = useState<Open | null>(
    fromAddress ? { itemId: fromAddress, tab: 'overview', proposal: null } : null,
  );
  const proposals = useCatalogProposalsQuery(owner ? teamId : null);
  const index = useCatalogIndex(owner ? teamId : null);
  const pending = (proposals.data ?? []).filter((proposal) => proposal.state === 'pending').length;
  const news = (index.data ?? []).filter(hasNewVersion).length;
  const hrefOf = (value: CatalogTab) =>
    value === 'library' ? pathname : `${pathname}?tab=${value}`;

  const primary =
    tab === 'library' && permissions?.create
      ? {
          id: 'new',
          label: t('skills.newSkill'),
          icon: Plus,
          onClick: () => setCreating(true),
        }
      : tab === 'sources'
        ? {
            id: 'add-source',
            label: tc('sources.add.open'),
            icon: Plus,
            onClick: () => setAddingSource(true),
          }
        : undefined;

  return (
    <Page
      title={t('sections.agentSkills.title')}
      toolbar={
        <>
          {owner && (
            <PageTabs<CatalogTab>
              label={tc('tabsLabel')}
              value={tab}
              items={CATALOG_TABS.map((value) => ({
                value,
                label: tc(`tabs.${value}`),
                href: hrefOf(value),
                ...(value === 'proposals' && pending > 0 ? { count: pending } : {}),
                ...(value === 'updates' && news > 0 ? { count: news } : {}),
              }))}
            />
          )}
          <PageToolbarSpacer />
          {tab === 'catalog' && (
            <PageSearch value={query} onChange={setQuery} placeholder={tc('browser.search')} />
          )}
          <PageActions primary={primary} />
        </>
      }
    >
      {!permissions || !team ? (
        <ListSkeleton rows={3} rowClassName="h-12" />
      ) : !permissions.read ? (
        <p className="text-sm text-muted-foreground">{t('skills.noAccess')}</p>
      ) : tab === 'library' ? (
        <TeamAgentSkills teamId={teamId} teamName={team.name} permissions={permissions} />
      ) : tab === 'catalog' ? (
        <CatalogBrowser
          teamId={teamId}
          query={query}
          openId={open?.itemId ?? null}
          onOpen={(itemId) => setOpen({ itemId, tab: 'overview', proposal: null })}
          onOpenSources={() => router.push(hrefOf('sources'))}
        />
      ) : tab === 'sources' ? (
        <CatalogSources teamId={teamId} onAdd={() => setAddingSource(true)} />
      ) : tab === 'proposals' ? (
        <CatalogProposals
          teamId={teamId}
          onOpen={(proposal) => setOpen({ itemId: proposal.itemId, tab: 'adopt', proposal })}
        />
      ) : (
        <CatalogUpdates
          teamId={teamId}
          onOpen={(itemId, previewTab) => setOpen({ itemId, tab: previewTab, proposal: null })}
        />
      )}

      {creating && team && (
        <SkillCreateDialog
          teamId={teamId}
          teamName={team.name}
          onClose={() => setCreating(false)}
        />
      )}
      {addingSource && team && (
        <AddSourceDialog
          teamId={teamId}
          teamName={team.name}
          onClose={() => setAddingSource(false)}
        />
      )}
      {open && (
        <PreviewOverlay
          key={`${open.itemId}-${open.proposal?.id ?? 0}`}
          teamId={teamId}
          itemId={open.itemId}
          initialTab={open.tab}
          proposal={open.proposal}
          onClose={() => setOpen(null)}
        />
      )}
    </Page>
  );
}
