'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ChevronRight, Search } from 'lucide-react';
import type { Edge, Node } from '@xyflow/react';
import type { Organization, OrganizationAgent } from '@/lib/api/endpoints/organization';
import { listAgentActivity } from '@/lib/api/endpoints/agentActivity';
import { listDecisionLog } from '@/lib/api/endpoints/decisions';
import { getProjectAutopilot } from '@/lib/api/endpoints/autopilot';
import { listIssuesAcrossProjects } from '@/lib/api/endpoints/issues';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { useTeamQuery } from '@/services/teams.service';
import { qk } from '@/services/queryKeys';
import { deriveStatus, type HelenaStatus, type StatusSignals } from '@/utils/helenaStatus';
import { projectColor } from '@/utils/projectColor';
import { AgentSectionProvider } from '@/features/teams/context/agentSection';
import { TeamAiAgentSheet } from '@/features/teams/components/ai-agents/TeamAiAgentSheet';
import OrganizationChartFlow, { type ChartHover } from './OrganizationChartFlow';
import OrganizationHoverCard from './OrganizationHoverCard';
import OrganizationTaskSheet from './OrganizationTaskSheet';
import type { ChartAgentData } from './OrganizationChartNode';
import { organizationChartAgents } from './organizationChartAgents';
import { organizationChartLayout } from './organizationChartLayout';
import {
  organizationRingLayout,
  type RingGroup,
  type RingLevel,
  type RingTask,
} from './organizationRingLayout';
import { organizationChartState } from './organizationChartState';
import {
  focusFromParam,
  focusParam,
  focusScope,
  type OrganizationFocus,
} from './organizationFocus';
import { useOrganizationToolStates } from './useOrganizationToolStates';

export type OrganizationChartView = 'tree' | 'ring';
type Filter = 'all' | 'running' | 'waiting' | 'throttled' | 'error';

const FILTERS: Filter[] = ['all', 'running', 'waiting', 'throttled', 'error'];
const FILTER_DOT: Record<Filter, string> = {
  all: 'var(--muted-foreground)',
  running: 'var(--status-thinking)',
  waiting: 'var(--status-waiting)',
  throttled: 'var(--status-throttled)',
  error: 'var(--status-error)',
};

function matchesFilter(status: HelenaStatus, filter: Filter) {
  if (filter === 'all') return true;
  if (filter === 'running') return status === 'thinking' || status === 'tool';
  if (filter === 'error') return status === 'error' || status === 'offline';
  return status === filter;
}

function overBudget(agent: OrganizationAgent) {
  return (
    (agent.dailyTokenCeiling != null && agent.tokensToday >= agent.dailyTokenCeiling) ||
    (agent.monthlyTokenCeiling != null && agent.tokensThisMonth >= agent.monthlyTokenCeiling)
  );
}

// Two views of the same organization (ui-system.md §8): "Kreis" (radial, default on
// Home) and "Baum" (the classic org chart, default in a project). Both open on every
// level (Home, department, project, single agent) with a breadcrumb back. A click on an
// agent opens its full settings in the agent sheet on top of the chart; nothing behind
// it moves or navigates. A double click opens the agent's own ring.
export default function OrganizationChart({
  organization,
  projectId,
}: {
  organization: Organization;
  projectId?: number;
}) {
  const t = useTranslations('organization.chart');
  const tNav = useTranslations('nav');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const project = organization.projects.find((item) => item.id === projectId);
  const agentsQuery = useAiAgentsQuery(organization.teamId);
  const permissions = useTeamQuery(organization.teamId).data?.permissions.ai_agents;
  const trustProjects = organization.projects.filter((item) =>
    projectId == null
      ? organization.agents.some((agent) =>
          agent.projects.some((project) => project.id === item.id),
        )
      : item.id === projectId,
  );
  const trustQueries = useQueries({
    queries: trustProjects.map((item) => ({
      queryKey: qk.projectAutopilot(item.key),
      queryFn: () => getProjectAutopilot(item.key),
    })),
  });
  const decisions = useQuery({
    queryKey: ['decisions', organization.teamId, 'chart-log'],
    queryFn: () => listDecisionLog(organization.teamId, { limit: 100 }),
  });
  const activity = useQuery({
    queryKey: qk.agentActivity(project?.key ?? null, { window: 100 }),
    queryFn: () => listAgentActivity(project?.key ?? null, { limit: 100 }, null),
    refetchInterval: 15_000,
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [openTask, setOpenTask] = useState<(RingTask & { projectKey: string }) | null>(null);
  const [hover, setHover] = useState<ChartHover | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  // View, level and the task ring live in the address, so a link and the back button
  // reach them; the defaults leave it clean.
  const defaultView: OrganizationChartView = projectId == null ? 'ring' : 'tree';
  const requestedView = params.get('orgView');
  const view: OrganizationChartView =
    requestedView === 'tree' || requestedView === 'ring' ? requestedView : defaultView;
  const focusValue = params.get('orgFocus');
  const focus = useMemo(
    () => focusFromParam(focusValue, organization, projectId),
    [focusValue, organization, projectId],
  );
  const showTasks = params.get('orgTasks') === '1';
  const setParams = (changes: Record<string, string | null>) => {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value == null) query.delete(key);
      else query.set(key, value);
    }
    const search = query.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  };
  const setView = (next: OrganizationChartView) =>
    setParams({ orgView: next === defaultView ? null : next });
  const setFocus = (next: OrganizationFocus) => {
    setHover(null);
    setParams({ orgFocus: focusParam(next) });
  };

  const scope = useMemo(
    () => focusScope(organization, focus, projectId),
    [organization, focus, projectId],
  );
  const agents = scope.agents;
  const byId = useMemo(
    () => new Map((agentsQuery.data ?? []).map((agent) => [agent.id, agent])),
    [agentsQuery.data],
  );
  const selected = agents.find((agent) => agent.id === selectedId) ?? null;
  const editing = editingId == null ? null : (byId.get(editingId) ?? null);

  useEffect(() => {
    if (selectedId == null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // An open dialog or sheet (the agent sheet, a task) takes Esc first.
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  const eyebrow =
    `${project?.name ?? tNav('sidebarHome')} · ${tNav('sidebarAutomation')}`.toUpperCase();
  const eyebrowColor = projectColor(project?.key ?? null);
  const entries = useMemo(() => activity.data?.items ?? [], [activity.data]);
  const usingTools = useOrganizationToolStates(organization.teamId, entries);
  const delegating = useMemo(
    () =>
      new Set(
        entries
          .filter(
            (entry) =>
              entry.trigger === 'delegation' &&
              ['pending', 'running', 'streaming'].includes(entry.status) &&
              entry.agent,
          )
          .map((entry) => entry.agent!.id),
      ),
    [entries],
  );
  const deciderByAgent = useMemo(() => {
    const result = new Map<number, string>();
    for (const item of decisions.data?.items ?? []) {
      if (item.agentId != null && !result.has(item.agentId) && (item.backend || item.model))
        result.set(item.agentId, item.backend ?? item.model!);
    }
    return result;
  }, [decisions.data]);
  const trustByAgent = new Map<number, Set<number>>();
  for (const query of trustQueries) {
    for (const entry of query.data?.agents ?? []) {
      const levels = trustByAgent.get(entry.id) ?? new Set<number>();
      levels.add(entry.effective.level);
      trustByAgent.set(entry.id, levels);
    }
  }

  // The status signals per agent, the same the Orb uses, so the filter counts what the
  // cards show.
  const signals = useMemo(() => {
    const result = new Map<number, StatusSignals>();
    for (const agent of agents) {
      const state = organizationChartState(agent, entries, usingTools.has(agent.id));
      result.set(agent.id, {
        run: state === 'thinking' || state === 'tool' ? 'running' : state,
        tool: state === 'tool',
        runtimeStatus: agent.runtimeState.status,
        budget: overBudget(agent),
      });
    }
    return result;
  }, [agents, entries, usingTools]);
  const statuses = useMemo(
    () => new Map([...signals].map(([id, signal]) => [id, deriveStatus(signal)])),
    [signals],
  );

  // The current tasks of the agents (open, running), only while the task ring is on.
  const tasksQuery = useQuery({
    queryKey: ['organization-chart-tasks', organization.teamId, project?.key ?? null],
    queryFn: () =>
      listIssuesAcrossProjects(
        { page: 1, pageSize: 100 },
        { stateType: 'open', assignee: 'agents', projectKey: project?.key },
      ),
    enabled: showTasks,
    refetchInterval: 30_000,
  });
  const tasks = useMemo(() => {
    if (!showTasks) return [];
    const agentByUser = new Map(agents.map((agent) => [agent.userId, agent]));
    const result: (RingTask & { projectKey: string; stateName: string })[] = [];
    for (const item of tasksQuery.data?.items ?? []) {
      const agent =
        agentByUser.get(item.delegate?.userId ?? '') ??
        agentByUser.get(item.assignee?.userId ?? '');
      if (!agent) continue;
      const status = statuses.get(agent.id);
      result.push({
        id: item.id,
        identifier: item.identifier,
        title: item.title,
        agentId: agent.id,
        projectKey: item.projectKey,
        stateName: item.stateName,
        color:
          item.stateType === 'started'
            ? status === 'waiting'
              ? 'var(--status-waiting)'
              : 'var(--status-thinking)'
            : 'var(--status-idle)',
      });
    }
    return result;
  }, [agents, showTasks, statuses, tasksQuery.data]);

  const counts = useMemo(() => {
    const result: Record<Filter, number> = {
      all: agents.length,
      running: 0,
      waiting: 0,
      throttled: 0,
      error: 0,
    };
    for (const status of statuses.values())
      for (const item of FILTERS)
        if (item !== 'all' && matchesFilter(status, item)) result[item] += 1;
    return result;
  }, [agents.length, statuses]);
  const query = search.trim().toLocaleLowerCase();
  const matches = useCallback(
    (agent: OrganizationAgent) =>
      matchesFilter(statuses.get(agent.id) ?? 'idle', filter) &&
      (!query ||
        agent.name.toLocaleLowerCase().includes(query) ||
        agent.roleTitle.toLocaleLowerCase().includes(query) ||
        agent.projects.some(
          (item) =>
            item.key.toLocaleLowerCase().includes(query) ||
            item.name.toLocaleLowerCase().includes(query),
        )),
    [filter, query, statuses],
  );

  const toggle = (id: number) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const ringLevel: RingLevel =
    focus.kind === 'root' ? (projectId == null ? 'home' : 'project') : focus.kind;
  const focusId = focus.kind === 'root' ? projectId : focus.id;
  const tree = useMemo(
    () =>
      view === 'tree'
        ? organizationChartLayout(agents, collapsed, delegating, {
            stackLeaves: ringLevel === 'home' || ringLevel === 'department',
          })
        : null,
    [agents, collapsed, delegating, ringLevel, view],
  );
  const ring = useMemo(
    () =>
      view === 'ring'
        ? organizationRingLayout({
            level: ringLevel,
            agents,
            departments: organization.departments,
            projects: organization.projects,
            focusId,
            delegating,
            tasks,
          })
        : null,
    [
      agents,
      delegating,
      focusId,
      organization.departments,
      organization.projects,
      ringLevel,
      tasks,
      view,
    ],
  );
  const layout = tree ?? ring!;
  const filtering = filter !== 'all' || query !== '';

  const agentData = (agent: OrganizationAgent): ChartAgentData => {
    const levels = trustByAgent.get(agent.id);
    return {
      agent,
      settings: byId.get(agent.id) ?? null,
      trustLabel:
        levels?.size === 1
          ? t('level', { level: [...levels][0]! })
          : levels && levels.size > 1
            ? t('projectDependent')
            : null,
      decider: deciderByAgent.get(agent.id) ?? null,
      signals: signals.get(agent.id) ?? {},
      selected: selected?.id === agent.id,
      dimmed: filtering && !matches(agent),
      reportCount: 0,
      showCollapse: ringLevel === 'home' || ringLevel === 'department',
      collapsed: collapsed.has(agent.id),
      onToggle: toggle,
    };
  };
  const byAgentId = new Map(agents.map((agent) => [agent.id, agent]));
  const nodes: Node[] = layout.nodes.map((node) => {
    if (node.type === 'group') {
      const group = (node.data as { group: RingGroup }).group;
      return {
        ...node,
        data: {
          group,
          dimmed:
            filtering &&
            !group.members.some((id) => {
              const agent = byAgentId.get(id);
              return agent ? matches(agent) : false;
            }),
        },
      };
    }
    if (node.type === 'task') {
      const task = (node.data as { task: RingTask }).task;
      const agent = byAgentId.get(task.agentId);
      return { ...node, data: { ...node.data, dimmed: filtering && agent && !matches(agent) } };
    }
    const agent = byAgentId.get(Number(node.id));
    if (!agent) return node;
    return {
      ...node,
      data: {
        ...node.data,
        ...agentData(agent),
        reportCount: (node.data.reportCount as number | undefined) ?? 0,
        dimmed: node.type === 'hub' ? false : filtering && !matches(agent),
      },
    };
  });
  const dimmedIds = new Set(
    nodes.filter((node) => (node.data as { dimmed?: boolean }).dimmed).map((node) => node.id),
  );
  const edges: Edge[] = layout.edges.map((edge) =>
    dimmedIds.has(edge.target) || dimmedIds.has(edge.source)
      ? { ...edge, data: { ...edge.data, dimmed: true } }
      : edge,
  );

  const openAgent = (id: number) => {
    setHover(null);
    setSelectedId(id);
    if (byId.has(id) && permissions) setEditingId(id);
  };
  const onActivate = (node: Node) => {
    if (node.type === 'group') {
      const target = (node.data as { group: RingGroup }).group.target;
      if (target) setFocus(target);
      return;
    }
    if (node.type === 'task') {
      const task = (node.data as { task: RingTask & { projectKey: string } }).task;
      setHover(null);
      setOpenTask(task);
      return;
    }
    const id = Number(node.id);
    if (Number.isInteger(id)) openAgent(id);
  };
  const onDrill = (node: Node) => {
    if (node.type === 'group') return onActivate(node);
    const id = Number(node.id);
    if (!Number.isInteger(id)) return;
    // The agent already in the middle: one level up.
    if (focus.kind === 'agent' && focus.id === id) {
      const up = scope.crumbs.at(-2);
      if (up) setFocus(up.focus);
      return;
    }
    setFocus({ kind: 'agent', id });
  };

  if (organizationChartAgents(organization.agents, projectId).length === 0)
    return <p className="rounded-[18px] bg-card p-6 text-sm text-muted-foreground">{t('empty')}</p>;

  const crumbLabel = (crumb: (typeof scope.crumbs)[number]) =>
    crumb.focus.kind === 'root' && projectId == null ? tNav('sidebarHome') : crumb.label;

  return (
    <div
      className={`organization-chart min-w-0 xl:ps-7 xl:pe-4 ${projectId == null ? '' : 'project-organization-chart pt-[6px]'}`}
    >
      <section
        className={`relative flex min-h-[560px] min-w-0 flex-col ${projectId == null ? 'h-[calc(100dvh-140px)]' : 'h-[calc(100dvh-48px)]'}`}
        aria-label={tNav('sidebarTeamDeciders')}
      >
        <header className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <p
              className="mb-[10px] font-mono text-[10px] font-medium tracking-[.23em]"
              style={{ color: eyebrowColor }}
            >
              {eyebrow}
            </p>
            <h1 className="text-[30px] leading-[1.04] font-[520] tracking-[-.05em] sm:text-[38px]">
              {tNav('sidebarTeamDeciders')}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {view === 'ring' && (
              <button
                type="button"
                aria-pressed={showTasks}
                onClick={() => setParams({ orgTasks: showTasks ? null : '1' })}
                className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[13px] px-4 text-xs font-medium shadow-[0_0_0_1px_var(--border)] transition-colors ${showTasks ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
              >
                <span
                  aria-hidden="true"
                  className={`relative h-4 w-7 rounded-full transition-colors ${showTasks ? 'bg-brand' : 'bg-border'}`}
                >
                  <span
                    className={`absolute top-0.5 size-3 rounded-full bg-background transition-[inset-inline-start] ${showTasks ? 'start-3.5' : 'start-0.5'}`}
                  />
                </span>
                {t('tasksToggle')}
              </button>
            )}
            <div
              role="group"
              aria-label={t('viewLabel')}
              className="flex rounded-[13px] bg-muted p-1 shadow-[0_0_0_1px_var(--border)]"
            >
              {(['tree', 'ring'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={view === item}
                  onClick={() => setView(item)}
                  className={`min-h-9 cursor-pointer rounded-[10px] px-4 text-xs font-medium transition-colors ${view === item ? 'bg-accent text-accent-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {item === 'tree' ? t('viewTree') : t('viewRing')}
                </button>
              ))}
            </div>
          </div>
        </header>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap gap-2">
            {FILTERS.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={filter === item}
                onClick={() => setFilter(item)}
                className={`flex min-h-[30px] cursor-pointer items-center gap-[7px] rounded-full border border-border px-3 text-xs font-medium whitespace-nowrap ${filter === item ? 'bg-accent text-accent-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
              >
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full"
                  style={{ background: FILTER_DOT[item] }}
                />
                {t(`filter.${item}`)}
                <span className="text-muted-foreground tabular-nums">{counts[item]}</span>
              </button>
            ))}
          </div>
          <label className="relative flex w-full items-center sm:w-[220px]">
            <span className="sr-only">{t('searchLabel')}</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute start-3 size-3.5 text-muted-foreground"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && search) {
                  event.preventDefault();
                  setSearch('');
                }
                if (event.key === 'Enter') {
                  const first = agents.find(matches);
                  if (first) setSelectedId(first.id);
                }
              }}
              placeholder={t('searchPlaceholder')}
              className="h-[34px] w-full rounded-full border border-border bg-card ps-8 pe-3 text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
        </div>
        {scope.crumbs.length > 1 && (
          <nav aria-label={t('levels')} className="mb-2">
            <ol className="flex flex-wrap items-center gap-1 text-xs">
              {scope.crumbs.map((crumb, index) => {
                const last = index === scope.crumbs.length - 1;
                return (
                  <li key={focusParam(crumb.focus) ?? 'root'} className="flex items-center gap-1">
                    {index > 0 && (
                      <ChevronRight aria-hidden="true" className="size-3 text-muted-foreground" />
                    )}
                    {last ? (
                      <span aria-current="page" className="px-1.5 py-1 font-medium">
                        {crumbLabel(crumb)}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setFocus(crumb.focus)}
                        className="cursor-pointer rounded-md px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        {crumbLabel(crumb)}
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        )}
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[18px]">
          <OrganizationChartFlow
            key={view}
            view={view}
            nodes={nodes}
            edges={edges}
            orbits={ring?.orbits ?? []}
            fitKey={`${view}:${focusParam(focus) ?? 'root'}:${showTasks ? 'tasks' : ''}`}
            onActivate={onActivate}
            onDrill={onDrill}
            onPaneClick={() => {
              setSelectedId(null);
              setHover(null);
            }}
            onHover={setHover}
            label={view === 'tree' ? t('viewTree') : t('viewRing')}
          />
          {hover && (
            <OrganizationHoverCard
              hover={hover}
              agent={byAgentId.get(Number(hover.node.id)) ?? null}
              data={hover.node.data}
              settings={byId.get(Number(hover.node.id)) ?? null}
              status={statuses.get(Number(hover.node.id)) ?? null}
              trustLabel={
                byAgentId.has(Number(hover.node.id))
                  ? agentData(byAgentId.get(Number(hover.node.id))!).trustLabel
                  : null
              }
              decider={deciderByAgent.get(Number(hover.node.id)) ?? null}
              taskCount={tasks.filter((task) => task.agentId === Number(hover.node.id)).length}
              showTasks={showTasks}
            />
          )}
        </div>
        {delegating.size > 0 && (
          <p className="mt-2 font-mono text-[10px] tracking-[.09em] text-muted-foreground">
            {t('delegation', {
              agents: agents
                .filter((agent) => delegating.has(agent.id))
                .map((agent) => agent.name)
                .join(' · '),
            })}
          </p>
        )}
      </section>
      {permissions && (
        <AgentSectionProvider teamId={organization.teamId} permissions={permissions}>
          <TeamAiAgentSheet
            open={editing != null}
            agent={editing}
            projectId={projectId}
            onClose={() => setEditingId(null)}
          />
        </AgentSectionProvider>
      )}
      {openTask && (
        <OrganizationTaskSheet
          projectKey={openTask.projectKey}
          issueId={openTask.id}
          onClose={() => setOpenTask(null)}
        />
      )}
    </div>
  );
}
