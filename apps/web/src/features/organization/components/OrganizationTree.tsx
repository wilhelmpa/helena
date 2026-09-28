'use client';

import { useTranslations } from 'next-intl';
import type { Organization } from '@/lib/api/endpoints/organization';
import { useAgentWorkStates } from '@/hooks/useAgentWorkStates';
import { buildOrganizationTree } from '../organizationTree';
import OrganizationDepartmentNode from './OrganizationDepartmentNode';
import OrganizationSummary from './OrganizationSummary';

export default function OrganizationTree({ organization }: { organization: Organization }) {
  const t = useTranslations('organization');
  const tree = buildOrganizationTree(organization);
  const work = useAgentWorkStates();
  if (tree.length === 0) {
    return (
      <p className="rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">
        {t('map.empty')}
      </p>
    );
  }
  return (
    <div className="space-y-3 pb-6">
      <OrganizationSummary agents={organization.agents} />
      <div className="overflow-x-auto">
        <ul className="min-w-0 space-y-2">
          {tree.map((node) => (
            <OrganizationDepartmentNode
              key={node.department?.id ?? node.kind}
              node={node}
              work={work}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}
