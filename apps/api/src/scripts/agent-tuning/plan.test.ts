import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  auditState,
  formatPlan,
  nextPolicy,
  planTuning,
  sha256,
  textDecision,
  validateTarget,
  type AgentTarget,
  type CurrentAgent,
  type CurrentState,
  type Plan,
  type TuningTarget,
} from './plan';
import { DISABLED_BUNDLED_SKILLS, TARGET } from './target';

// The planning of the agent tuning: what it adds, what it replaces and what it leaves to the
// owner, and that a second run over the result has nothing left to do.

function agent(overrides: Partial<CurrentAgent> = {}): CurrentAgent {
  return {
    id: 1,
    username: 'coder-vol',
    template: false,
    runtime: 'hermes',
    instructions: 'old',
    soul: null,
    toolDeny: [],
    skillsDisabled: [],
    reasoningEffort: null,
    skills: [],
    projects: [{ id: 5, key: 'VOL', assignment: '' }],
    triggerOnMention: true,
    triggerOnAssign: true,
    inventory: null,
    status: 'online',
    drift: [],
    learnedSkills: 0,
    pendingMemoryProposals: 0,
    reflections: { total: 0, saved: 0, failed: 0 },
    ...overrides,
  };
}

function state(agents: CurrentAgent[], overrides: Partial<CurrentState> = {}): CurrentState {
  return {
    agents,
    projects: [{ id: 5, key: 'VOL', instructions: '' }],
    library: ['brainstorming', 'writing-plans', 'systematic-debugging', 'frontend-design'],
    ...overrides,
  };
}

function target(overrides: Partial<AgentTarget> = {}, projects = true): TuningTarget {
  return {
    projects: projects ? [{ key: 'VOL', instructions: { text: 'Projekt VOL', replaces: [] } }] : [],
    agents: [
      {
        username: 'coder-vol',
        addSkills: ['brainstorming', 'frontend-design'],
        denyToolsets: ['computer_use', 'tts'],
        disableSkills: ['obsidian'],
        instructions: { text: 'neu', replaces: [sha256('old')] },
        ...overrides,
      },
    ],
  };
}

// The state as the services leave it after the plan, for the second run.
function applied(current: CurrentState, plan: Plan): CurrentState {
  const next = structuredClone(current);
  for (const change of plan.changes) {
    if (change.kind === 'projectInstructions') {
      next.projects.find((p) => p.id === change.projectId)!.instructions = change.to;
      continue;
    }
    const row = next.agents.find((a) => a.id === change.agentId)!;
    if (change.kind === 'skills') {
      const removed = new Set(change.remove.map((r) => r.name));
      row.skills = [...row.skills.filter((n) => !removed.has(n)), ...change.add];
    } else if (change.kind === 'toolDeny') row.toolDeny.push(...change.add);
    else if (change.kind === 'skillsDisabled') row.skillsDisabled.push(...change.add);
    else if (change.kind === 'instructions') row.instructions = change.to;
    else if (change.kind === 'soul') row.soul = change.to;
    else if (change.kind === 'reasoning') row.reasoningEffort = change.to;
    else if (change.kind === 'assignment') {
      row.projects.find((p) => p.id === change.projectId)!.assignment = change.to;
    }
  }
  return next;
}

describe('textDecision', () => {
  it('replaces an empty field or the audited text, and leaves any other text alone', () => {
    const text = { text: 'neu', replaces: [sha256('alt')] };
    expect(textDecision(null, text)).toBe('replace');
    expect(textDecision('  ', text)).toBe('replace');
    expect(textDecision('alt', text)).toBe('replace');
    expect(textDecision('neu\n', text)).toBe('same');
    expect(textDecision('vom Owner', text)).toBe('owned');
  });
});

describe('planTuning', () => {
  it('adds what is missing and replaces the audited instructions', () => {
    const plan = planTuning(state([agent()]), target());
    expect(plan.changes).toEqual([
      {
        kind: 'skills',
        agentId: 1,
        username: 'coder-vol',
        add: ['brainstorming', 'frontend-design'],
        remove: [],
      },
      { kind: 'toolDeny', agentId: 1, username: 'coder-vol', add: ['computer_use', 'tts'] },
      { kind: 'skillsDisabled', agentId: 1, username: 'coder-vol', add: ['obsidian'] },
      { kind: 'instructions', agentId: 1, username: 'coder-vol', from: 'old', to: 'neu' },
      {
        kind: 'projectInstructions',
        projectId: 5,
        projectKey: 'VOL',
        from: '',
        to: 'Projekt VOL',
      },
    ]);
  });

  it('has nothing left to do on a second run', () => {
    const first = state([agent({ skills: ['writing-plans'], toolDeny: ['browser'] })]);
    const plan = planTuning(first, target());
    expect(plan.changes.length).toBeGreaterThan(0);
    const second = planTuning(applied(first, plan), target());
    expect(second.changes).toEqual([]);
  });

  it('keeps what the owner added: skills, denied toolsets and disabled skills stay', () => {
    const plan = planTuning(
      state([agent({ skills: ['writing-plans'], toolDeny: ['browser'], skillsDisabled: ['x'] })]),
      target(),
    );
    const skills = plan.changes.find((c) => c.kind === 'skills');
    expect(skills?.kind === 'skills' && skills.remove).toEqual([]);
    const next = applied(state([agent({ skills: ['writing-plans'] })]), plan);
    expect(next.agents[0]!.skills).toContain('writing-plans');
  });

  it('leaves instructions the owner changed since the audit, and says so', () => {
    const plan = planTuning(state([agent({ instructions: 'mein eigener Text' })]), target());
    expect(plan.changes.some((c) => c.kind === 'instructions')).toBe(false);
    expect(plan.skipped).toContain('@coder-vol: instructions changed since the audit; left as it is');
  });

  it('leaves project instructions the owner wrote', () => {
    const plan = planTuning(
      state([agent()], { projects: [{ id: 5, key: 'VOL', instructions: 'vom Owner' }] }),
      target(),
    );
    expect(plan.changes.some((c) => c.kind === 'projectInstructions')).toBe(false);
    expect(plan.skipped.some((line) => line.startsWith('VOL: project instructions'))).toBe(true);
  });

  it('never links a skill whose name a Hermes-bundled skill already has, and unlinks one', () => {
    const inventory = {
      skills: [
        { name: 'systematic-debugging', origin: 'bundled' as const },
        { name: 'systematic-debugging', origin: 'plan' as const },
        { name: 'brainstorming', origin: 'bundled' as const },
      ],
      memory: [],
    };
    const plan = planTuning(
      state([agent({ skills: ['systematic-debugging'], inventory })]),
      target(),
    );
    const skills = plan.changes.find((c) => c.kind === 'skills');
    expect(skills).toEqual({
      kind: 'skills',
      agentId: 1,
      username: 'coder-vol',
      add: ['frontend-design'],
      remove: [{ name: 'systematic-debugging', why: 'bundled-duplicate' }],
    });
    expect(plan.skipped.some((line) => line.includes('brainstorming ships with Hermes'))).toBe(
      true,
    );
  });

  it('skips a skill the library does not have', () => {
    const plan = planTuning(state([agent()]), target({ addSkills: ['nicht-da'] }));
    expect(plan.changes.some((c) => c.kind === 'skills')).toBe(false);
    expect(plan.skipped).toContain('@coder-vol: skill nicht-da is not in the library');
  });

  it('never turns off the name of a skill the agent has from the library', () => {
    const plan = planTuning(
      state([agent({ skills: ['obsidian'] })], { library: ['obsidian'] }),
      target({ addSkills: [] }),
    );
    expect(plan.changes.some((c) => c.kind === 'skillsDisabled')).toBe(false);
    expect(plan.skipped).toContain(
      "@coder-vol: obsidian stays on, it is one of the agent's own skills",
    );
  });

  it('touches no template, no Claude Code or Codex agent and no missing agent', () => {
    for (const current of [agent({ template: true }), agent({ runtime: 'claude' })]) {
      const plan = planTuning(state([current]), target({}, false));
      expect(plan.changes).toEqual([]);
      expect(plan.skipped).toHaveLength(1);
    }
    const plan = planTuning(state([]), target({}, false));
    expect(plan.skipped).toEqual(['@coder-vol: no such agent in this team']);
  });

  it('sets reasoning only on request and only where the agent has none of its own', () => {
    const wanted = target({ reasoning: 'medium' }, false);
    expect(planTuning(state([agent()]), wanted).changes.some((c) => c.kind === 'reasoning')).toBe(
      false,
    );
    const plan = planTuning(state([agent()]), wanted, ['reasoning']);
    expect(plan.changes).toEqual([
      { kind: 'reasoning', agentId: 1, username: 'coder-vol', from: null, to: 'medium' },
    ]);
    const own = planTuning(state([agent({ reasoningEffort: 'high' })]), wanted, ['reasoning']);
    expect(own.changes).toEqual([]);
    expect(own.skipped).toEqual(['@coder-vol: reasoning high was set by hand; left as it is']);
  });

  it('writes an assignment only in a project the agent works in', () => {
    const assignments = { VOL: { text: 'Deine Rolle', replaces: [] }, FAM: { text: 'x', replaces: [] } };
    const plan = planTuning(state([agent()]), target({ assignments }, false), ['projects']);
    expect(plan.changes).toEqual([
      {
        kind: 'assignment',
        agentId: 1,
        username: 'coder-vol',
        projectId: 5,
        projectKey: 'VOL',
        from: '',
        to: 'Deine Rolle',
      },
    ]);
    expect(plan.skipped).toEqual(['@coder-vol: not in project FAM, no assignment']);
  });

  it('only plans the sections it is given', () => {
    const plan = planTuning(state([agent()]), target(), ['tools']);
    expect(plan.changes.map((c) => c.kind)).toEqual(['toolDeny', 'skillsDisabled']);
  });

  it('refuses a target that adds and disables the same skill', () => {
    expect(() =>
      planTuning(state([agent()]), target({ disableSkills: ['brainstorming'] })),
    ).toThrow('brainstorming is added and disabled');
  });
});

describe('nextPolicy', () => {
  const policy = {
    reasoningEffort: null,
    toolAllow: [],
    toolDeny: ['browser'],
    mcpGrants: ['itsaplan'],
    files: [{ kind: 'instructions' as const, path: 'instructions/extra.md', content: 'x' }],
    maxTurns: 40,
  };

  it('merges the changes and keeps every other field', () => {
    const next = nextPolicy(policy, [
      { kind: 'toolDeny', agentId: 1, username: 'a', add: ['tts', 'browser'] },
      { kind: 'skillsDisabled', agentId: 1, username: 'a', add: ['obsidian'] },
      { kind: 'soul', agentId: 1, username: 'a', from: '', to: 'Ich bin Home.' },
      { kind: 'reasoning', agentId: 1, username: 'a', from: null, to: 'medium' },
    ]);
    expect(next).toEqual({
      reasoningEffort: 'medium',
      toolAllow: [],
      toolDeny: ['browser', 'tts'],
      mcpGrants: ['itsaplan'],
      skillsDisabled: ['obsidian'],
      files: [
        { kind: 'instructions', path: 'SOUL.md', content: 'Ich bin Home.' },
        { kind: 'instructions', path: 'instructions/extra.md', content: 'x' },
      ],
      maxTurns: 40,
    });
  });

  it('is null when nothing in the policy changes', () => {
    expect(
      nextPolicy(policy, [
        { kind: 'instructions', agentId: 1, username: 'a', from: '', to: 'x' },
      ]),
    ).toBeNull();
  });
});

describe('auditState', () => {
  it('names drift, skills Hermes cannot tell apart, missing skills and full memory', () => {
    const lines = auditState(
      state([
        agent({
          skills: ['systematic-debugging', 'writing-plans'],
          drift: [{ key: 'mcp_servers.x', code: 'mcp-missing' }],
          pendingMemoryProposals: 2,
          inventory: {
            skills: [{ name: 'systematic-debugging', origin: 'bundled' }],
            memory: [{ file: 'MEMORY.md', chars: 2000 }],
          },
        }),
        agent({
          id: 33,
          username: 'codex-test',
          runtime: 'codex',
          triggerOnMention: false,
          triggerOnAssign: false,
        }),
      ]),
    );
    expect(lines[0]).toContain('drift mcp_servers.x: mcp-missing');
    expect(lines[0]).toContain('linked but not in the profile: writing-plans');
    expect(lines[0]).toContain('same name as a Hermes skill (skill_view refuses both): systematic-debugging');
    expect(lines[0]).toContain('MEMORY.md 2000/2200 chars (91 %)');
    expect(lines[0]).toContain('MEMORY.md is nearly full');
    expect(lines[0]).toContain('2 memory write(s) wait for the owner');
    expect(lines[1]).toContain('starts on no mention or assignment, yet works in VOL');
  });
});

describe('formatPlan', () => {
  it('shows a replaced text in full, with what it replaces', () => {
    const lines = formatPlan(planTuning(state([agent()]), target({}, false), ['instructions']));
    expect(lines).toEqual([
      '@coder-vol: instructions',
      '    was (3 chars):',
      '      old',
      '    becomes (3 chars):',
      '      neu',
    ]);
  });
});

describe('the target of this installation', () => {
  // The skill library a team gets from the pool bundle: its GitHub skills and file skills.
  const bundle = join(import.meta.dir, '..', '..', '..', '..', '..', 'bundles', 'agent-pool');
  const pool = new Set([
    ...(
      JSON.parse(readFileSync(join(bundle, 'helena.bundle.json'), 'utf8')) as {
        skills: { name: string }[];
      }
    ).skills.map((skill) => skill.name),
    ...readdirSync(join(bundle, 'skills')),
  ]);

  it('is valid', () => {
    expect(validateTarget(TARGET)).toEqual([]);
  });

  it('names only skills of the pool', () => {
    const unknown = TARGET.agents.flatMap((a) => a.addSkills).filter((name) => !pool.has(name));
    expect(unknown).toEqual([]);
  });

  it('never turns off a skill of the pool', () => {
    expect(DISABLED_BUNDLED_SKILLS.filter((name) => pool.has(name))).toEqual([]);
  });

  it('writes German texts without the old product names', () => {
    const texts = [
      ...TARGET.projects.map((p) => p.instructions.text),
      ...TARGET.agents.flatMap((a) => [
        a.instructions?.text ?? '',
        a.soul?.text ?? '',
        ...Object.values(a.assignments ?? {}).map((t) => t.text),
      ]),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/\bPlan\b|It's a Plan|Itsaplan/);
    }
  });
});
