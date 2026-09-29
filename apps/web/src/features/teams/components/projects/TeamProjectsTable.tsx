'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { TeamProject } from '@/lib/api/endpoints/teams';
import { formatDate } from '@/utils/dates';
import { projectPath } from '@/utils/paths';
import Avatar from '@/components/common/Avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import TableCard from '@/components/common/page/TableCard';
import { Table, Td, Th, Tr } from '@/design-system';

// The projects of the team. A row opens the project in the side panel; the arrow in
// its Actions cell opens the project itself, for the ones the reader is a member of.
export default function TeamProjectsTable({
  projects,
  onSelect,
}: {
  projects: TeamProject[];
  onSelect: (projectId: number) => void;
}) {
  const t = useTranslations('teams');
  const tCommon = useTranslations('common');

  return (
    <div className="overflow-x-auto">
      <TableCard>
        <Table stack={false} className="table-fixed xl:min-w-[720px]">
          <colgroup>
            <col className="w-[44%]" />
            <col className="w-[16%] max-md:hidden" />
            <col className="w-[12%]" />
            <col className="w-[18%] max-md:hidden" />
            <col className="w-[10%]" />
          </colgroup>
          <thead>
            <Tr className="hover:bg-transparent">
              <Th>{t('columns.project')}</Th>
              <Th className="max-md:hidden">{t('columns.owners')}</Th>
              <Th>{t('columns.members')}</Th>
              <Th className="max-md:hidden">{t('columns.created')}</Th>
              <Th alignment="end">{tCommon('actions')}</Th>
            </Tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <Tr key={project.id} className="cursor-pointer" onClick={() => onSelect(project.id)}>
                <Td className="py-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Badge
                      variant="outline"
                      className="w-12 shrink-0 justify-center rounded-sm px-1 py-0 font-mono text-xs text-muted-foreground"
                    >
                      {project.key}
                    </Badge>
                    <span className="truncate text-sm font-medium">{project.name}</span>
                  </div>
                </Td>

                <Td className="py-3 max-md:hidden">
                  {project.owners.length > 0 && (
                    <span
                      className="flex items-center -space-x-1.5"
                      title={t('panel.owners', {
                        names: project.owners.map((owner) => owner.name).join(', '),
                      })}
                    >
                      {project.owners.map((owner) => (
                        <Avatar
                          key={owner.userId}
                          name={owner.name}
                          image={owner.image}
                          className="ring-2 ring-background"
                        />
                      ))}
                    </span>
                  )}
                </Td>

                <Td className="py-3 tabular-nums">{project.memberCount}</Td>

                <Td className="py-3 max-md:hidden">{formatDate(project.createdAt)}</Td>

                <Td alignment="end">
                  {project.isMember && (
                    <Button
                      asChild
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-foreground"
                      aria-label={t('panel.openProject')}
                      title={t('panel.openProject')}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Link href={projectPath(project.key)}>
                        <ArrowUpRight className="size-4" />
                      </Link>
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableCard>
    </div>
  );
}
