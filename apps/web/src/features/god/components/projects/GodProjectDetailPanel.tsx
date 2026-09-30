'use client';

import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { InstanceProjectDetail } from '@/lib/api/endpoints/god';
import { formatDate, formatDateTime } from '@/utils/dates';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Badge } from '@/components/ui/badge';
import MemberAccessCard from '@/components/common/permissions/MemberAccessCard';
import { usePermissionCatalogQuery } from '@/services/roles.service';
import { useInstanceProjectQuery } from '../../services/god.service';
import { compactCount } from '../../utils/numbers';

import { Inline, Overlay, Stack, Text, Card, EmptyState } from '@/design-system';

// One number from the project, with a quiet label under it. The counts read as a
// grid so the size of a project is one glance rather than a list of sentences.
function Stat({ label, value }: { label: string; value: number }) {
  const t = useTranslations('god.projectPanel');
  return (
    <Card pad="tight" tooltip={t('statTitle', { label, value })}>
      <div className="text-xl font-semibold tabular-nums">{compactCount(value)}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </Card>
  );
}

// The counts of a project, in the order they matter: the work first, then what is
// configured around it.
const STATS = [
  { key: 'issues', count: (p: InstanceProjectDetail) => p.issueCount },
  { key: 'archivedIssues', count: (p: InstanceProjectDetail) => p.archivedIssueCount },
  { key: 'initiatives', count: (p: InstanceProjectDetail) => p.initiativeCount },
  { key: 'members', count: (p: InstanceProjectDetail) => p.memberCount },
  { key: 'dashboards', count: (p: InstanceProjectDetail) => p.dashboardCount },
  { key: 'views', count: (p: InstanceProjectDetail) => p.viewCount },
  { key: 'agents', count: (p: InstanceProjectDetail) => p.agentCount },
  { key: 'skills', count: (p: InstanceProjectDetail) => p.skillCount },
  { key: 'tools', count: (p: InstanceProjectDetail) => p.toolCount },
] as const;

// One project in the one overlay on the right (the same surface the user directory uses): what
// the project holds, and every member with the permissions their membership resolves to. Esc
// closes it.
export default function GodProjectDetailPanel({
  projectId,
  onClose,
}: {
  projectId: number;
  onClose: () => void;
}) {
  const t = useTranslations('god.projectPanel');
  const tCommon = useTranslations('common');
  const projectQuery = useInstanceProjectQuery(projectId);
  const catalogQuery = usePermissionCatalogQuery();
  const project = projectQuery.data;

  return (
    <Overlay
      label={project ? project.name : tCommon('loading')}
      tabs={[
        {
          id: 'project',
          label: project ? `${project.key} · ${project.name}` : tCommon('loading'),
        },
      ]}
      onClose={onClose}
      className="ds-god-overlay"
      width="wide"
    >
      <Stack gap={5}>
        {project && (
          <Stack gap={2}>
            {project.description && (
              <Text as="p" size="xs" tone="muted" className="line-clamp-2">
                {project.description}
              </Text>
            )}
            <Inline gap={2} wrap className="flex flex-wrap items-center">
              <Badge
                variant={project.mcpEnabled ? 'secondary' : 'outline'}
                className="px-1.5 py-0 text-xs font-medium"
              >
                {t(project.mcpEnabled ? 'mcpEnabled' : 'mcpOff')}
              </Badge>
              <Text as="span" size="xs" tone="muted">
                {t('created', { date: formatDate(project.createdAt) })}
              </Text>
            </Inline>
          </Stack>
        )}
        {!project ? (
          <ListSkeleton rows={5} rowClassName="h-12" />
        ) : (
          <>
            <Stack as="section" gap={3}>
              <div className="text-xs text-muted-foreground">
                {t('lastActivity', {
                  value: project.lastActivityAt
                    ? formatDateTime(project.lastActivityAt)
                    : t('noActivity'),
                })}
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {STATS.map((s) => (
                  <Stat key={s.key} label={t(`stats.${s.key}`)} value={s.count(project)} />
                ))}
              </div>
            </Stack>

            <Stack as="section" gap={3}>
              <Inline gap={2} align="baseline" className="flex items-baseline">
                <h3 className="text-sm font-medium">{t('members')}</h3>
                {project.members.length > 0 && (
                  <Text as="span" size="xs" tone="muted">
                    {project.members.length}
                  </Text>
                )}
              </Inline>
              {project.members.length === 0 ? (
                <EmptyState boxed fill={false} icon={<Users />} title={t('noMembersTitle')}>
                  {t('noMembersHint')}
                </EmptyState>
              ) : (
                <Stack gap={2}>
                  {project.members.map((m) => (
                    <MemberAccessCard
                      key={m.userId}
                      member={m}
                      permissions={m.permissions}
                      catalog={catalogQuery.data}
                    />
                  ))}
                </Stack>
              )}
            </Stack>
          </>
        )}
      </Stack>
    </Overlay>
  );
}
