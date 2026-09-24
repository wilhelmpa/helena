'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CircleCheckBig, FolderKanban, Hourglass } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ApprovalListStatus } from '@/lib/api/endpoints/approvals';
import {
  PageSelect,
  PageTabs,
  PageToolbar,
  PageToolbarSpacer,
} from '@/components/layout/PageToolbar';
import { useApprovalProjects, usePendingApprovalCount } from '@/services/approvals.service';
import ApprovalRequestList from './ApprovalRequestList';
import RuntimeProposalList from './RuntimeProposalList';
import WorkflowApprovalList from './WorkflowApprovalList';
import { useProposalCount } from '@/features/agent-runtime/services/agentRuntime.service';

// What a project filter holds for "every project".
const ALL = 'all';

// The approvals, open or decided, in the header row's tabs: the requests agents made
// before acting outside Helena, and (open only) the workflow runs waiting at an approval.
// The tab and the project filter live in the address (?status=decided&project=VOL), so a
// link can open either. `fixedProjectKey` is the project's own page: no project filter.
export default function ApprovalsView({ fixedProjectKey }: { fixedProjectKey?: string }) {
  const t = useTranslations('approvals');
  const tNav = useTranslations('nav');
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const status: ApprovalListStatus = params.get('status') === 'decided' ? 'decided' : 'pending';
  const projects = useApprovalProjects().data ?? [];
  const filterKey = params.get('project') ?? undefined;
  const projectKey =
    fixedProjectKey ??
    (projects.some((project) => project.key === filterKey) ? filterKey : undefined);
  // Runtime proposals (memory writes, Hermes updates) belong to no project: they count and
  // show only while no project is chosen.
  const proposalCount = useProposalCount().data?.count ?? 0;
  const pending =
    (usePendingApprovalCount(projectKey).data?.count ?? 0) + (projectKey ? 0 : proposalCount);

  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params.toString());
    if (value === undefined) next.delete(key);
    else next.set(key, value);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <>
      <PageToolbar>
        <PageTabs
          label={tNav('approvals')}
          value={status}
          onChange={(next) => setParam('status', next === 'decided' ? 'decided' : undefined)}
          items={[
            { value: 'pending', label: t('pending'), icon: Hourglass, count: pending || undefined },
            { value: 'decided', label: t('decided'), icon: CircleCheckBig },
          ]}
        />
        <PageToolbarSpacer />
        {!fixedProjectKey && projects.length > 1 ? (
          <PageSelect
            label={t('filterProject')}
            icon={FolderKanban}
            value={projectKey ?? ALL}
            defaultValue={ALL}
            onChange={(value) => setParam('project', value === ALL ? undefined : value)}
            options={[
              { value: ALL, label: t('filterProjectAll') },
              ...projects.map((project) => ({ value: project.key, label: project.name })),
            ]}
          />
        ) : null}
      </PageToolbar>
      {status === 'pending' ? (
        <div className="flex flex-1 flex-col gap-6">
          <ApprovalRequestList
            key={`pending:${projectKey ?? ''}`}
            status="pending"
            projectKey={projectKey}
          />
          <WorkflowApprovalList projectKey={projectKey} />
          {!projectKey && <RuntimeProposalList status="pending" />}
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-6">
          <ApprovalRequestList
            key={`decided:${projectKey ?? ''}`}
            status="decided"
            projectKey={projectKey}
          />
          {!projectKey && <RuntimeProposalList status="decided" />}
        </div>
      )}
    </>
  );
}
