'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { InstanceTeam } from '@/lib/api/endpoints/god';
import { formatDate } from '@/utils/dates';
import { useExitOnEscape } from '@/hooks/useExitOnEscape';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useInstanceTeamQuery } from '../../services/god.service';
import { compactCount } from '../../utils/numbers';
import GodTeamMembers from './GodTeamMembers';
import GodTeamProjects from './GodTeamProjects';

import { Box, Inline, Stack, Text } from '@/design-system';

// One number from the team, with a quiet label under it. The counts read as a grid so
// the size of a team is one glance rather than a list of sentences.
function Stat({ label, value }: { label: string; value: number }) {
  const t = useTranslations('god.teamPanel');
  return (
    <Box
      padX={3}
      padY={3}
      className="rounded-md border border-sidebar-border bg-card"
      title={t('statTitle', { label, value })}
    >
      <div className="text-xl font-semibold tabular-nums">{compactCount(value)}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </Box>
  );
}

// The counts of a team, in the order they matter: the work first, then what is
// configured around it.
const STATS = [
  { key: 'projects', count: (team: InstanceTeam) => team.projectCount },
  { key: 'issues', count: (team: InstanceTeam) => team.issueCount },
  { key: 'members', count: (team: InstanceTeam) => team.memberCount },
  { key: 'agents', count: (team: InstanceTeam) => team.agentCount },
  { key: 'skills', count: (team: InstanceTeam) => team.skillCount },
  { key: 'tools', count: (team: InstanceTeam) => team.toolCount },
  { key: 'roles', count: (team: InstanceTeam) => team.roleCount },
] as const;

// One team in a right-hand side panel (the same surface the user and project
// directories use): what the team holds, the projects it owns and everyone in it,
// each list searched and paged on its own. Escape or a backdrop click closes it.
export default function GodTeamDetailPanel({
  teamId,
  onClose,
}: {
  teamId: number;
  onClose: () => void;
}) {
  const t = useTranslations('god.teamPanel');
  const tCommon = useTranslations('common');
  const teamQuery = useInstanceTeamQuery(teamId);
  const team = teamQuery.data;

  useExitOnEscape(onClose);

  return (
    <div
      data-slot="sheet-overlay"
      className="fixed inset-0 z-40 flex bg-black/20"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        data-slot="sheet-content"
        className="ml-auto flex h-full w-full flex-col border-s border-sidebar-border bg-background sm:w-[680px] sm:max-w-[92vw]"
      >
        <Inline
          gap={3}
          align="start"
          justify="between"
          padX={4}
          padTop={4}
          padBottom={4}
          className="flex shrink-0 items-start justify-between border-b border-sidebar-border"
        >
          <Stack gap={2} className="min-w-0">
            <h2 className="truncate text-md font-semibold">
              {team ? team.name : tCommon('loading')}
            </h2>
            {team && (
              <Inline gap={2} wrap className="flex flex-wrap items-center">
                <Badge
                  variant={team.mcpEnabled ? 'secondary' : 'outline'}
                  className="px-1.5 py-0 text-xs font-medium"
                >
                  {t(team.mcpEnabled ? 'mcpEnabled' : 'mcpOff')}
                </Badge>
                <Text as="span" size="xs" tone="muted">
                  {t('created', { date: formatDate(team.createdAt) })}
                </Text>
              </Inline>
            )}
          </Stack>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onClose}
            title={tCommon('close')}
          >
            <X />
          </Button>
        </Inline>

        <Stack gap={5} padX={4} padY={4} className="flex-1 overflow-y-auto">
          {!team ? (
            <ListSkeleton rows={5} rowClassName="h-12" />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {STATS.map((s) => (
                  <Stat key={s.key} label={t(`stats.${s.key}`)} value={s.count(team)} />
                ))}
              </div>

              <GodTeamProjects teamId={teamId} />
              <GodTeamMembers teamId={teamId} />
            </>
          )}
        </Stack>
      </div>
    </div>
  );
}
