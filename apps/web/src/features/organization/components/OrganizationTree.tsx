'use client';

import { useTranslations } from 'next-intl';
import type { Organization } from '@/lib/api/endpoints/organization';
import { useAgentWorkStates } from '@/hooks/useAgentWorkStates';
import { buildOrganizationTree } from '../organizationTree';
import OrganizationDepartmentNode from './OrganizationDepartmentNode';
import OrganizationSummary from './OrganizationSummary';
import { Stack, Text } from '@/design-system';

export default function OrganizationTree({ organization }: { organization: Organization }) {
  const t = useTranslations('organization');
  const tree = buildOrganizationTree(organization);
  const work = useAgentWorkStates();
  if (tree.length === 0) {
    return (
      <Text as="p" size="sm" tone="muted" className="rounded-md border bg-card px-3 py-2">
        {t('map.empty')}
      </Text>
    );
  }
  return (
    <Stack gap={3} padBottom={5}>
      <OrganizationSummary agents={organization.agents} />
      <div className="overflow-x-auto">
        <Stack as="ul" gap={2} className="min-w-0">
          {tree.map((node) => (
            <OrganizationDepartmentNode
              key={node.department?.id ?? node.kind}
              node={node}
              work={work}
            />
          ))}
        </Stack>
      </div>
    </Stack>
  );
}
