'use client';

import { useTranslations } from 'next-intl';
import type { Organization } from '@/lib/api/endpoints/organization';
import { useAgentWorkStates } from '@/hooks/useAgentWorkStates';
import { buildOrganizationTree } from '../organizationTree';
import OrganizationDepartmentNode from './OrganizationDepartmentNode';
import OrganizationSummary from './OrganizationSummary';
import { Card, EmptyState, Stack } from '@/design-system';

export default function OrganizationTree({ organization }: { organization: Organization }) {
  const t = useTranslations('organization');
  const tree = buildOrganizationTree(organization);
  const work = useAgentWorkStates();
  if (tree.length === 0) {
    return <EmptyState boxed>{t('map.empty')}</EmptyState>;
  }
  return (
    <Stack gap={3}>
      <OrganizationSummary agents={organization.agents} />
      <Card pad="tight" className="overflow-x-auto">
        <Stack as="ul" gap={2} className="min-w-0">
          {tree.map((node) => (
            <OrganizationDepartmentNode
              key={node.department?.id ?? node.kind}
              node={node}
              work={work}
            />
          ))}
        </Stack>
      </Card>
    </Stack>
  );
}
