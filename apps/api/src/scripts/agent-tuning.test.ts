import { beforeEach, describe, expect, it } from 'bun:test';
import { aiAgent, db } from '@repo/db';
import { eq } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { getRunnerAgent } from '#modules/agents/runner/service';
import { runtimePolicySnapshot } from '#modules/agents/runtime-policy/service';
import { loadTuningState, runAgentTuning } from './agent-tuning';
import { sha256, type TuningTarget } from './agent-tuning/plan';

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
        reasoning: 'medium',
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

  it('sets reasoning on request', async () => {
    const { teamId, target } = await setup();
    await runAgentTuning({ teamId, target, apply: true, sections: ['reasoning'], log: quiet });
    const state = await loadTuningState(teamId);
    expect(state.agents.find((a) => a.username === 'coder-vol')!.reasoningEffort).toBe('medium');
  });

  it('leaves texts the owner wrote after the audit', async () => {
    const { api, teamId, agent, target } = await setup();
    await api
      .teams({ teamId })
      ['ai-agents']({ agentId: agent.id })
      .patch({ instructions: 'Vom Owner' });
    const plan = await runAgentTuning({ teamId, target, apply: true, log: quiet });
    expect(plan.skipped).toContain('@coder-vol: instructions changed since the audit; left as it is');
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
