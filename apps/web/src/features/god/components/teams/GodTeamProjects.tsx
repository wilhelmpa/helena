'use client';

import { useTranslations } from 'next-intl';
import { useSearchTerm } from '@/hooks/useSearchTerm';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { EmptyState } from '@/components/common/page/EmptyState';
import SearchInput from '@/components/common/SearchInput';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useInstanceTeamProjectsQuery } from '../../services/god.service';
import { compactCount } from '../../utils/numbers';

import { Box, Inline, Text, Stack } from '@/design-system';

// The projects a team owns, a page at a time. The search runs on the server, so it
// reaches the projects the loaded pages do not hold.
export default function GodTeamProjects({ teamId }: { teamId: number }) {
  const t = useTranslations('god.teamPanel');
  const tCommon = useTranslations('common');
  const { search, setSearch, term } = useSearchTerm();

  const projectsQuery = useInstanceTeamProjectsQuery(teamId, term);
  const projects = projectsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const total = projectsQuery.data?.pages[0]?.total ?? 0;

  return (
    <Stack as="section" gap={3}>
      <Inline gap={2} className="flex items-center">
        <h3 className="text-sm font-medium">{t('projects')}</h3>
        {total > 0 && (
          <Text as="span" size="xs" tone="muted">
            {total}
          </Text>
        )}
      </Inline>

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder={t('searchProjects')}
        className="w-full"
      />

      {projectsQuery.isPending ? (
        <ListSkeleton rows={4} rowClassName="h-12" />
      ) : projects.length === 0 ? (
        <EmptyState
          title={t('noProjectsTitle')}
          description={term ? t('noProjectMatches') : t('noProjectsHint')}
        />
      ) : (
        <>
          <Stack gap={2}>
            {projects.map((p) => (
              <Inline
                gap={2}
                wrap
                padX={3}
                padY={3}
                key={p.id}
                className="flex flex-wrap items-center rounded-md border border-sidebar-border bg-card"
              >
                <Box
                  as="span"
                  padX={2}
                  padY={1}
                  className="shrink-0 rounded-sm bg-secondary text-xs font-medium text-secondary-foreground"
                >
                  {p.key}
                </Box>
                <Text as="span" size="sm" className="min-w-0 flex-1 truncate">
                  {p.name}
                </Text>
                <Badge
                  variant={p.mcpEnabled ? 'secondary' : 'outline'}
                  className="px-1.5 py-0 text-xs font-medium"
                >
                  {t(p.mcpEnabled ? 'mcpEnabled' : 'mcpOff')}
                </Badge>
                <Text as="span" size="xs" tone="muted" className="tabular-nums">
                  {t('projectCounts', {
                    issues: compactCount(p.issueCount),
                    members: compactCount(p.memberCount),
                  })}
                </Text>
              </Inline>
            ))}
          </Stack>
          {projectsQuery.hasNextPage && (
            <Button
              variant="outline"
              className="w-full"
              disabled={projectsQuery.isFetchingNextPage}
              onClick={() => void projectsQuery.fetchNextPage()}
            >
              {tCommon('showMore')}
            </Button>
          )}
        </>
      )}
    </Stack>
  );
}
