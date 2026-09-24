import { beforeEach, describe, expect, it } from 'bun:test';
import { auth } from '@repo/auth';
import { authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

// A new project's default data (states, issue types, views, its coordinator's display
// name) and a new team's default role are named in the language of the person they are
// made for: the language the request names, else their interface language, else their
// browser's, else English. State types and colors are the same in every language.

const ENGLISH_STATES = ['Backlog', 'Todo', 'In Progress', 'Review', 'Done', 'Canceled'];
const GERMAN_STATES = [
  'Backlog',
  'Zu erledigen',
  'In Arbeit',
  'In Prüfung',
  'Erledigt',
  'Abgebrochen',
];
const STATE_TYPES = ['backlog', 'unstarted', 'started', 'started', 'completed', 'canceled'];

async function signUp(headers?: Record<string, string>) {
  const user = await signUpTestUser();
  return { user, api: authedApi(user.cookie, headers) };
}

async function speak(api: Api, locale: 'de' | 'en' | 'fr') {
  expect((await api.account.preferences.patch({ locale })).status).toBe(200);
}

async function scaffold(api: Api, projectKey: string) {
  const project = (await api.projects({ projectKey }).get()).data!;
  const views = (await api.projects({ projectKey }).views.get()).data!;
  return {
    states: project.columns.map((column) => column.name),
    stateTypes: project.columns.map((column) => column.stateType),
    colors: project.columns.map((column) => column.color),
    types: project.issueTypes.map((type) => ({ name: type.name, isDefault: type.isDefault })),
    views: views.map((view) => view.name),
  };
}

async function coordinatorName(api: Api, teamId: number, projectId: number) {
  const agents = await api.teams({ teamId })['ai-agents'].get({ query: { projectId } });
  return agents.data!.find((agent) => agent.username.endsWith('-coordinator'))!.name;
}

describe('default names of new projects and teams', () => {
  beforeEach(resetDb);

  it('names everything in English for an account without a language', async () => {
    const { api } = await signUp();
    const created = await api.projects.post({ key: 'MKT', name: 'Marketing' });
    expect(created.status).toBe(201);

    const project = await scaffold(api, 'MKT');
    expect(project.states).toEqual(ENGLISH_STATES);
    expect(project.stateTypes).toEqual(STATE_TYPES);
    expect(project.types).toEqual([{ name: 'Task', isDefault: true }]);
    expect(project.views).toEqual(['Kanban', 'List']);
    expect(await coordinatorName(api, created.data!.teamId, created.data!.id)).toBe(
      'Hermes MKT Coordinator',
    );
  });

  it("names everything in the owner's interface language", async () => {
    const english = await signUp();
    await english.api.projects.post({ key: 'ENG', name: 'English' });
    const englishColors = (await scaffold(english.api, 'ENG')).colors;

    const { api } = await signUp();
    await speak(api, 'de');
    const created = await api.projects.post({ key: 'MKT', name: 'Marketing', preset: 'software' });
    expect(created.status).toBe(201);

    const project = await scaffold(api, 'MKT');
    expect(project.states).toEqual(GERMAN_STATES);
    expect(project.stateTypes).toEqual(STATE_TYPES);
    expect(project.colors).toEqual(englishColors);
    expect(project.types).toEqual([
      { name: 'Feature', isDefault: true },
      { name: 'Bug', isDefault: false },
      { name: 'Aufgabe', isDefault: false },
      { name: 'Technische Schulden', isDefault: false },
      { name: 'Recherche', isDefault: false },
    ]);
    expect(project.views).toEqual(['Board', 'Liste']);
    expect(await coordinatorName(api, created.data!.teamId, created.data!.id)).toBe(
      'Hermes-Koordinator MKT',
    );
  });

  it('uses the language the request names over the interface language', async () => {
    const { api } = await signUp();
    await speak(api, 'de');
    const created = await api.projects.post({ key: 'MKT', name: 'Marketing', locale: 'fr' });
    expect(created.status).toBe(201);

    const project = await scaffold(api, 'MKT');
    expect(project.states).toEqual([
      'Backlog',
      'À faire',
      'En cours',
      'En revue',
      'Terminé',
      'Annulé',
    ]);
    expect(project.types).toEqual([{ name: 'Tâche', isDefault: true }]);
  });

  it('refuses a language Helena does not ship', async () => {
    const { api } = await signUp();
    const created = await api.projects.post({
      key: 'MKT',
      name: 'Marketing',
      locale: 'xx' as 'de',
    });
    expect(created.status).toBe(400);
  });

  it('uses the browser language before the account chose one', async () => {
    const { api } = await signUp({ 'accept-language': 'de-DE,de;q=0.9,en;q=0.8' });
    expect((await api.projects.post({ key: 'MKT', name: 'Marketing' })).status).toBe(201);
    expect((await scaffold(api, 'MKT')).states).toEqual(GERMAN_STATES);
  });

  it('creates a project in a team the same way', async () => {
    const { api } = await signUp();
    await speak(api, 'de');
    const own = await api.projects.post({ key: 'OWN', name: 'Own' });
    const created = await api
      .teams({ teamId: own.data!.teamId })
      .projects.post({ key: 'TEAM', name: 'Team project', preset: 'support' });
    expect(created.status).toBe(201);
    expect((await scaffold(api, 'TEAM')).types.map((type) => type.name)).toEqual([
      'Störung',
      'Anfrage',
      'Frage',
      'Änderung',
    ]);
  });

  it('names the default states of a copy that does not copy them in the owner language', async () => {
    const { api } = await signUp();
    const source = await api.projects.post({ key: 'SRC', name: 'Source' });
    await speak(api, 'de');
    const copy = await api
      .teams({ teamId: source.data!.teamId })
      .projects({ projectId: source.data!.id })
      .copy.post({ key: 'CPY', name: 'Copy', include: { issueTypes: true } });
    expect(copy.status).toBe(201);

    const project = await scaffold(api, 'CPY');
    expect(project.states).toEqual(GERMAN_STATES);
    // The types are the source's own data, copied as they are.
    expect(project.types).toEqual([{ name: 'Task', isDefault: true }]);
    expect(project.views).toEqual(['Board', 'Liste']);
    expect(await coordinatorName(api, copy.data!.teamId, copy.data!.id)).toBe(
      'Hermes-Koordinator CPY',
    );
  });

  it('keeps copied English views as the default views of a German copy', async () => {
    const { api } = await signUp();
    await api.projects.post({ key: 'SRC', name: 'Source' });
    await speak(api, 'de');
    const copy = await api.projects({ projectKey: 'SRC' }).copy.post({ key: 'CPY', name: 'Copy' });
    expect(copy.status).toBe(201);

    const project = await scaffold(api, 'CPY');
    expect(project.states).toEqual(ENGLISH_STATES);
    expect(project.views).toEqual(['Kanban', 'List']);
  });

  it('does not add default views a German project already has', async () => {
    const { api } = await signUp();
    await speak(api, 'de');
    await api.projects.post({ key: 'MKT', name: 'Marketing' });

    const backfilled = await api.projects({ projectKey: 'MKT' }).views.defaults.post();
    expect(backfilled.status).toBe(200);
    expect((await scaffold(api, 'MKT')).views).toEqual(['Board', 'Liste']);
  });

  it("adds a missing default view in the project owner's language", async () => {
    const { api } = await signUp();
    await speak(api, 'de');
    await api.projects.post({ key: 'MKT', name: 'Marketing' });
    const views = (await api.projects({ projectKey: 'MKT' }).views.get()).data!;
    await api.views({ viewId: views.find((view) => view.name === 'Liste')!.id }).delete();

    await api.projects({ projectKey: 'MKT' }).views.defaults.post();
    expect((await scaffold(api, 'MKT')).views).toEqual(['Board', 'Liste']);
  });

  it('applies an English template to a German project without doubling its defaults', async () => {
    const { api } = await signUp();
    await api.projects.post({ key: 'SRC', name: 'Template source' });
    const source = (await api.projects({ projectKey: 'SRC' }).get()).data!;
    const done = source.columns.find((column) => column.name === 'Done')!;
    await api.projects({ projectKey: 'SRC' }).actions.post({
      name: 'Complete',
      effect: { columnId: done.id },
    });
    const template = await api
      .projects({ projectKey: 'SRC' })
      ['project-templates'].post({ kind: 'board', name: 'Delivery' });
    expect(template.status).toBe(201);

    await speak(api, 'de');
    const created = await api.projects.post({
      key: 'NEW',
      name: 'From template',
      templateId: template.data!.id,
    });
    expect(created.status).toBe(201);
    const project = await scaffold(api, 'NEW');
    expect(project.states).toEqual(GERMAN_STATES);
    expect(project.views).toEqual(['Board', 'Liste']);
    const erledigt = (await api.projects({ projectKey: 'NEW' }).get()).data!.columns.find(
      (column) => column.name === 'Erledigt',
    )!;
    expect((await api.projects({ projectKey: 'NEW' }).actions.get()).data).toMatchObject([
      { name: 'Complete', effect: { columnId: erledigt.id } },
    ]);
  });

  it("names a new team's default role in the owner's language", async () => {
    const { api } = await signUp();
    await speak(api, 'de');
    const team = await api.teams.post({ name: 'Familie' });
    expect(team.status).toBe(201);
    const roles = await api.teams({ teamId: team.data!.id }).roles.options.get();
    expect(roles.data).toEqual([expect.objectContaining({ name: 'Mitglied', isDefault: true })]);
  });

  it("names the default role of the account's own team in the browser language of the sign-up", async () => {
    const response = await auth.api.signUpEmail({
      body: { email: 'anna@example.com', password: 'test-password-123', name: 'Anna' },
      headers: new Headers({ 'accept-language': 'de-DE,de;q=0.9' }),
      asResponse: true,
    });
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    const api = authedApi(cookie);
    const created = await api.projects.post({ key: 'MKT', name: 'Marketing' });
    const roles = await api.teams({ teamId: created.data!.teamId }).roles.options.get();
    expect(roles.data).toEqual([expect.objectContaining({ name: 'Mitglied', isDefault: true })]);

    const english = await signUp();
    const theirs = await english.api.projects.post({ key: 'ENG', name: 'English' });
    const englishRoles = await english.api
      .teams({ teamId: theirs.data!.teamId })
      .roles.options.get();
    expect(englishRoles.data).toEqual([
      expect.objectContaining({ name: 'Member', isDefault: true }),
    ]);
  });
});
