'use client';

import { useTranslations } from 'next-intl';
import type { PermissionCatalog } from '@/lib/api/endpoints/roles';
import type { InstanceUserProject } from '@/lib/api/endpoints/god';
import { formatShortDate } from '@/utils/dates';
import { Badge } from '@/components/ui/badge';
import AccessCard from '@/components/common/permissions/AccessCard';

import { Box, Text } from '@/design-system';

// One project the user can reach, as a row in the account panel.
export default function GodUserProjectCard({
  project,
  catalog,
}: {
  project: InstanceUserProject;
  catalog: PermissionCatalog | undefined;
}) {
  const t = useTranslations('permissions');
  const tCommon = useTranslations('common');
  const isOwner = project.role === 'owner';

  return (
    <AccessCard
      permissions={project.permissions}
      catalog={catalog}
      header={
        <>
          <Box
            as="span"
            padX={2}
            padY={1}
            className="rounded-sm bg-secondary text-xs font-medium text-secondary-foreground"
          >
            {project.projectKey}
          </Box>
          <Text as="span" size="sm" className="min-w-0 flex-1 truncate">
            {project.projectName}
          </Text>
          <Badge
            variant={isOwner ? 'default' : 'secondary'}
            className="px-1.5 py-0 text-xs font-medium"
          >
            {isOwner ? tCommon('owner') : (project.roleName ?? tCommon('member'))}
          </Badge>
          <Text as="span" size="xs" tone="muted">
            {t('joined', { date: formatShortDate(project.joinedAt) })}
          </Text>
        </>
      }
    />
  );
}
