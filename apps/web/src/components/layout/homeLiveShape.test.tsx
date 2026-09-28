import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import type { Project } from '@/lib/api/endpoints/projects';
import { projectTree } from '@/utils/projectTree';
import { soleTeamId } from '@/utils/homeTeamScope';
import { homeNavigation } from './homeNavigation';
import SidebarProjectSwitcher from './SidebarProjectSwitcher';

test('Home navigation and project switcher work with no HOME project row', () => {
  const projects = [
    { id: 1, teamId: 1, key: 'MKT', name: 'Marketing', projectRole: 'project' },
  ] as Project[];
  assert.equal(soleTeamId([{ id: 1 }]), 1);
  assert.deepEqual(
    projectTree(projects).ungrouped.map((project) => project.key),
    ['MKT'],
  );
  assert.deepEqual(
    homeNavigation(1)
      .filter((item) =>
        ['overview', 'allWorkItems', 'files', 'schedules', 'organization'].includes(item.id),
      )
      .map((item) => item.href),
    ['/', '/tasks', '/files', '/organization', '/schedules'],
  );
  const html = renderToStaticMarkup(
    <NextIntlClientProvider
      locale="de"
      timeZone="UTC"
      messages={{
        nav: {
          sidebarHome: 'Home',
          sidebarAll: 'Alle',
          sidebarSwitchProject: 'Projekt wechseln',
          sidebarHomeAll: 'Home und alle Projekte',
        },
        newProject: { title: 'Neues Projekt' },
      }}
    >
      <SidebarProjectSwitcher
        projects={projects}
        currentProjectKey={null}
        onSelectProject={() => {}}
        onNewProject={() => {}}
      />
    </NextIntlClientProvider>,
  );
  assert.match(html, /Home/);
  assert.match(html, /Alle/);
  assert.doesNotMatch(html, /Marketing/);
});
