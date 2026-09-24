'use client';

import { useMemo, useState } from 'react';
import { Gauge } from 'lucide-react';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { AUTOPILOT_LEVELS, type AutopilotLevel, type Usage } from '@/lib/api/endpoints/autopilot';
import {
  useAgentAutopilot,
  useSetAgentBudgets,
  useSetAgentLevel,
} from '@/services/autopilot.service';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import AutopilotLevelBadge from '@/features/autopilot/components/AutopilotLevelBadge';
import BudgetFields, { BudgetUsage } from '@/features/autopilot/components/BudgetFields';
import {
  changedBudgets,
  draftFrom,
  formatBudgetAmount,
  type BudgetCellKey,
} from '@/features/autopilot/utils/autopilotFormat';
import { useAgentCan, useAgentSection } from '../../context/agentSection';
import { AgentFormSection } from './AgentFormSection';

// Radix Select needs a non-empty value: this one means "follow the project".
const FOLLOW_PROJECT = 'project';

// The agent's Autopilot on its page: the level it works at in each of its projects and where
// that comes from, its own level (stricter, or higher when the team's owner allows it), what
// it used today and this month, and its budgets with what is left. Saved on its own, not
// with the agent form: these are the owner's controls over the agent, not its settings.
export default function AgentAutopilotSection({
  agent,
  ...section
}: {
  agent: AiAgent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('autopilot');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const { teamId } = useAgentSection();
  const can = useAgentCan();
  const editable = can('edit');
  const query = useAgentAutopilot(teamId, agent.id);
  const setLevel = useSetAgentLevel(teamId, agent.id);
  const setBudgets = useSetAgentBudgets(teamId, agent.id);
  const data = query.data;

  const [draft, setDraft] = useState<Record<BudgetCellKey, string> | null>(null);
  const stored = useMemo(() => (data ? draftFrom(data.budgets) : null), [data]);
  // The first read fills the draft; later reads leave what was typed (adjusted during
  // render, not in an effect).
  if (draft === null && stored !== null) setDraft(stored);
  const changes = data && draft ? changedBudgets(data.budgets, draft) : [];
  const dirty = changes === null || changes.length > 0;

  async function saveLevel(level: AutopilotLevel | null, raise: boolean) {
    try {
      await setLevel.mutateAsync({ level, raise });
    } catch {
      // Surfaced by the global mutation error toast.
    }
  }

  async function saveBudgets() {
    if (changes === null) {
      toast.error(t('invalidLimit'));
      return;
    }
    try {
      const next = await setBudgets.mutateAsync(changes);
      setDraft(draftFrom(next.budgets));
      toast.success(t('budgetsSaved'));
    } catch {
      // Surfaced by the global mutation error toast.
    }
  }

  const first = data?.projects[0]?.effective.level;
  // A pause a used-up budget of the agent's caused reads from that budget, in the reader's
  // language, instead of the server's reason.
  const reachedBudget = data?.budgets.find((budget) => budget.reached && budget.graceRuns === 0);

  return (
    <AgentFormSection
      {...section}
      icon={Gauge}
      title={t('agent.title')}
      hint={t('agent.hint')}
      headerRight={first != null ? <AutopilotLevelBadge level={first} /> : undefined}
    >
      {!data || !draft ? (
        <p className="text-xs text-muted-foreground">{tCommon('loading')}</p>
      ) : (
        <div className="space-y-5">
          {data.paused && (reachedBudget || data.pauseReason) && (
            <p className="rounded-md bg-status-waiting/10 px-3 py-2 text-xs text-status-waiting">
              {reachedBudget
                ? t('agent.pausedBudget', {
                    budget: t(`card.periodBudget.${reachedBudget.period}`),
                    metric: t(`metric.${reachedBudget.metric}`),
                    usage: t('usedOf', {
                      used: formatBudgetAmount(reachedBudget.metric, reachedBudget.used, locale),
                      limit: formatBudgetAmount(reachedBudget.metric, reachedBudget.limit, locale),
                    }),
                  })
                : t('agent.pausedBecause', { reason: data.pauseReason ?? '' })}
            </p>
          )}

          {data.projects.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('agent.noProjects')}</p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-md border border-sidebar-border bg-card">
              {data.projects.map((project) => (
                <li key={project.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {t('agent.inProject', { project: project.name })}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {t(`level.${project.effective.level}.name`)} ·{' '}
                      {t(`source.${project.effective.source}`)}
                    </span>
                  </span>
                  <AutopilotLevelBadge level={project.effective.level} />
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground" htmlFor="agent-autopilot-level">
                {t('agent.own')}
              </label>
              <Select
                value={data.agentLevel == null ? FOLLOW_PROJECT : String(data.agentLevel)}
                disabled={!editable || setLevel.isPending}
                onValueChange={(next) =>
                  void saveLevel(
                    next === FOLLOW_PROJECT ? null : (Number(next) as AutopilotLevel),
                    next === FOLLOW_PROJECT ? false : data.raise,
                  )
                }
              >
                <SelectTrigger id="agent-autopilot-level" size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FOLLOW_PROJECT}>{t('agent.followProject')}</SelectItem>
                  {AUTOPILOT_LEVELS.map((level) => (
                    <SelectItem key={level} value={String(level)}>
                      {level} · {t(`level.${level}.name`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-start gap-3 rounded-md border border-sidebar-border bg-card px-3 py-2">
              <Switch
                id={`agent-${agent.id}-autopilot-raise`}
                checked={data.raise}
                disabled={!editable || data.agentLevel == null || setLevel.isPending}
                onCheckedChange={(raise) => void saveLevel(data.agentLevel, raise)}
                className="mt-0.5"
              />
              <label htmlFor={`agent-${agent.id}-autopilot-raise`} className="space-y-0.5">
                <span className="block text-sm">{t('agent.raise')}</span>
                <span className="block text-xs text-muted-foreground">{t('agent.raiseHint')}</span>
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">{t('agent.usage')}</p>
            <div className="grid grid-cols-2 gap-2">
              <UsageCard label={t('agent.today')} usage={data.usage.today} locale={locale} />
              <UsageCard label={t('agent.month')} usage={data.usage.month} locale={locale} />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t('budgetsTitle')} · {t('agent.budgetsHint')}
            </p>
            <div className="rounded-md border border-sidebar-border bg-card">
              <BudgetFields
                idPrefix={`agent-${agent.id}-budget`}
                budgets={data.budgets}
                draft={draft}
                disabled={!editable || setBudgets.isPending}
                onChange={(key, value) => setDraft({ ...draft, [key]: value })}
              />
            </div>
            {editable && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!dirty || setBudgets.isPending}
                onClick={() => void saveBudgets()}
              >
                {setBudgets.isPending ? tCommon('saving') : tCommon('save')}
              </Button>
            )}
          </div>

          {data.projects
            .filter((project) => project.budgets.length > 0)
            .map((project) => (
              <div key={project.id} className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('agent.projectBudgets', { project: project.name })}
                </p>
                <ul className="space-y-2">
                  {project.budgets.map((budget) => (
                    <li key={budget.id} className="space-y-1">
                      <p className="text-xs">
                        {t(`metric.${budget.metric}`)} {t(`period.${budget.period}`)}
                      </p>
                      <BudgetUsage status={budget} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}
    </AgentFormSection>
  );
}

function UsageCard({ label, usage, locale }: { label: string; usage: Usage; locale: string }) {
  return (
    <div className="space-y-0.5 rounded-md border border-sidebar-border bg-card px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium tabular-nums">
        {formatBudgetAmount('cost', usage.cost, locale)}
      </p>
      <p className="text-xs text-muted-foreground tabular-nums">
        {formatBudgetAmount('tokens', usage.tokens, locale)} ·{' '}
        {formatBudgetAmount('time', usage.seconds, locale)}
      </p>
    </div>
  );
}
