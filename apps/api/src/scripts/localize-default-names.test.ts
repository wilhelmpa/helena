import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { localizeDefaultNames } from './localize-default-names';

// The one-time rename of the default data older versions created in English: only names
// that are still exactly the English default, in the owner's language, dry run first,
// and a second run renames nothing.

async function names(api: Api, projectKey: string) {
  const project = (await api.projects({ projectKey }).get()).data!;
  const views = (await api.projects({ projectKey }).views.get()).data!;
  const agents = await api
    .teams({ teamId: project.project.teamId })
    ['ai-agents'].get({ query: { projectId: project.project.id } });
  const roles = await api.teams({ teamId: project.project.teamId }).roles.options.get();
  return {
    states: project.columns.map((column) => column.name),
    types: project.issueTypes.map((type) => type.name),
    views: views.map((view) => view.name),
    labels: project.labels.map((entry) => entry.name),
    coordinator: agents.data!.find((agent) => agent.username.endsWith('-koordinator'))!.name,
    roles: roles.data!.map((role) => role.name),
  };
}

// An English project of an owner who then switched to German, with a state they renamed
// themselves and a type name the German default would clash with.
async function englishProject() {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  await api.projects.post({ key: 'MKT', name: 'Marketing', preset: 'software' });
  const project = (await api.projects({ projectKey: 'MKT' }).get()).data!;
  const done = project.columns.find((column) => column.name === 'Done')!;
  await api
    .projects({ projectKey: 'MKT' })
    .columns({ columnId: done.id })
    .patch({ name: 'Fertig' });
  await api
    .projects({ projectKey: 'MKT' })
    ['issue-types'].post({ name: 'Aufgabe', color: '#000000' });
  await api.projects({ projectKey: 'MKT' }).labels.post({ name: 'Blocked' });
  await api.account.preferences.patch({ locale: 'de' });
  return { owner, api };
}

describe('localize default names', () => {
  beforeEach(resetDb);

  it('prints the renames on a dry run and writes nothing', async () => {
    const { api } = await englishProject();
    const before = await names(api, 'MKT');
    const lines: string[] = [];

    const plan = await localizeDefaultNames({ log: (line) => lines.push(line) });

    expect(await names(api, 'MKT')).toEqual(before);
    expect(
      plan.filter((item) => !item.skipped).map((item) => [item.kind, item.from, item.to]),
    ).toEqual([
      ['state', 'Todo', 'Zu erledigen'],
      ['state', 'In Progress', 'In Arbeit'],
      ['state', 'Review', 'In Prüfung'],
      ['state', 'Canceled', 'Abgebrochen'],
      ['issueType', 'Tech debt', 'Technische Schulden'],
      ['issueType', 'Research', 'Recherche'],
      ['view', 'Kanban', 'Board'],
      ['view', 'List', 'Liste'],
      ['coordinator', 'Coordinator MKT', 'Koordinator MKT'],
      ['label', 'Blocked', 'Blockiert'],
      ['role', 'Member', 'Mitglied'],
    ]);
    expect(plan.filter((item) => item.skipped)).toMatchObject([
      { kind: 'issueType', from: 'Task', to: 'Aufgabe', skipped: 'name taken' },
    ]);
    expect(lines).toContain('would rename MKT state "Todo" → "Zu erledigen"');
    expect(lines.at(-1)).toBe('Would rename 11, skip 1. Run with --apply to write.');
  });

  it("renames what is still the English default into the owner's language, once", async () => {
    const { api } = await englishProject();
    const other = await signUpTestUser();
    const asOther = authedApi(other.cookie);
    await asOther.projects.post({ key: 'ENG', name: 'English' });
    const englishBefore = await names(asOther, 'ENG');

    await localizeDefaultNames({ apply: true, log: () => {} });

    expect(await names(api, 'MKT')).toEqual({
      states: ['Backlog', 'Zu erledigen', 'In Arbeit', 'In Prüfung', 'Fertig', 'Abgebrochen'],
      types: ['Feature', 'Bug', 'Task', 'Technische Schulden', 'Recherche', 'Aufgabe'],
      views: ['Board', 'Liste'],
      labels: ['Blockiert'],
      coordinator: 'Koordinator MKT',
      roles: ['Mitglied'],
    });
    // An owner who speaks English keeps the English names.
    expect(await names(asOther, 'ENG')).toEqual(englishBefore);
    // Nothing is left to rename but the clash.
    const again = await localizeDefaultNames({ apply: true, log: () => {} });
    expect(again.filter((item) => !item.skipped)).toEqual([]);
  });

  it('uses one language for everything and only the named projects when told to', async () => {
    const { api } = await englishProject();
    const other = await signUpTestUser();
    const asOther = authedApi(other.cookie);
    await asOther.projects.post({ key: 'ENG', name: 'English' });

    await localizeDefaultNames({ apply: true, locale: 'fr', projectKeys: ['ENG'], log: () => {} });

    expect((await names(asOther, 'ENG')).states).toEqual([
      'Backlog',
      'À faire',
      'En cours',
      'En revue',
      'Terminé',
      'Annulé',
    ]);
    expect((await names(asOther, 'ENG')).roles).toEqual(['Membre']);
    expect((await names(api, 'MKT')).states).toContain('Todo');
    expect((await names(api, 'MKT')).roles).toEqual(['Member']);
  });
});
