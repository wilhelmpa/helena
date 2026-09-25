'use client';

import {
  dashboardWidgets,
  homeWidget,
  registerDashboardWidget,
  HOME_PLUGIN_ID,
} from './dashboardWidgets';
import { needsYouSources } from './needsYouSources';
import {
  AgentsTile,
  LimitsTiles,
  SystemTile,
  TasksTile,
  WaitingTile,
} from '@/features/home/dashboard/tiles/HomeTiles';
import NeedsYouSection from '@/features/home/dashboard/sections/NeedsYouSection';
import TasksSection from '@/features/home/dashboard/sections/TasksSection';
import AgentsSection from '@/features/home/dashboard/sections/AgentsSection';
import SchedulesSection from '@/features/home/dashboard/sections/SchedulesSection';
import ProjectsSection from '@/features/home/dashboard/sections/ProjectsSection';
import { BUILTIN_NEEDS_YOU_SOURCES } from '@/features/home/dashboard/sources';
import UpdatesTile from '@/features/update-center/components/UpdatesTile';
import { useServerEntries } from '@/features/server/components/serverNeedsYou';
import { useSecurityEntries } from '@/features/security-status/securityNeedsYou';

// Start's built-in widgets and "Braucht dich" sources (docs/helena-decisions/dashboard.md),
// registered as the internal plugin `helena.home` when Start loads this module. A feature
// adds its tile, section or red problems here: one import and one line, nothing in the page.
//
// Figures (the row at the top), in their default order:
//   waiting · agents · tasks · limits (one tile per subscription) · system · updates
// Sections (below; half-width ones pair up in two columns):
//   needs-you · my-tasks · running · schedules · projects (full width)

const BUILTINS = [
  homeWidget({ id: 'waiting', kind: 'figure', group: 'work', order: 10, component: WaitingTile }),
  homeWidget({ id: 'agents', kind: 'figure', group: 'agents', order: 20, component: AgentsTile }),
  homeWidget({ id: 'tasks', kind: 'figure', group: 'work', order: 30, component: TasksTile }),
  homeWidget({
    id: 'limits',
    kind: 'figure',
    group: 'agents',
    order: 40,
    audience: 'owner',
    component: LimitsTiles,
  }),
  homeWidget({
    id: 'system',
    kind: 'figure',
    group: 'system',
    order: 50,
    audience: 'owner',
    component: SystemTile,
  }),
  homeWidget({
    id: 'updates',
    kind: 'figure',
    group: 'system',
    order: 60,
    audience: 'owner',
    component: UpdatesTile,
  }),
  homeWidget({
    id: 'needs-you',
    kind: 'section',
    group: 'work',
    order: 10,
    rows: 4,
    component: NeedsYouSection,
  }),
  homeWidget({
    id: 'my-tasks',
    kind: 'section',
    group: 'work',
    order: 20,
    rows: 7,
    component: TasksSection,
  }),
  homeWidget({
    id: 'running',
    kind: 'section',
    group: 'agents',
    order: 30,
    rows: 5,
    component: AgentsSection,
  }),
  homeWidget({
    id: 'schedules',
    kind: 'section',
    group: 'agents',
    order: 40,
    rows: 4,
    component: SchedulesSection,
  }),
  homeWidget({
    id: 'projects',
    kind: 'section',
    group: 'work',
    order: 50,
    width: 'full',
    rows: 3,
    component: ProjectsSection,
  }),
];

for (const widget of BUILTINS)
  if (!dashboardWidgets.has(widget.id)) registerDashboardWidget(widget, HOME_PLUGIN_ID);

// The machine's red problems (hub/server-admin), right after the services' and logins'.
const SOURCES = [
  ...BUILTIN_NEEDS_YOU_SOURCES,
  { id: 'server', order: 15, useEntries: useServerEntries },
  // Severe failed checks of the host audit (hub/hardening).
  { id: 'security', order: 17, useEntries: useSecurityEntries },
];

for (const source of SOURCES)
  if (!needsYouSources.has(source.id)) needsYouSources.register(source, HOME_PLUGIN_ID);
