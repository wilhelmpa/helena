'use client';

import { useTranslations } from 'next-intl';
import type { InstanceTeam } from '@/lib/api/endpoints/god';
import { formatDate } from '@/utils/dates';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Badge } from '@/components/ui/badge';
import { useInstanceTeamQuery } from '../../services/god.service';
import { compactCount } from '../../utils/numbers';
import GodTeamMembers from './GodTeamMembers';
import GodTeamProjects from './GodTeamProjects';

import { Inline, Overlay, Stack, Text, Card } from '@/design-system';

// One number from the team, with a quiet label under it. The counts read as a grid so
// the size of a team is one glance rather than a list of sentences.
function Stat({ label, value }: { label: string; value: number }) {
  const t = useTranslations('god.teamPanel');
  return (
    <Card pad="tight" tooltip={t('statTitle', { label, value })}>
      <div className="text-xl font-semibold tabular-nums">{compactCount(value)}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </Card>
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

// One team in the one overlay on the right (the same surface the user and project directories
// use): what the team holds, the projects it owns and everyone in it, each list searched and
// paged on its own. Esc closes it.
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

  return (
    <Overlay
      label={team ? team.name : tCommon('loading')}
      tabs={[{ id: 'team', label: team ? team.name : tCommon('loading') }]}
      onClose={onClose}
      className="ds-god-overlay"
      width="wide"
    >
      <Stack gap={5}>
        {!team ? (
          <ListSkeleton rows={5} rowClassName="h-12" />
        ) : (
          <>
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
    </Overlay>
  );
}
