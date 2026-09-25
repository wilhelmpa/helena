import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { readBlueprintDir } from '@helena/sdk/blueprints';
import { blueprintCopyHandle, type ProjectBlueprint } from '@helena/sdk';
import {
  BLUEPRINT_SECTIONS,
  coordinatorHandle,
  DEFAULT_BLUEPRINT_SECTIONS,
  formatPlan,
  planBlueprint,
  projectFilePath,
  routineIdempotencyKey,
  templateFilePath,
  type BlueprintState,
  type Change,
  type StateAgent,
} from '../plan';

// The planning of a project blueprint against the team as it is: what a first run creates,
// that a second run over the result has nothing left to do, and what it leaves to the owner.

const REPO = join(import.meta.dir, '../../../../../..');
const TRADING: ProjectBlueprint = readBlueprintDir(join(REPO, 'blueprints/trading'));
const KEY = TRADING.project.key;
const COORDINATOR = coordinatorHandle(KEY);
const PAPER_TOOLS = [
  'alpaca_paper_account',
  'alpaca_paper_positions',
  'alpaca_paper_orders',
  'alpaca_paper_market',
  'alpaca_paper_bars',
  'alpaca_paper_check_order',
  'alpaca_paper_submit_order',
  'alpaca_paper_cancel_order',
  'alpaca_paper_close_position',
];

let nextId = 100;
function agent(overrides: Partial<StateAgent> = {}): StateAgent {
  const id = overrides.id ?? nextId++;
  return {
    id,
    userId: `u${id}`,
    username: `agent-${id}`,
    template: false,
    sourceTemplateId: null,
    instructions: null,
    skills: [],
    projectKeys: [],
    assignment: null,
    departmentId: null,
    projectBrowser: false,
    memoryApproval: true,
    tools: [],
    ...overrides,
  };
}

function templates(): StateAgent[] {
  return TRADING.agents.map((entry) =>
    agent({ username: entry.template, template: true, skills: ['trading-grundregeln'] }),
  );
}

// A team with the templates imported and no project yet.
function emptyState(overrides: Partial<BlueprintState> = {}): BlueprintState {
  const library = [
    ...new Set([
      ...(TRADING.coordinator?.skills ?? []),
      ...TRADING.agents.flatMap((entry) => entry.skills ?? []),
      'trading-grundregeln',
    ]),
  ];
  return {
    departments: [
      { id: 1, name: 'Volition' },
      { id: 2, name: 'Familie & Privat' },
    ],
    project: null,
    areas: [],
    agents: [agent({ username: 'master' }), ...templates()],
    library,
    network: null,
    existingFiles: [],
    boards: [],
    goals: [],
    routineKeys: [],
    credentials: [],
    agentTools: [],
    connectorTools: { alpaca_paper: PAPER_TOOLS },
    defaultCoordinatorInstructions: 'You coordinate project TRADE (Trading) for its owner.',
    ...overrides,
  };
}

// The same team after everything the blueprint describes was applied.
function appliedState(): BlueprintState {
  const base = emptyState();
  const projectId = 7;
  const copies = TRADING.agents.map((entry, index) =>
    agent({
      id: 500 + index,
      username: blueprintCopyHandle(entry.template, KEY),
      skills: ['trading-grundregeln', ...(entry.skills ?? [])],
      projectKeys: [KEY],
      assignment: entry.assignment,
      departmentId: 2,
      projectBrowser: !!entry.projectBrowser,
    }),
  );
  const coordinator = agent({
    id: 499,
    username: COORDINATOR,
    instructions: TRADING.coordinator!.instructions!,
    skills: TRADING.coordinator!.skills!,
    projectKeys: [KEY],
    assignment: TRADING.coordinator!.assignment!,
    departmentId: 2,
    projectBrowser: true,
  });
  const agentModes = Object.fromEntries(
    TRADING.agents
      .map((entry, index) => [String(500 + index), entry.network] as const)
      .filter(([, mode]) => mode !== undefined),
  ) as Record<string, 'open' | 'allowlist' | 'blocked'>;
  return {
    ...base,
    project: {
      id: projectId,
      key: KEY,
      name: TRADING.project.name,
      departmentId: 2,
      instructions: TRADING.project.instructions,
    },
    areas: TRADING.areas.map((area) => ({ name: area.name, folder: area.folder ?? '' })),
    agents: [...base.agents, coordinator, ...copies],
    network: {
      stored: true,
      mode: 'open',
      allow: [],
      deny: [...(TRADING.network?.deny ?? [])],
      agents: agentModes,
    },
    existingFiles: [
      ...TRADING.knowledge.project.map((file) => projectFilePath(KEY, file.path)),
      ...TRADING.knowledge.templates.map((file) => templateFilePath(file.path)),
    ],
    boards: TRADING.boards.map((board) => board.name),
    goals: TRADING.goals.map((goal) => ({ title: goal.title, projectId })),
    routineKeys: TRADING.routines.map((routine) =>
      routineIdempotencyKey(TRADING.name, KEY, routine.key),
    ),
  };
}

const kinds = (changes: Change[]) =>
  changes.reduce<Record<string, number>>((out, change) => {
    out[change.kind] = (out[change.kind] ?? 0) + 1;
    return out;
  }, {});

describe('a first run', () => {
  const plan = planBlueprint(TRADING, emptyState(), DEFAULT_BLUEPRINT_SECTIONS);

  it('creates the project, its areas, its team, its knowledge, goals and routines', () => {
    expect(plan.blockers).toEqual([]);
    const count = kinds(plan.changes);
    expect(count.project).toBe(1);
    expect(count.projectDepartment).toBe(1);
    expect(count.projectInstructions).toBe(1);
    expect(count.area).toBe(TRADING.areas.length);
    expect(count.coordinatorInstructions).toBe(1);
    expect(count.copy).toBe(TRADING.agents.length);
    // Every copy and the coordinator get their assignment and the department.
    expect(count.assignment).toBe(TRADING.agents.length + 1);
    expect(count.department).toBe(TRADING.agents.length + 1);
    expect(count.projectBrowser).toBe(TRADING.agents.filter((entry) => entry.projectBrowser).length);
    expect(count.network).toBe(1);
    expect(count.file).toBe(TRADING.knowledge.project.length + TRADING.knowledge.templates.length);
    expect(count.board).toBe(TRADING.boards.length);
    expect(count.goal).toBe(TRADING.goals.length);
    expect(count.routine).toBe(TRADING.routines.length);
    expect(count.tools).toBeUndefined();
  });

  it('creates the project before anything that needs it', () => {
    expect(plan.changes[0]!.kind).toBe('project');
    const firstCopy = plan.changes.findIndex((change) => change.kind === 'copy');
    const firstArea = plan.changes.findIndex((change) => change.kind === 'area');
    expect(firstArea).toBeGreaterThan(0);
    expect(firstCopy).toBeGreaterThan(firstArea);
  });

  it('names the copies by handle and blocks the Paper-Trader from the network', () => {
    const copies = plan.changes.filter((change) => change.kind === 'copy');
    expect(copies.map((change) => change.handle)).toContain('paper-trader-trade');
    const network = plan.changes.find((change) => change.kind === 'network');
    expect(network?.kind === 'network' && network.agents).toEqual({
      'paper-trader-trade': 'blocked',
    });
    expect(network?.kind === 'network' && network.addDeny).toContain('api.alpaca.markets');
    expect(network?.kind === 'network' && network.mode).toBe('open');
  });

  it('places the knowledge in the project and the templates in Templates/', () => {
    const paths = plan.changes.flatMap((change) => (change.kind === 'file' ? [change.path] : []));
    expect(paths).toContain('Projects/TRADE/Docs/Regelwerk.md');
    expect(paths).toContain('Templates/Trading/Trade.md');
    expect(paths.every((path) => path.startsWith('Projects/TRADE/') || path.startsWith('Templates/'))).toBe(true);
  });

  it('proposes every routine with a stable idempotency key', () => {
    const routines = plan.changes.filter((change) => change.kind === 'routine');
    for (const routine of routines) {
      if (routine.kind !== 'routine') continue;
      expect(routine.idempotencyKey).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(routine.idempotencyKey).toBe(routineIdempotencyKey('trading', KEY, routine.key));
    }
    expect(new Set(routines.map((r) => (r.kind === 'routine' ? r.idempotencyKey : ''))).size).toBe(
      routines.length,
    );
  });

  it('reads as lines', () => {
    const lines = formatPlan(plan);
    expect(lines[0]).toBe('[PROJECT] create TRADE "Trading"');
    expect(lines.some((line) => line.startsWith('[ROUTINE]') && line.endsWith('switched off'))).toBe(
      true,
    );
  });
});

describe('a second run', () => {
  it('has nothing left to do', () => {
    const plan = planBlueprint(TRADING, appliedState(), BLUEPRINT_SECTIONS);
    // Tools wait for the owner's credential.
    expect(plan.changes).toEqual([]);
    expect(plan.blockers).toEqual([]);
    expect(plan.skipped.map((entry) => entry.what)).toEqual(
      TRADING.agents
        .filter((entry) => entry.tools?.length)
        .flatMap((entry) => entry.tools!.map(() => `alpaca_paper tools of @${blueprintCopyHandle(entry.template, KEY)}`)),
    );
  });
});

describe('what it leaves to the owner', () => {
  it('keeps instructions someone wrote', () => {
    const state = appliedState();
    state.project = { ...state.project!, instructions: 'Meine eigenen Regeln.' };
    const coordinator = state.agents.find((entry) => entry.username === COORDINATOR)!;
    coordinator.instructions = 'Eigene Anweisung.';
    const plan = planBlueprint(TRADING, state, DEFAULT_BLUEPRINT_SECTIONS);
    expect(plan.changes).toEqual([]);
    expect(plan.skipped.map((entry) => entry.what)).toEqual([
      'project instructions of TRADE',
      `instructions of @${COORDINATOR}`,
    ]);
  });

  it("replaces only the coordinator's generated default", () => {
    const state = appliedState();
    state.agents.find((entry) => entry.username === COORDINATOR)!.instructions =
      state.defaultCoordinatorInstructions;
    const plan = planBlueprint(TRADING, state, ['agents']);
    expect(plan.changes.map((change) => change.kind)).toEqual(['coordinatorInstructions']);
  });

  it('keeps a network mode set by hand and reports it', () => {
    const state = appliedState();
    state.network!.agents = { '507': 'open' };
    const plan = planBlueprint(TRADING, state, ['network']);
    expect(plan.changes).toEqual([]);
    expect(plan.skipped[0]!.what).toBe('network of @paper-trader-trade');
  });

  it('adds only the denied hosts that are missing and never sets the mode of a project that has one', () => {
    const state = appliedState();
    state.network!.deny = state.network!.deny.filter((host) => host !== 'api.alpaca.markets');
    state.network!.mode = 'allowlist';
    const plan = planBlueprint(TRADING, state, ['network']);
    expect(plan.changes).toEqual([
      { kind: 'network', mode: null, addAllow: [], addDeny: ['api.alpaca.markets'], agents: {} },
    ]);
  });

  it('blocks copies whose template the team does not have', () => {
    const state = emptyState();
    state.agents = state.agents.filter((entry) => entry.username !== 'paper-trader');
    const plan = planBlueprint(TRADING, state, ['agents']);
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0]).toContain('@paper-trader');
    expect(plan.changes.some((change) => change.kind === 'copy' && change.handle === 'paper-trader-trade')).toBe(false);
  });

  it('reports memory approval switched off', () => {
    const state = appliedState();
    state.agents.find((entry) => entry.username === 'risk-journal-trade')!.memoryApproval = false;
    const plan = planBlueprint(TRADING, state, ['agents']);
    expect(plan.skipped.map((entry) => entry.what)).toEqual(['memory approval of @risk-journal-trade']);
  });

  it('reports a missing department instead of creating it', () => {
    const plan = planBlueprint(
      TRADING,
      emptyState({ departments: [{ id: 1, name: 'Volition' }] }),
      ['project'],
    );
    expect(plan.changes.map((change) => change.kind)).toEqual(['project', 'projectInstructions']);
    expect(plan.skipped[0]!.what).toBe('department "Familie & Privat"');
  });
});

describe('tool bindings', () => {
  it('bind every paper tool to the Paper-Trader and only reading ones to the others', () => {
    const state = appliedState();
    state.credentials = [{ id: 44, kind: 'alpaca_paper', label: 'Alpaca Paper' }];
    const plan = planBlueprint(TRADING, state, ['tools']);
    const byHandle = Object.fromEntries(
      plan.changes.flatMap((change) => (change.kind === 'tools' ? [[change.handle, change.toolKeys]] : [])),
    );
    expect(byHandle['paper-trader-trade']).toEqual(PAPER_TOOLS);
    for (const [handle, tools] of Object.entries(byHandle)) {
      if (handle === 'paper-trader-trade') continue;
      for (const tool of tools as string[]) {
        expect({ handle, tool, orders: /submit|cancel|close/.test(tool) }).toEqual({
          handle,
          tool,
          orders: false,
        });
      }
    }
  });

  it('bind nothing while two credentials leave the choice open', () => {
    const state = appliedState();
    state.credentials = [
      { id: 44, kind: 'alpaca_paper', label: 'Alpaca Paper' },
      { id: 45, kind: 'alpaca_paper', label: 'Alpaca Paper 2' },
    ];
    const plan = planBlueprint(TRADING, state, ['tools']);
    expect(plan.changes).toEqual([]);
    expect(plan.skipped.every((entry) => entry.why.includes('2 alpaca_paper credentials'))).toBe(true);
  });

  it('bind only what is missing', () => {
    const state = appliedState();
    state.credentials = [{ id: 44, kind: 'alpaca_paper', label: 'Alpaca Paper' }];
    const trader = state.agents.find((entry) => entry.username === 'paper-trader-trade')!;
    trader.tools = PAPER_TOOLS.slice(0, 8).map((toolKey, index) => ({
      agentToolId: 900 + index,
      toolKey,
      credentialId: 44,
    }));
    const plan = planBlueprint(TRADING, state, ['tools']);
    const trading = plan.changes.find(
      (change) => change.kind === 'tools' && change.handle === 'paper-trader-trade',
    );
    expect(trading?.kind === 'tools' && trading.toolKeys).toEqual(['alpaca_paper_close_position']);
  });
});
