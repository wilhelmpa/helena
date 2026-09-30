'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ChevronRight, Download, LibraryBig, Plus, Upload, UserPlus } from 'lucide-react';
import type { Edge, Node } from '@xyflow/react';
import type { Organization, OrganizationAgent } from '@/lib/api/endpoints/organization';
import { listAgentActivity } from '@/lib/api/endpoints/agentActivity';
import { listDecisionLog } from '@/lib/api/endpoints/decisions';
import { getProjectAutopilot } from '@/lib/api/endpoints/autopilot';
import { listIssuesAcrossProjects } from '@/lib/api/endpoints/issues';
import { useAiAgentsQuery, useSaveAiAgentAsTemplate } from '@/services/aiAgents.service';
import { useTeamQuery } from '@/services/teams.service';
import AddTeamMemberDialog from '@/features/organization/components/AddTeamMemberDialog';
import TeamPoolList, { type PoolCreation } from '@/features/organization/components/TeamPoolList';
import { useTemplateBundleExport } from '@/features/teams/components/ai-agents/TemplateBundleDialog';
import { filterPool, type PoolShow } from '@/features/teams/utils/agentPool';
import { qk } from '@/services/queryKeys';
import { deriveStatus, type HelenaStatus, type StatusSignals } from '@/utils/helenaStatus';
import { openAgent as openAgentDialog } from '@/features/settings/settingsModalCatalog';
import {
  EmptyState,
  PageActions,
  PageSearch,
  PageTabs,
  PageToolbar,
  PageToolbarSpacer,
  Segmented,
  SegmentToggle,
} from '@/design-system';
import OrganizationChartFlow from './OrganizationChartFlow';
import OrganizationHoverCard from './OrganizationHoverCard';
import { HoverLayer, createHoverStore } from './organizationHoverStore';
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

// Team (Auftrag 117): the same agents as a ring, a tree or the pool's list.
export type OrganizationChartView = 'tree' | 'ring' | 'list';
type Filter = 'all' | 'running' | 'waiting' | 'throttled' | 'error';

const FILTERS: Filter[] = ['all', 'running', 'waiting', 'throttled', 'error'];
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
  toolbarStart,
  toolbarEnd,
}: {
  organization: Organization;
  projectId?: number;
  // The page's own controls at the start and end of the toolbar (Wer/Warum; the team).
  toolbarStart?: ReactNode;
  toolbarEnd?: ReactNode;
}) {
  const t = useTranslations('organization.chart');
  const tPool = useTranslations('organization.pool');
  const tTeams = useTranslations('teams');
  const tNav = useTranslations('nav');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const project = organization.projects.find((item) => item.id === projectId);
  const agentsQuery = useAiAgentsQuery(organization.teamId);
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
  const [openTask, setOpenTask] = useState<(RingTask & { projectKey: string }) | null>(null);
  // The hover card has its own store: a hover must not re-render the chart, whose new
  // node objects make React Flow re-measure and hide the node under the pointer (the
  // card flickered on and off, owner 29.09.).
  const [hoverStore] = useState(createHoverStore);
  const setHover = hoverStore.set;
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  // "Mitglied hinzufügen" (owner, O23/O57): in the tree and in the ring, for whoever may
  // create agents in the team — from the toolbar, or from the "+" of a node, set to its
  // project and to who the new member reports to (Auftrag 117).
  const [adding, setAdding] = useState<{ projectId?: number; managerId?: number } | null>(null);
  const canAdd = useTeamQuery(organization.teamId).data?.permissions.ai_agents.create ?? false;
  const saveTemplate = useSaveAiAgentAsTemplate(organization.teamId);
  // The list (the pool): what it shows, and a new agent or template in the overlay.
  const [poolShow, setPoolShow] = useState<PoolShow>('all');
  const [creating, setCreating] = useState<PoolCreation>(null);
  const [importing, setImporting] = useState(false);
  const exporting = useTemplateBundleExport(organization.teamId);

  // View, level and the task ring live in the address, so a link and the back button
  // reach them; the defaults leave it clean.
  const defaultView: OrganizationChartView = projectId == null ? 'ring' : 'tree';
  const requestedView = params.get('orgView');
  const view: OrganizationChartView =
    requestedView === 'tree' || requestedView === 'ring' || requestedView === 'list'
      ? requestedView
      : defaultView;
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
      view === 'tree' ? organizationChartLayout(agents, collapsed, delegating, { tasks }) : null,
    [agents, collapsed, delegating, tasks, view],
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
  // The list view has neither.
  const layout = tree ?? ring ?? { nodes: [] as Node[], edges: [] as Edge[] };
  const filtering = filter !== 'all' || query !== '';

  // The "+" of a node: members join a coordinator (or Home) in its project; any agent can
  // become a template of the pool.
  const addAt = (agent: OrganizationAgent) =>
    canAdd && (agent.isHome || agent.role === 'coordinator')
      ? () =>
          setAdding({
            projectId: agent.isHome ? projectId : (agent.projects[0]?.id ?? projectId),
            managerId: agent.id,
          })
      : undefined;
  const saveAt = (agent: OrganizationAgent) =>
    canAdd && !agent.isHome && !agent.template
      ? () => saveTemplate.mutate({ agentId: agent.id })
      : undefined;
  const agentData = (agent: OrganizationAgent): ChartAgentData => {
    const levels = trustByAgent.get(agent.id);
    return {
      onAdd: addAt(agent),
      onSaveTemplate: saveAt(agent),
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
      const target = group.target;
      return {
        ...node,
        data: {
          group,
          onAdd:
            canAdd && target
              ? () => setAdding(target.kind === 'project' ? { projectId: target.id } : {})
              : undefined,
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
    if (!agent) {
      // A department in the middle of the ring: members join one of its projects.
      return node.type === 'hub' && canAdd
        ? { ...node, data: { ...node.data, onAdd: () => setAdding({}) } }
        : node;
    }
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
    // The agent's settings open in the agent dialog over the chart (design-system §3).
    if (byId.has(id)) openAgentDialog(id, organization.teamId, 'overview');
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

  const projectKey = project?.key ?? null;
  const poolCounts = (() => {
    const all = filterPool(agentsQuery.data ?? [], { search, projectKey });
    return {
      all: all.agents.length + all.templates.length,
      agents: all.agents.length,
      templates: all.templates.length,
    };
  })();
  const viewSwitch = (
    <Segmented
      value={view}
      onChange={(next) => setView(next)}
      label={t('viewLabel')}
      options={[
        { value: 'ring', label: t('viewRing') },
        { value: 'tree', label: t('viewTree') },
        { value: 'list', label: t('viewList') },
      ]}
    />
  );
  const addDialog = adding && (
    <AddTeamMemberDialog
      organization={organization}
      projectId={adding.projectId ?? projectId}
      managerId={adding.managerId}
      onCreateNew={(projectForNew) => {
        setAdding(null);
        setCreating({ projectId: projectForNew });
      }}
      onClose={() => setAdding(null)}
    />
  );

  // Liste: the pool of the team (on a project's page, the project's agents and the
  // templates), with the same toolbar as the chart.
  if (view === 'list')
    return (
      <div className="ds-org">
        <PageToolbar>
          {viewSwitch}
          <PageTabs<PoolShow>
            label={tPool('showLabel')}
            value={poolShow}
            onChange={setPoolShow}
            items={(['all', 'agents', 'templates'] as const).map((item) => ({
              value: item,
              label: tPool(
                item === 'all' ? 'showAll' : item === 'agents' ? 'showAgents' : 'showTemplates',
              ),
              count: poolCounts[item],
            }))}
          />
          <PageToolbarSpacer />
          <PageSearch value={search} onChange={setSearch} placeholder={t('searchPlaceholder')} />
          {toolbarEnd}
          {canAdd && (
            <PageActions
              actions={[
                {
                  id: 'new-agent',
                  label: tPool('newAgent'),
                  icon: Plus,
                  onClick: () => setCreating({ projectId }),
                },
                {
                  id: 'new-template',
                  label: tPool('newTemplate'),
                  icon: LibraryBig,
                  onClick: () => setCreating({ asTemplate: true }),
                },
                {
                  id: 'import-templates',
                  label: tTeams('templateBundles.importAction'),
                  icon: Upload,
                  onClick: () => setImporting(true),
                },
                {
                  id: 'export-templates',
                  label: tTeams('templateBundles.exportAction'),
                  icon: Download,
                  disabled: exporting.isPending,
                  onClick: () => exporting.mutate(),
                },
              ]}
              primary={{
                id: 'add-member',
                label: t('addMember'),
                icon: UserPlus,
                onClick: () => setAdding({}),
              }}
            />
          )}
        </PageToolbar>
        <TeamPoolList
          teamId={organization.teamId}
          projectKey={projectKey}
          search={search}
          show={poolShow}
          creating={creating}
          onCreatingChange={setCreating}
          importing={importing}
          onImportingChange={setImporting}
        />
        {addDialog}
      </div>
    );

  if (organizationChartAgents(organization.agents, projectId).length === 0)
    return (
      <div className="ds-org">
        <PageToolbar>{viewSwitch}</PageToolbar>
        <EmptyState>{t('empty')}</EmptyState>
      </div>
    );

  const crumbLabel = (crumb: (typeof scope.crumbs)[number]) =>
    crumb.focus.kind === 'root' && projectId == null ? tNav('sidebarHome') : crumb.label;

  return (
    <div className="ds-org">
      <PageToolbar>
        {toolbarStart}
        {viewSwitch}
        {/* The same "Aufgaben" in both views, at the same place (owner, 29.09.). */}
        <SegmentToggle
          pressed={showTasks}
          onPressedChange={(on) => setParams({ orgTasks: on ? '1' : null })}
        >
          {t('tasksToggle')}
        </SegmentToggle>
        {/* The status filter is one of the page's tabs (owner, O20: one pattern). */}
        <PageTabs<Filter>
          label={t('filterLabel')}
          value={filter}
          onChange={setFilter}
          items={FILTERS.map((item) => ({
            value: item,
            label: t(`filter.${item}`),
            count: counts[item],
            dot:
              item !== 'all' && counts[item] > 0
                ? item === 'running'
                  ? 'working'
                  : item === 'waiting'
                    ? 'waiting'
                    : 'error'
                : null,
          }))}
        />
        <PageToolbarSpacer />
        <PageSearch value={search} onChange={setSearch} placeholder={t('searchPlaceholder')} />
        {toolbarEnd}
        {canAdd && (
          <PageActions
            primary={{
              id: 'add-member',
              label: t('addMember'),
              icon: UserPlus,
              onClick: () => setAdding({}),
            }}
          />
        )}
      </PageToolbar>
      <section className="ds-org-stage" aria-label={tNav('sidebarTeamDeciders')}>
        {scope.crumbs.length > 1 && (
          <nav aria-label={t('levels')} className="ds-org-levels">
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
        <div className="ds-org-canvas">
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
            // The hover store keeps the card for the same node and never re-renders the chart.
            onHover={setHover}
            label={view === 'tree' ? t('viewTree') : t('viewRing')}
          />
          <HoverLayer store={hoverStore}>
            {(hover) => (
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
          </HoverLayer>
        </div>
        {delegating.size > 0 && (
          <p className="ds-org-foot">
            {t('delegation', {
              agents: agents
                .filter((agent) => delegating.has(agent.id))
                .map((agent) => agent.name)
                .join(' · '),
            })}
          </p>
        )}
      </section>
      {addDialog}
      {creating && (
        <TeamPoolList
          teamId={organization.teamId}
          projectKey={projectKey}
          search=""
          show="all"
          creating={creating}
          onCreatingChange={setCreating}
          importing={false}
          onImportingChange={() => undefined}
          onlyOverlays
        />
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
