import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

// "Pool erweitern" (Auftrag 117): an agent that works in a project becomes a template of
// the pool with its configuration; the agent itself stays where it is.
const agents = (api: Api, teamId: number) => api.teams({ teamId })['ai-agents'];
const skillsRoute = (api: Api, teamId: number) => api.teams({ teamId })['agent-skills'];

describe('save an agent as a template', () => {
  beforeEach(resetDb);

  it('adds a template with the agent’s configuration and keeps the agent', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const api = authedApi(owner.cookie);
    const project = (await api.projects.post({ key: 'VOL', name: 'Volition' })).data!;
    const teamId = project.teamId;
    const skill = (
      await skillsRoute(api, teamId).post({
        source: 'inline',
        markdown: '---\nname: Review\ndescription: Review skill\n---\n\nBody.',
      })
    ).data!;
    const agent = (
      await agents(api, teamId).post({
        name: 'Reviewer',
        username: 'reviewer',
        kind: 'external',
        instructions: 'Prüfe gründlich.',
        projectId: project.id,
      })
    ).data!.agent;
    await agents(api, teamId)({ agentId: agent.id }).skills.put({ skillIds: [skill.id] });

    const saved = await agents(api, teamId)({ agentId: agent.id })['save-as-template'].post({});
    expect(saved.status).toBe(201);
    const template = saved.data!.agent;
    expect(template.template).toBe(true);
    expect(template.username).toBe('reviewer-vorlage');
    expect(template.name).toBe('Reviewer');
    expect(template.instructions).toBe('Prüfe gründlich.');
    expect(template.projects).toEqual([]);
    const templateSkills = (await agents(api, teamId)({ agentId: template.id }).skills.get()).data!;
    expect(JSON.stringify(templateSkills)).toContain(`"id":${skill.id}`);
    expect(saved.data!.apiKey).toBeTruthy();

    // The agent stays in its project, not a template.
    const again = (await agents(api, teamId)({ agentId: agent.id }).get()).data!;
    expect(again.template).toBe(false);
    expect(again.projects.map((entry: { id: number }) => entry.id)).toEqual([project.id]);

    // A second template of the same agent gets the next free handle and its own name.
    const second = await agents(
      api,
      teamId,
    )({ agentId: agent.id })['save-as-template'].post({
      name: 'Prüfer',
    });
    expect(second.status).toBe(201);
    expect(second.data!.agent.username).toBe('reviewer-vorlage-2');
    expect(second.data!.agent.name).toBe('Prüfer');

    // A template is not saved as a template again.
    const refused = await agents(
      api,
      teamId,
    )({ agentId: template.id })['save-as-template'].post({});
    expect(refused.status).toBe(400);
  });
});
