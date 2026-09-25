import { beforeEach, describe, expect, it } from 'bun:test';
import { agentSkill, aiAgent, db } from '@repo/db';
import { eq } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { getRunnerAgent } from '#modules/agents/runner/service';
import { runtimePolicySnapshot } from '#modules/agents/runtime-policy/service';
import { loadTuningState, runAgentTuning } from './agent-tuning';
import { sha256, type TeamText, type TuningTarget } from './agent-tuning/plan';

// The agent tuning end to end: a dry run writes nothing, --apply writes through Helena's
// services, the SOUL.md the runner gets carries the result, and a second run has nothing
// left to do.

const quiet = () => {};

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const api = authedApi(owner.cookie);
  const project = (await api.projects.post({ key: 'VOL', name: 'volition.one' })).data!;
  const teamId = project.teamId;
  for (const name of ['writing-plans', 'frontend-design']) {
    await api.teams({ teamId })['agent-skills'].post({
      source: 'inline',
      markdown: `---\nname: ${name}\ndescription: ${name}\n---\n\n# ${name}`,
    });
  }
  const created = await createAgent(api, 'VOL', {
    name: 'Coder VOL',
    username: 'coder-vol',
    kind: 'external',
    instructions: 'Alter Text',
  });
  const agent = created.data!.agent;
  const target: TuningTarget = {
    projects: [{ key: 'VOL', instructions: { text: 'Arbeitsordner: /srv/…/vol', replaces: [] } }],
    agents: [
      {
        username: 'coder-vol',
        addSkills: ['writing-plans', 'frontend-design', 'fehlt'],
        denyToolsets: ['computer_use', 'tts'],
        disableSkills: ['obsidian', 'himalaya'],
        instructions: { text: 'Neuer Text', replaces: [sha256('Alter Text')] },
        soul: { text: 'Du bist Coder VOL.', replaces: [] },
        model: 'gpt-6-sol',
        reasoning: 'medium',
        projectBrowser: true,
        assignments: { VOL: { text: 'Du entwickelst die Website.', replaces: [] } },
      },
    ],
  };
  return { api, teamId, project, agent, target };
}

describe('agent tuning', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('writes nothing in a dry run', async () => {
    const { teamId, agent, target } = await setup();
    const before = await loadTuningState(teamId);
    const plan = await runAgentTuning({ teamId, target, log: quiet });
    expect(plan.changes.map((c) => c.kind)).toEqual([
      'skills',
      'toolDeny',
      'skillsDisabled',
      'instructions',
      'soul',
      'assignment',
      'projectInstructions',
    ]);
    expect(plan.skipped).toContain('@coder-vol: skill fehlt is not in the library');
    expect(await loadTuningState(teamId)).toEqual(before);
    const [row] = await db.select().from(aiAgent).where(eq(aiAgent.id, agent.id));
    expect(row!.instructions).toBe('Alter Text');
  });

  it('applies through the services, reaches the SOUL.md, and a second run changes nothing', async () => {
    const { teamId, agent, target } = await setup();
    await runAgentTuning({ teamId, target, apply: true, log: quiet });

    const state = await loadTuningState(teamId);
    const tuned = state.agents.find((a) => a.username === 'coder-vol')!;
    expect(tuned.skills.sort()).toEqual(['frontend-design', 'writing-plans']);
    expect(tuned.toolDeny).toEqual(['computer_use', 'tts']);
    expect(tuned.skillsDisabled).toEqual(['obsidian', 'himalaya']);
    expect(tuned.instructions).toBe('Neuer Text');
    expect(tuned.soul).toBe('Du bist Coder VOL.');
    // Reasoning is the owner's call: not among the default sections.
    expect(tuned.reasoningEffort).toBeNull();
    expect(tuned.projects.find((p) => p.key === 'VOL')!.assignment).toBe(
      'Du entwickelst die Website.',
    );
    expect(state.projects.find((p) => p.key === 'VOL')!.instructions).toBe(
      'Arbeitsordner: /srv/…/vol',
    );

    // What the agent's runner receives: the new texts in its SOUL.md, its skills, and the
    // Hermes settings.
    const ref = (await getRunnerAgent(agent.userId))!;
    const snapshot = await runtimePolicySnapshot(ref);
    const soul = snapshot.runtimePolicy.files[0]!.content;
    expect(soul.startsWith('Du bist Coder VOL.')).toBe(true);
    expect(soul).toContain('## Instructions\n\nNeuer Text');
    expect(soul).toContain('### Project-wide instructions\nArbeitsordner: /srv/…/vol');
    expect(soul).toContain('### Your assignment in this project\nDu entwickelst die Website.');
    expect(snapshot.skills.map((s) => s.name).sort()).toEqual(['frontend-design', 'writing-plans']);
    expect(snapshot.hermes.skillsDisabled).toEqual(['obsidian', 'himalaya']);
    expect(snapshot.runtimePolicy.toolDeny).toEqual(['computer_use', 'tts']);

    const again = await runAgentTuning({ teamId, target, apply: true, log: quiet });
    expect(again.changes).toEqual([]);
  });

  it('sets model, reasoning and the project browser on request', async () => {
    const { teamId, agent, target } = await setup();
    await runAgentTuning({
      teamId,
      target,
      apply: true,
      sections: ['reasoning', 'browser'],
      log: quiet,
    });
    const state = await loadTuningState(teamId);
    const tuned = state.agents.find((a) => a.username === 'coder-vol')!;
    expect(tuned).toMatchObject({
      model: 'gpt-6-sol',
      reasoningEffort: 'medium',
      browser: 'gateway',
    });
    const snapshot = await runtimePolicySnapshot((await getRunnerAgent(agent.userId))!);
    expect(snapshot.model).toBe('gpt-6-sol');
    expect(snapshot.mcpServers.map((s) => s.name)).toContain('projekt-browser');
    const again = await runAgentTuning({
      teamId,
      target,
      sections: ['reasoning', 'browser'],
      log: quiet,
    });
    expect(again.changes).toEqual([]);
  });

  it('creates a pool copy through Helena, tunes it and names it to its coordinator', async () => {
    const { api, teamId } = await setup();
    const template = (
      await api.teams({ teamId })['ai-agents'].post({
        name: 'QA-Tester',
        username: 'qa',
        kind: 'external',
        template: true,
        instructions: 'Du bist QA-Tester.',
        model: 'gpt-5.6-terra',
        triggerOnMention: true,
        triggerOnAssign: true,
        runtimePolicy: {
          reasoningEffort: 'medium',
          toolAllow: [],
          toolDeny: ['computer_use'],
          mcpGrants: [],
          files: [],
        },
      })
    ).data!.agent;
    const [skill] = await db.select().from(agentSkill).where(eq(agentSkill.name, 'writing-plans'));
    await api
      .teams({ teamId })
      ['ai-agents']({ agentId: template.id })
      .skills.put({ skillIds: [skill!.id] });
    const before = await loadTuningState(teamId);
    const coordinator = before.projects.find((p) => p.key === 'VOL')!.coordinator!;
    const created = before.agents.find((a) => a.username === coordinator)!.instructions ?? '';
    const team: TeamText = {
      project: 'VOL',
      candidates: ['coder-vol', 'qa-vol'],
      render: (present) => `Delegiere an: ${present.map((name) => `@${name}`).join(', ')}`,
      replaces: [sha256(created)],
    };
    const target: TuningTarget = {
      projects: [],
      templates: [{ username: 'qa', denyToolsets: ['computer_use', 'tts'] }],
      departments: [{ name: 'Entwicklung', parent: null, description: 'Bereich dev/' }],
      agents: [
        {
          username: coordinator,
          addSkills: [],
          denyToolsets: [],
          disableSkills: [],
          instructions: team,
        },
        {
          username: 'qa-vol',
          copyOf: { template: 'qa', projectKey: 'VOL' },
          addSkills: [],
          denyToolsets: ['computer_use', 'tts'],
          disableSkills: ['obsidian'],
          projectBrowser: true,
          triggers: { mention: true, assign: true },
          name: 'Tests VOL',
          org: { department: 'Entwicklung', role: 'reviewer' },
          assignments: { VOL: { text: 'Du testest die Website.', replaces: [] } },
        },
      ],
    };
    const sections = ['tools', 'instructions', 'projects', 'copies', 'browser'] as const;

    const dry = await runAgentTuning({ teamId, target, sections: [...sections], log: quiet });
    expect(dry.changes.map((c) => c.kind)).toEqual([
      'templateToolDeny',
      'department',
      'copy',
      'instructions',
      'skillsDisabled',
      'assignment',
      'name',
      'org',
      'browser',
    ]);
    expect((await loadTuningState(teamId)).agents.some((a) => a.username === 'qa-vol')).toBe(false);

    await runAgentTuning({ teamId, target, sections: [...sections], apply: true, log: quiet });
    const state = await loadTuningState(teamId);
    const copy = state.agents.find((a) => a.username === 'qa-vol')!;
    expect(copy).toMatchObject({
      template: false,
      copyOf: 'qa',
      model: 'gpt-5.6-terra',
      reasoningEffort: 'medium',
      skills: ['writing-plans'],
      toolDeny: ['computer_use', 'tts'],
      skillsDisabled: ['obsidian'],
      browser: 'gateway',
      name: 'Tests VOL',
      role: 'reviewer',
      department: 'Entwicklung',
      manager: coordinator,
      triggerOnMention: true,
      triggerOnAssign: true,
    });
    expect(copy.projects).toEqual([
      expect.objectContaining({ key: 'VOL', assignment: 'Du testest die Website.' }),
    ]);
    expect(state.agents.find((a) => a.username === coordinator)!.instructions).toBe(
      'Delegiere an: @coder-vol, @qa-vol',
    );
    // Only the project browser is the copy's own choice; its toolsets, skills and model still
    // follow the template.
    const [row] = await db.select().from(aiAgent).where(eq(aiAgent.id, copy.id));
    expect(row!.templateOverrides).toEqual(['mcpServers']);

    const again = await runAgentTuning({ teamId, target, sections: [...sections], log: quiet });
    expect(again.changes).toEqual([]);
  });

  it('leaves texts the owner wrote after the audit', async () => {
    const { api, teamId, agent, target } = await setup();
    await api
      .teams({ teamId })
      ['ai-agents']({ agentId: agent.id })
      .patch({ instructions: 'Vom Owner' });
    const plan = await runAgentTuning({ teamId, target, apply: true, log: quiet });
    expect(plan.skipped).toContain(
      '@coder-vol: instructions changed since the audit; left as it is',
    );
    const [row] = await db.select().from(aiAgent).where(eq(aiAgent.id, agent.id));
    expect(row!.instructions).toBe('Vom Owner');
  });

  it('limited to some agents, leaves the project instructions alone', async () => {
    const { teamId, target } = await setup();
    await runAgentTuning({ teamId, target, apply: true, agents: ['coder-vol'], log: quiet });
    const state = await loadTuningState(teamId);
    expect(state.projects.find((p) => p.key === 'VOL')!.instructions).toBe('');
    expect(state.agents.find((a) => a.username === 'coder-vol')!.instructions).toBe('Neuer Text');
  });
});
