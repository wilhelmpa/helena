'use client';

import { useTranslations } from 'next-intl';
import type { Organization } from '@/lib/api/endpoints/organization';
import { buildOrganizationTree } from '../organizationTree';
import OrganizationDepartmentNode from './OrganizationDepartmentNode';
import OrganizationSummary from './OrganizationSummary';

export default function OrganizationTree({ organization }: { organization: Organization }) {
  const t = useTranslations('organization');
  const tree = buildOrganizationTree(organization);
  if (tree.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('map.empty')}</p>;
  }
  return (
    <div className="space-y-4 pb-6">
      <OrganizationSummary agents={organization.agents} />
      <div className="overflow-x-auto">
        <ul className="min-w-[520px] space-y-5">
          {tree.map((node) => (
            <OrganizationDepartmentNode key={node.department?.id ?? node.kind} node={node} />
          ))}
        </ul>
      </div>
    </div>
  );
}
