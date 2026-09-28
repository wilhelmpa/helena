import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UiSlotDescriptor } from '@helena/sdk/web';
import {
  dashboardWidgets,
  homeWidget,
  registerDashboardWidget,
  widgetProblem,
} from './dashboardWidgets';
import { pluginDashboardWidget, pluginWidgetId } from './pluginDashboardWidgets';
import { needsYouSources, sortedNeedsYouSources } from './needsYouSources';
import './homeWidgets';

// Start reads its tiles and sections from the dashboard widget registry (@helena/sdk UI slot
// `dashboard-widget`, surface `home`), and "Braucht dich" its entries from the needs-you
// sources, so a feature or a plugin adds to Start without touching the page.

const Empty = () => null;

describe('dashboard widgets', () => {
  it('registers the built-ins: the figure row and the sections, in their default order', () => {
    const list = dashboardWidgets.list().sort((a, b) => a.order - b.order);
    assert.deepEqual(
      list.filter((w) => w.kind === 'figure').map((w) => w.id),
      ['agents', 'tasks', 'limits', 'system', 'local-ai', 'updates'],
    );
    assert.deepEqual(
      list.filter((w) => w.kind === 'section').map((w) => w.id),
      ['running', 'needs-you', 'finished', 'my-tasks', 'schedules', 'projects'],
    );
    assert.deepEqual(
      list.filter((w) => w.audience === 'owner').map((w) => w.id),
      ['limits', 'system', 'local-ai', 'updates'],
    );
    assert.equal(dashboardWidgets.get('projects')?.width, 'full');
    assert.equal(dashboardWidgets.pluginOf('agents'), 'helena.home');
  });

  it('refuses a widget the page could not lay out', () => {
    assert.match(widgetProblem({ kind: 'figure', width: 'half', rows: 0 }) ?? '', /rows/);
    assert.throws(() =>
      registerDashboardWidget(
        {
          ...homeWidget({ id: 'broken', kind: 'section', group: 'x', order: 1, component: Empty }),
          width: 'wide' as never,
        },
        'acme',
      ),
    );
    assert.equal(dashboardWidgets.has('broken'), false);
  });

  it('reads a plugin’s Start widget from its frame slot, under an id of its own', () => {
    const slot: UiSlotDescriptor = {
      key: 'dashboard-widget:weather',
      pluginId: 'acme',
      slot: 'dashboard-widget',
      id: 'weather',
      label: { en: 'Weather', de: 'Wetter' },
      order: 45,
      render: { kind: 'frame', src: 'tile.html' },
      options: { group: 'acme', surfaces: ['home'], kind: 'figure', audience: 'owner', rows: 40 },
    };
    const widget = pluginDashboardWidget(slot);
    assert.equal(widget?.id, pluginWidgetId('acme', 'weather'));
    assert.equal(widget?.id, 'plugin:acme:weather');
    assert.equal(widget?.kind, 'figure');
    assert.equal(widget?.audience, 'owner');
    assert.equal(widget?.rows, 16);
    assert.match(
      widget?.view.kind === 'frame' ? widget.view.url : '',
      /\/plugins\/acme\/ui\/tile\.html$/,
    );
    // A project-dashboard widget is not one of Start's.
    assert.equal(
      pluginDashboardWidget({ ...slot, options: { ...slot.options, surfaces: ['project'] } }),
      null,
    );
    const project = pluginDashboardWidget(
      { ...slot, options: { ...slot.options, surfaces: ['project'], size: { w: 8, h: 6 } } },
      'project',
    );
    assert.equal(project?.id, 'plugin:acme:weather');
    assert.deepEqual(project?.size, { w: 8, h: 6 });
  });
});

describe('needs-you sources', () => {
  it('registers the built-ins: red problems of the system first, failures last', () => {
    assert.deepEqual(
      sortedNeedsYouSources().map((source) => source.id),
      [
        'system',
        'server',
        'updates',
        'security',
        'local-ai',
        'approvals',
        'workflow-steps',
        'proposals',
        'failures',
      ],
    );
    assert.equal(needsYouSources.pluginOf('system'), 'helena.home');
  });
});
