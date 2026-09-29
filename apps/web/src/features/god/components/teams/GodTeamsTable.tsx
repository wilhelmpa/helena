'use client';

import { Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { InstanceTeam } from '@/lib/api/endpoints/god';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { compactCount } from '../../utils/numbers';
import TableCard from '@/components/common/page/TableCard';

import { Text, Table, Td, Th, Tr } from '@/design-system';

// The team list. A row (or the pencil in its Actions cell) opens the team in the side
// panel, where the full counts, the projects and the member list are.
export default function GodTeamsTable({
  teams,
  onSelect,
}: {
  teams: InstanceTeam[];
  onSelect: (teamId: number) => void;
}) {
  const t = useTranslations('god.teams');
  const tCommon = useTranslations('common');

  return (
    <TableCard>
      <Table stack={false} className="table-fixed xl:min-w-[860px]">
        <colgroup>
          <col className="w-[34%]" />
          <col className="w-[11%]" />
          <col className="w-[11%] max-md:hidden" />
          <col className="w-[11%] max-md:hidden" />
          <col className="w-[11%] max-md:hidden" />
          <col className="w-[14%] max-xl:hidden" />
          <col className="w-[8%]" />
        </colgroup>
        <thead>
          <Tr className="hover:bg-transparent">
            <Th>{t('columns.team')}</Th>
            <Th>{t('columns.projects')}</Th>
            <Th className="max-md:hidden">{t('columns.members')}</Th>
            <Th className="max-md:hidden">{t('columns.issues')}</Th>
            <Th className="max-md:hidden">{t('columns.agents')}</Th>
            <Th className="max-xl:hidden">{t('columns.mcp')}</Th>
            <Th alignment="end">{tCommon('actions')}</Th>
          </Tr>
        </thead>
        <tbody>
          {teams.map((team) => (
            <Tr
              key={team.id}
              className="cursor-pointer"
              onClick={() => onSelect(team.id)}
              title={t('showDetails')}
            >
              <Td className="py-3">
                <Text as="span" size="sm" className="truncate font-medium">
                  {team.name}
                </Text>
              </Td>

              <Td className="py-3 tabular-nums" title={String(team.projectCount)}>
                {compactCount(team.projectCount)}
              </Td>

              <Td className="py-3 tabular-nums max-md:hidden" title={String(team.memberCount)}>
                {compactCount(team.memberCount)}
              </Td>

              <Td className="py-3 tabular-nums max-md:hidden" title={String(team.issueCount)}>
                {compactCount(team.issueCount)}
              </Td>

              <Td className="py-3 tabular-nums max-md:hidden" title={String(team.agentCount)}>
                {compactCount(team.agentCount)}
              </Td>

              <Td className="py-3 max-xl:hidden">
                <Badge
                  variant={team.mcpEnabled ? 'secondary' : 'outline'}
                  className="px-1.5 py-0 text-xs font-medium"
                >
                  {t(team.mcpEnabled ? 'mcpEnabled' : 'mcpOff')}
                </Badge>
              </Td>

              <Td alignment="end" className="py-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground"
                  aria-label={t('open')}
                  title={t('open')}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(team.id);
                  }}
                >
                  <Pencil />
                </Button>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableCard>
  );
}
