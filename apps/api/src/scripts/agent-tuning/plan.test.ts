import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  auditState,
  copyHandle,
  formatPlan,
  nextPolicy,
  planTuning,
  projectState,
  resolveText,
  sha256,
  textDecision,
  validateTarget,
  type AgentTarget,
  type CurrentAgent,
  type CurrentState,
  type PolicyLike,
  type TeamText,
  type TuningTarget,
} from './plan';
import { COPIES, DISABLED_BUNDLED_SKILLS, TARGET, TEMPLATES } from './target';
import { POOL_COPIES } from '../../../../../deployment/volition-stack/scripts/setup-agent-pool.copies';

// The planning of the agent tuning: what it adds, what it replaces and what it leaves to the
// owner, and that a second run over the result has nothing left to do.

function agent(overrides: Partial<CurrentAgent> = {}): CurrentAgent {
  return {
    id: 1,
    username: 'coder-vol',
    name: 'Coder VOL',
    template: false,
    copyOf: null,
    runtime: 'hermes',
    model: null,
    instructions: 'old',
    soul: null,
    toolDeny: [],
    skillsDisabled: [],
    reasoningEffort: null,
    skills: [],
    browser: 'none',
    projects: [{ id: 5, key: 'VOL', assignment: '' }],
    role: 'specialist',
    manager: 'vol-koordinator',
    department: null,
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
    projects: [{ id: 5, key: 'VOL', instructions: '', coordinator: 'vol-koordinator' }],
    library: ['brainstorming', 'writing-plans', 'systematic-debugging', 'frontend-design'],
    unavailableModels: [],
    departments: [{ id: 1, name: 'Volition', parent: null }],
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
    const second = planTuning(projectState(first, plan.changes), target());
    expect(second.changes).toEqual([]);
  });

  it('keeps what the owner added: skills, denied toolsets and disabled skills stay', () => {
    const plan = planTuning(
      state([agent({ skills: ['writing-plans'], toolDeny: ['browser'], skillsDisabled: ['x'] })]),
      target(),
    );
    const skills = plan.changes.find((c) => c.kind === 'skills');
    expect(skills?.kind === 'skills' && skills.remove).toEqual([]);
    const next = projectState(state([agent({ skills: ['writing-plans'] })]), plan.changes);
    expect(next.agents[0]!.skills).toContain('writing-plans');
  });

  it('leaves instructions the owner changed since the audit, and says so', () => {
    const plan = planTuning(state([agent({ instructions: 'mein eigener Text' })]), target());
    expect(plan.changes.some((c) => c.kind === 'instructions')).toBe(false);
    expect(plan.skipped).toContain(
      '@coder-vol: instructions changed since the audit; left as it is',
    );
  });

  it('leaves project instructions the owner wrote', () => {
    const plan = planTuning(
      state([agent()], {
        projects: [{ id: 5, key: 'VOL', instructions: 'vom Owner', coordinator: null }],
      }),
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
    const assignments = {
      VOL: { text: 'Deine Rolle', replaces: [] },
      FAM: { text: 'x', replaces: [] },
    };
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

// A pool template and the project it is copied into.
function withTemplate(overrides: Partial<CurrentAgent> = {}): CurrentState {
  return state([
    agent({
      id: 21,
      username: 'qa',
      template: true,
      role: null,
      manager: null,
      projects: [],
      model: 'gpt-5.6-terra',
      reasoningEffort: 'medium',
      instructions: 'Du bist QA-Tester.',
      skills: ['systematic-debugging'],
      toolDeny: ['computer_use'],
      ...overrides,
    }),
    agent({
      id: 6,
      username: 'vol-koordinator',
      role: 'coordinator',
      manager: 'master',
      instructions: 'alt',
    }),
  ]);
}

function copyTarget(): TuningTarget {
  const team: TeamText = {
    project: 'VOL',
    candidates: ['coder-vol', 'qa-vol'],
    render: (present) => `Team: ${present.join(', ') || 'keins'}`,
    replaces: [sha256('alt')],
  };
  return {
    projects: [],
    templates: [{ username: 'qa', denyToolsets: ['computer_use', 'tts'] }],
    agents: [
      {
        username: 'vol-koordinator',
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
        assignments: { VOL: { text: 'Du testest die Website.', replaces: [] } },
      },
    ],
  };
}

const ALL: Parameters<typeof planTuning>[2] = [
  'skills',
  'tools',
  'instructions',
  'projects',
  'copies',
  'browser',
  'reasoning',
];

describe('copies', () => {
  it('creates a missing copy and tunes it in the same plan, after its template', () => {
    const plan = planTuning(withTemplate(), copyTarget(), ALL);
    expect(plan.changes.map((c) => `${c.kind} ${'username' in c ? c.username : ''}`)).toEqual([
      'templateToolDeny qa',
      'copy qa-vol',
      'instructions vol-koordinator',
      'skillsDisabled qa-vol',
      'assignment qa-vol',
      'browser qa-vol',
    ]);
    const copy = plan.changes.find((c) => c.kind === 'copy');
    expect(copy).toMatchObject({ projectKey: 'VOL', model: 'gpt-5.6-terra', modelRefused: false });
    // The coordinator's text names the copy the same run creates.
    const text = plan.changes.find((c) => c.kind === 'instructions');
    expect(text?.kind === 'instructions' && text.to).toBe('Team: qa-vol');
    // The toolsets reach the copy through its template, so the copy keeps following it.
    expect(plan.changes.some((c) => c.kind === 'toolDeny')).toBe(false);
  });

  it('has nothing left to do once the copy exists', () => {
    const first = withTemplate();
    const plan = planTuning(first, copyTarget(), ALL);
    const done = projectState(first, plan.changes);
    const created = done.agents.find((a) => a.username === 'qa-vol')!;
    expect(created).toMatchObject({
      template: false,
      copyOf: 'qa',
      model: 'gpt-5.6-terra',
      reasoningEffort: 'medium',
      skills: ['systematic-debugging'],
      toolDeny: ['computer_use', 'tts'],
      role: 'specialist',
      manager: 'vol-koordinator',
      browser: 'gateway',
    });
    expect(planTuning(done, copyTarget(), ALL).changes).toEqual([]);
  });

  it('gives a copy the runtime default when the provider refused the template model', () => {
    const current = withTemplate();
    current.unavailableModels = ['gpt-5.6-terra'];
    const copy = planTuning(current, copyTarget(), ALL).changes.find((c) => c.kind === 'copy');
    expect(copy).toMatchObject({ model: null, modelRefused: true });
    const done = projectState(current, [copy!]);
    expect(done.agents.find((a) => a.username === 'qa-vol')).toMatchObject({
      model: null,
      reasoningEffort: null,
    });
  });

  it('creates nothing without the section, and says the copy is missing', () => {
    const plan = planTuning(withTemplate(), copyTarget());
    expect(plan.changes.some((c) => c.kind === 'copy')).toBe(false);
    expect(plan.skipped).toContain('@qa-vol: not created yet (section copies)');
  });

  it('leaves an agent of the copy handle that is not that copy alone', () => {
    const current = withTemplate();
    current.agents.push(agent({ id: 40, username: 'qa-vol', copyOf: null }));
    const plan = planTuning(current, copyTarget(), ['copies']);
    expect(plan.changes).toEqual([]);
    expect(plan.skipped).toContain(
      '@qa-vol: exists, but not as the copy of @qa in VOL; left as it is',
    );
  });

  it('sets the triggers of a copy whose template starts on nothing', () => {
    const plan = planTuning(
      withTemplate({ triggerOnMention: false, triggerOnAssign: false }),
      copyTarget(),
      ['copies'],
    );
    expect(plan.changes.find((c) => c.kind === 'triggers')).toMatchObject({
      username: 'qa-vol',
      mention: true,
      assign: true,
    });
  });
});

describe('organisation', () => {
  function orgTarget(): TuningTarget {
    return {
      projects: [],
      departments: [
        { name: 'Verve · Support', parent: 'Volition', description: 'Bereich support/' },
        { name: 'Nirgends', parent: 'Fehlt', description: '' },
      ],
      agents: [
        {
          username: 'coder-vol',
          addSkills: [],
          denyToolsets: [],
          disableSkills: [],
          name: 'Support VOL',
          org: { department: 'Verve · Support', role: 'reviewer', reportsTo: 'master' },
          instructions: { text: 'Du bist der Support.', replaces: [], overTemplate: true },
        },
      ],
    };
  }

  function copied(overrides: Partial<CurrentAgent> = {}): CurrentState {
    const current = withTemplate({
      username: 'assistant',
      name: 'Assistent',
      instructions: 'Privat',
    });
    current.agents.push(
      agent({
        id: 1,
        copyOf: 'assistant',
        name: 'Assistent VOL',
        instructions: 'Privat',
        manager: null,
        ...overrides,
      }),
      agent({ id: 2, username: 'master', role: null, manager: null }),
    );
    return current;
  }

  it('creates a missing department below its parent, and places the agent in it', () => {
    const plan = planTuning(copied(), orgTarget(), ['instructions', 'copies']);
    expect(plan.changes).toEqual([
      {
        kind: 'department',
        name: 'Verve · Support',
        parent: 'Volition',
        description: 'Bereich support/',
      },
      {
        kind: 'instructions',
        agentId: 1,
        username: 'coder-vol',
        from: 'Privat',
        to: 'Du bist der Support.',
      },
      { kind: 'name', agentId: 1, username: 'coder-vol', from: 'Assistent VOL', to: 'Support VOL' },
      {
        kind: 'org',
        agentId: 1,
        username: 'coder-vol',
        department: { from: null, to: 'Verve · Support' },
        role: { from: 'specialist', to: 'reviewer' },
        reportsTo: { from: null, to: 'master' },
      },
    ]);
    expect(plan.skipped).toContain('department "Nirgends": no parent department "Fehlt"');
    const done = projectState(copied(), plan.changes);
    expect(planTuning(done, orgTarget(), ['instructions', 'copies']).changes).toEqual([]);
  });

  it('leaves what the owner chose: a renamed copy, its own text, department, role, manager', () => {
    const current = copied({
      name: 'Mein Support',
      instructions: 'Eigener Text',
      department: 'Volition',
      role: 'coordinator',
      manager: 'vol-koordinator',
    });
    const plan = planTuning(current, orgTarget(), ['instructions', 'copies']);
    expect(plan.changes.map((c) => c.kind)).toEqual(['department']);
    expect(plan.skipped).toEqual(
      expect.arrayContaining([
        '@coder-vol: instructions changed since the audit; left as it is',
        '@coder-vol: named "Mein Support" by hand; left as it is',
        '@coder-vol: in department "Volition" by hand; left as it is',
        '@coder-vol: agent-team role coordinator by hand; left as it is',
        '@coder-vol: reports to @vol-koordinator by hand; left as it is',
      ]),
    );
  });
});

describe('team texts', () => {
  const team: TeamText = {
    project: 'VOL',
    candidates: ['a', 'b', 'c'],
    render: (present) => `Team ${present.join('+')}`,
    replaces: ['x'],
  };

  it('names the candidates that work in the project, and owns every other set', () => {
    const current = state([
      agent({ username: 'a' }),
      agent({ id: 2, username: 'c' }),
      agent({ id: 3, username: 'b', projects: [{ id: 6, key: 'FAM', assignment: '' }] }),
    ]);
    const text = resolveText(team, current);
    expect(text.text).toBe('Team a+c');
    expect(text.replaces).toContain('x');
    expect(text.replaces).toContain(sha256('Team a'));
    expect(text.replaces).toContain(sha256('Team a+b+c'));
    expect(text.replaces).toHaveLength(1 + 8);
  });
});

describe('browser and model', () => {
  it('turns the project browser on, but leaves one who chose the old Hermes browser', () => {
    const wanted = target({ projectBrowser: true }, false);
    expect(planTuning(state([agent()]), wanted, ['browser']).changes).toEqual([
      { kind: 'browser', agentId: 1, username: 'coder-vol' },
    ]);
    expect(planTuning(state([agent({ browser: 'gateway' })]), wanted, ['browser']).changes).toEqual(
      [],
    );
    const legacy = planTuning(state([agent({ browser: 'legacy' })]), wanted, ['browser']);
    expect(legacy.changes).toEqual([]);
    expect(legacy.skipped).toEqual([
      '@coder-vol: uses the old Hermes browser someone chose; left as it is',
    ]);
  });

  it('sets a model only on the default and never one the provider refused', () => {
    const wanted = target({ model: 'gpt-6-sol' }, false);
    expect(planTuning(state([agent()]), wanted, ['reasoning']).changes).toEqual([
      { kind: 'model', agentId: 1, username: 'coder-vol', from: null, to: 'gpt-6-sol' },
    ]);
    expect(
      planTuning(state([agent({ model: 'gpt-6-sol' })]), wanted, ['reasoning']).changes,
    ).toEqual([]);
    const own = planTuning(state([agent({ model: 'claude-opus-5' })]), wanted, ['reasoning']);
    expect(own.skipped).toEqual(['@coder-vol: model claude-opus-5 was set by hand; left as it is']);
    const refused = planTuning(state([agent()], { unavailableModels: ['gpt-6-sol'] }), wanted, [
      'reasoning',
    ]);
    expect(refused.changes).toEqual([]);
    expect(refused.skipped).toEqual([
      '@coder-vol: the provider refused gpt-6-sol; left on the default',
    ]);
  });
});

describe('nextPolicy', () => {
  const policy: PolicyLike & { toolAllow: string[]; mcpGrants: string[]; maxTurns: number } = {
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
      nextPolicy(policy, [{ kind: 'instructions', agentId: 1, username: 'a', from: '', to: 'x' }]),
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
    expect(lines[0]).toContain(
      'same name as a Hermes skill (skill_view refuses both): systematic-debugging',
    );
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

  it('creates every approved pool copy, each with its assignment', () => {
    expect(COPIES.map((c) => c.username)).toEqual(
      POOL_COPIES.map((c) => copyHandle(c.template, c.projectKey)),
    );
    for (const copy of COPIES) {
      expect(copy.assignments?.[copy.copyOf!.projectKey]?.text.length).toBeGreaterThan(80);
      expect(copy).toMatchObject({
        projectBrowser: true,
        triggers: { mention: true, assign: true },
      });
    }
    expect(TEMPLATES.map((t) => t.username).sort()).toEqual([
      'assistant',
      'code-reviewer',
      'content',
      'designer',
      'devops',
      'finance',
      'market-analyst',
      'qa',
      'researcher',
      'shopify-dev',
      'tech-writer',
    ]);
  });

  it('names every copy in the instructions of its coordinator once it exists', () => {
    for (const copy of COPIES) {
      const key = copy.copyOf!.projectKey;
      const coordinator = TARGET.agents.find(
        (a) => a.username === `${key.toLowerCase()}-koordinator`,
      )!;
      const current = state([
        agent({ username: copy.username, projects: [{ id: 1, key, assignment: '' }] }),
      ]);
      const text = resolveText(coordinator.instructions!, current).text;
      expect(text).toContain(`@${copy.username}:`);
      const alone = resolveText(coordinator.instructions!, state([])).text;
      expect(alone).not.toContain(`@${copy.username}`);
    }
  });

  it('gives VERVE a team per area, all reporting to its coordinator', () => {
    const verve = TARGET.agents.filter(
      (a) => a.copyOf?.projectKey === 'VERVE' || a.username === 'coder-verve',
    );
    expect(verve).toHaveLength(10);
    for (const entry of verve) {
      expect(entry.org?.department).toMatch(/^Verve · (Entwicklung|Marketing|Support)$/);
      const text = entry.assignments!.VERVE!.text;
      expect(text).toContain('/srv/volition/workspaces/projects/verve/');
      expect(text).toContain('@verve-koordinator');
      expect(text.length).toBeLessThanOrEqual(500);
    }
    expect(TARGET.departments?.map((d) => d.parent)).toEqual(['Volition', 'Volition', 'Volition']);
    expect(verve.find((a) => a.username === 'code-reviewer-verve')?.org?.role).toBe('reviewer');
    expect(verve.find((a) => a.username === 'assistant-verve')?.name).toBe('Support VERVE');
  });

  it('never turns off a skill of the pool', () => {
    expect(DISABLED_BUNDLED_SKILLS.filter((name) => pool.has(name))).toEqual([]);
  });

  it('writes German texts without the old product names', () => {
    const everyone = state(
      TARGET.agents.map((a, index) =>
        agent({
          id: index + 1,
          username: a.username,
          projects: ['PRIV', 'FAM', 'VOL', 'VERVE'].map((key, id) => ({ id, key, assignment: '' })),
        }),
      ),
    );
    const texts = [
      ...TARGET.projects.map((p) => p.instructions.text),
      ...TARGET.agents.flatMap((a) => [
        // A coordinator's text with its whole team, so every specialist line is checked.
        a.instructions ? resolveText(a.instructions, everyone).text : '',
        a.soul?.text ?? '',
        ...Object.values(a.assignments ?? {}).map((t) => t.text),
      ]),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/\bPlan\b|It.s a Plan|Itsaplan/);
    }
  });
});
