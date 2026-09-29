import { useLocale, useTranslations } from 'next-intl';
import type { Project } from '@/lib/api/endpoints/projects';
import type { BudgetStatus } from '@/lib/api/endpoints/autopilot';
import { useProjectProvisioningQuery } from '@/services/projects.service';
import { projectPath } from '@/utils/paths';
import { projectColor } from '@/utils/projectColor';
import { formatBudgetAmount } from '@/features/autopilot/utils/autopilotFormat';
import BudgetBar from '@/components/helena/BudgetBar';
import { ProjectTile } from '@/components/helena/DashboardPrimitives';
import { Pill } from '@/design-system';
import { useCrossProjectIssuesQuery } from '../../services/tasks.service';
import { budgetState, leadingBudget } from '../../dashboard/budgetAlerts';

// A project on the dashboard (owner, O7: the projects stand out): a tile in the project's
// colour with its name and key, its open tasks and running agents, and — once it has a
// budget — how much of its fullest budget is used, marked when it slows ("gedrosselt") or
// stops ("gestoppt") the work. A failed setup shows too; the team and a finished setup,
// which said nothing, are gone.
export default function HomeProjectCard({
  project,
  budgets,
  working,
}: {
  project: Project;
  budgets?: BudgetStatus[];
  // Agents working in it now.
  working: number;
}) {
  const t = useTranslations('home.projects');
  const tAutopilot = useTranslations('autopilot');
  const locale = useLocale();
  const provisioning = useProjectProvisioningQuery(project.key).data;
  const open = useCrossProjectIssuesQuery(
    { page: 1, pageSize: 1 },
    { stateType: 'open', projectKey: project.key },
  ).data?.total;
  const budget = leadingBudget(budgets);
  const state = budgetState(budget);
  const used = budget
    ? tAutopilot('usedOf', {
        used: formatBudgetAmount(budget.metric, budget.used, locale),
        limit: formatBudgetAmount(budget.metric, budget.limit, locale),
      })
    : null;
  return (
    <ProjectTile
      href={projectPath(project.key)}
      accent={projectColor(project.key)}
      name={project.name}
      projectKey={project.key}
      facts={
        <>
          {open != null && <span>{t('open', { count: open })}</span>}
          {working > 0 && <span>{t('working', { count: working })}</span>}
          {provisioning?.status === 'failed' && <Pill tone="danger">{t('setupFailed')}</Pill>}
          {state !== 'ok' && (
            <Pill tone={state === 'stopped' ? 'danger' : 'warning'}>
              {t(state === 'stopped' ? 'budgetStopped' : 'budgetThrottled')}
            </Pill>
          )}
          {budget && used && <span>{used}</span>}
        </>
      }
      footer={budget ? <BudgetBar budget={budget} label={used ?? undefined} /> : undefined}
    />
  );
}
