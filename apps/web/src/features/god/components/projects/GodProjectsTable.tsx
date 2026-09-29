'use client';

import { Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { InstanceProject } from '@/lib/api/endpoints/god';
import { formatShortDate } from '@/utils/dates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { compactCount } from '../../utils/numbers';
import TableCard from '@/components/common/page/TableCard';

import { Box, Stack, Inline, Text, Table, Td, Th, Tr } from '@/design-system';

// The project list. A row (or the pencil in its Actions cell) opens the project in
// the side panel, where the full counts and the member list are. The columns here
// are the ones that say how much is going on: work, people, activity.
export default function GodProjectsTable({
  projects,
  onSelect,
}: {
  projects: InstanceProject[];
  onSelect: (projectId: number) => void;
}) {
  const t = useTranslations('god.projects');
  const tCommon = useTranslations('common');

  return (
    <TableCard>
      <Table stack={false} className="table-fixed xl:min-w-[860px]">
        <colgroup>
          <col className="w-[36%]" />
          <col className="w-[10%]" />
          <col className="w-[12%] max-md:hidden" />
          <col className="w-[10%] max-md:hidden" />
          <col className="w-[13%] max-xl:hidden" />
          <col className="w-[11%] max-md:hidden" />
          <col className="w-[8%]" />
        </colgroup>
        <thead>
          <Tr className="hover:bg-transparent">
            <Th>{t('columns.project')}</Th>
            <Th>{t('columns.members')}</Th>
            <Th className="max-md:hidden">{t('columns.issues')}</Th>
            <Th className="max-md:hidden">{t('columns.agents')}</Th>
            <Th className="max-xl:hidden">{t('columns.lastActivity')}</Th>
            <Th className="max-md:hidden">{t('columns.mcp')}</Th>
            <Th alignment="end">{tCommon('actions')}</Th>
          </Tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <Tr
              key={p.id}
              className="cursor-pointer"
              onClick={() => onSelect(p.id)}
              title={t('showDetails')}
            >
              <Td className="py-3 align-top whitespace-normal">
                <Stack gap={1} className="flex min-w-0 flex-col">
                  <Inline gap={2} className="flex min-w-0 items-center">
                    <Box
                      as="span"
                      padX={2}
                      padY={1}
                      className="shrink-0 rounded-sm bg-secondary text-xs font-medium text-secondary-foreground"
                    >
                      {p.key}
                    </Box>
                    <Text as="span" size="sm" className="truncate font-medium">
                      {p.name}
                    </Text>
                  </Inline>
                  <Text as="span" size="xs" tone="muted">
                    {t('created', { date: formatShortDate(p.createdAt) })}
                  </Text>
                </Stack>
              </Td>

              <Td className="py-3 align-top tabular-nums" title={String(p.memberCount)}>
                {compactCount(p.memberCount)}
              </Td>

              <Td className="py-3 align-top tabular-nums max-md:hidden">
                <Stack gap={1} className="flex flex-col">
                  <span title={String(p.issueCount)}>{compactCount(p.issueCount)}</span>
                  {/* Its own line, so a project with five-digit counts does not push the
                      column into a wrap. */}
                  {p.archivedIssueCount > 0 && (
                    <Text
                      as="span"
                      size="xs"
                      tone="muted"

                      title={t('archived', { count: p.archivedIssueCount })}
                    >
                      {t('archived', { count: compactCount(p.archivedIssueCount) })}
                    </Text>
                  )}
                </Stack>
              </Td>

              <Td
                className="py-3 align-top tabular-nums max-md:hidden"
                title={String(p.agentCount)}
              >
                {compactCount(p.agentCount)}
              </Td>

              <Td className="py-3 align-top max-xl:hidden">
                {p.lastActivityAt ? formatShortDate(p.lastActivityAt) : t('neverActive')}
              </Td>

              <Td className="py-3 align-top max-md:hidden">
                {p.mcpEnabled ? (
                  <Badge variant="secondary" className="px-1.5 py-0 text-xs font-medium">
                    {t('mcpEnabled')}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="px-1.5 py-0 text-xs font-medium">
                    {t('mcpOff')}
                  </Badge>
                )}
              </Td>

              <Td alignment="end" className="py-3 align-top">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground"
                  aria-label={t('open')}
                  title={t('open')}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(p.id);
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
