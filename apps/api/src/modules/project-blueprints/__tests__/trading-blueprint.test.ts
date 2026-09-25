import { describe, expect, it } from 'bun:test';
import { basename, join } from 'node:path';
import { readBlueprintDir } from '@helena/sdk/blueprints';
import { readBundleDir } from '@helena/sdk/bundles';
import { validateBundle } from '@helena/sdk';
import { LIVE_TRADING_HOSTS } from '@helena/policy';
import { alpacaPaperTools, PAPER_HOSTS } from '@helena/trading';
import { minCronIntervalSeconds } from '#modules/routines/cron';

// The trading blueprint (blueprints/trading) and the agent pool it copies from: the
// guardrails hold by construction (only the Paper-Trader places orders, and it has no
// network of its own; the live trading hosts are denied), every template, skill and link it
// names exists, and no note of its knowledge is an orphan.

const REPO = join(import.meta.dir, '../../../../../..');
const blueprint = readBlueprintDir(join(REPO, 'blueprints/trading'));
const pool = readBundleDir(join(REPO, 'bundles/agent-pool'));
const WRITE_TOOLS = alpacaPaperTools()
  .filter((tool) => tool.category !== 'read')
  .map((tool) => tool.name);

describe('the trading blueprint', () => {
  it('is valid, and so is the pool it copies from', () => {
    expect(blueprint.project.key).toBe('TRADE');
    expect(blueprint.project.instructions.length).toBeLessThanOrEqual(4000);
    expect(validateBundle(pool)).toEqual([]);
  });

  it('copies only templates the pool has, and the pool has every skill they use', () => {
    const templates = new Map(pool.agents.map((agent) => [agent.name, agent]));
    const skills = new Set(pool.skills.map((skill) => skill.name));
    for (const agent of blueprint.agents) {
      expect({ template: agent.template, inPool: templates.has(agent.template) }).toEqual({
        template: agent.template,
        inPool: true,
      });
      for (const skill of agent.skills ?? []) expect(skills.has(skill)).toBe(true);
    }
    for (const skill of blueprint.coordinator?.skills ?? []) {
      expect({ skill, inPool: skills.has(skill) }).toEqual({ skill, inPool: true });
    }
  });

  it('lets only the Paper-Trader place, cancel or close orders, and gives it no network', () => {
    for (const agent of blueprint.agents) {
      for (const binding of agent.tools ?? []) {
        expect(binding.connector).toBe('alpaca_paper');
        const all = binding.names === undefined;
        const writes = all
          ? WRITE_TOOLS
          : binding.names!.filter((name) => WRITE_TOOLS.includes(name));
        if (agent.template === 'paper-trader') continue;
        expect({ template: agent.template, writes }).toEqual({
          template: agent.template,
          writes: [],
        });
      }
    }
    const trader = blueprint.agents.find((agent) => agent.template === 'paper-trader')!;
    expect(trader.network).toBe('blocked');
    const template = pool.agents.find((agent) => agent.name === 'paper-trader')!;
    for (const toolset of ['terminal', 'code_execution', 'browser', 'web', 'connections']) {
      expect(template.disallowedTools).toContain(toolset);
    }
  });

  it('denies every live trading host and no paper host', () => {
    const deny = new Set(blueprint.network?.deny ?? []);
    for (const host of LIVE_TRADING_HOSTS)
      expect({ host, denied: deny.has(host) }).toEqual({ host, denied: true });
    for (const host of PAPER_HOSTS) expect(deny.has(host)).toBe(false);
  });

  it('proposes routines that run on a valid schedule, for its own agents', () => {
    const handles = new Set(['coordinator', ...blueprint.agents.map((agent) => agent.template)]);
    for (const routine of blueprint.routines) {
      expect(handles.has(routine.agent)).toBe(true);
      expect(minCronIntervalSeconds(routine.cron, routine.timezone)).toBeGreaterThanOrEqual(3600);
    }
  });

  it('has goals the owner asked for', () => {
    const titles = blueprint.goals.map((goal) => goal.title);
    expect(titles).toContain(
      'Strategie-Labor: erste Strategie durch Backtest und 4 Wochen Paper-Trading',
    );
    expect(titles).toContain(
      'Trading-Regelwerk schriftlich festlegen (Risiko pro Trade, Tagesverlustgrenze)',
    );
  });
});

describe('its knowledge', () => {
  const notes = new Map(
    blueprint.knowledge.project.map((file) => [basename(file.path, '.md'), file.content]),
  );
  const links = (text: string) =>
    [...text.matchAll(/!?\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)].map((match) => match[1]!.trim());
  const placeholder = (target: string) => /[…<>]/.test(target);

  it('links only to notes it has', () => {
    const sources = [
      ...blueprint.knowledge.project.map((file) => [file.path, file.content] as const),
      ...blueprint.knowledge.templates.map((file) => [file.path, file.content] as const),
      ['instructions.md', blueprint.project.instructions] as const,
      ...blueprint.boards.flatMap((board) =>
        board.stickers.map((sticker) => [`board ${sticker.id}`, sticker.body] as const),
      ),
      ...blueprint.routines.map(
        (routine) => [`routine ${routine.key}`, routine.instructions] as const,
      ),
    ];
    for (const [where, text] of sources) {
      for (const target of links(text)) {
        if (placeholder(target)) continue;
        expect({ where, target, exists: notes.has(target) }).toEqual({
          where,
          target,
          exists: true,
        });
      }
    }
  });

  it('has no orphan: every note but the start page is linked from another one', () => {
    const incoming = new Set<string>();
    for (const [name, text] of notes) {
      for (const target of links(text)) if (target !== name) incoming.add(target);
    }
    for (const name of notes.keys()) {
      if (name === 'Trading-Start') continue;
      expect({ name, linked: incoming.has(name) }).toEqual({ name, linked: true });
    }
  });

  it('ends every analysing note and template with the note that it is no investment advice', () => {
    const analysing = [
      ...blueprint.knowledge.project.filter((file) =>
        /Regelwerk|Strategie-Labor|Trading-Start/.test(file.path),
      ),
      ...blueprint.knowledge.templates.filter((file) =>
        /Analyse|Strategie|Backtest|review|Briefing/i.test(file.path),
      ),
    ];
    expect(analysing.length).toBeGreaterThanOrEqual(8);
    for (const file of analysing) {
      expect({ path: file.path, advice: file.content.includes('Keine Anlageberatung') }).toEqual({
        path: file.path,
        advice: true,
      });
    }
  });

  it('gives every note and template front matter with a type', () => {
    for (const file of [...blueprint.knowledge.project, ...blueprint.knowledge.templates]) {
      expect({
        path: file.path,
        typed: /^---\n(?:.*\n)*?typ: .+\n(?:.*\n)*?---\n/.test(file.content),
      }).toEqual({
        path: file.path,
        typed: true,
      });
    }
  });
});
