import { beforeEach, describe, expect, it } from 'bun:test';
import type { TemplateBundle } from '@helena/sdk';
import { api, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';

const bundle: TemplateBundle = {
  format: 'helena.template-bundle',
  formatVersion: 1,
  name: 'session-proof',
  displayName: 'Session proof',
  version: '1.0.0',
  description: 'A local fixture.',
  license: 'MIT',
  author: { name: 'Helena tests' },
  skills: [
    {
      name: 'bundle-proof',
      source: {
        type: 'files',
        files: {
          'SKILL.md':
            '---\nname: bundle-proof\ndescription: Test fixture\n---\nRead the project context.',
        },
      },
      license: 'MIT',
      attribution: 'Helena tests',
    },
  ],
  mcpServers: { docs: { type: 'http', url: 'https://example.com/mcp' } },
  agents: [
    {
      name: 'bundle-helper',
      description: 'Helper',
      instructions: 'Help with this project.',
      model: null,
      effort: null,
      maxTurns: null,
      disallowedTools: [],
      skills: ['bundle-proof'],
      mcpServers: ['docs'],
      helena: {
        displayName: 'Bundle helper',
        roleTitle: 'Helper',
        capabilities: ['session-proof'],
        runBudgetSeconds: null,
        triggers: { mention: true, assign: false },
      },
    },
  ],
};

beforeEach(resetDb);
describe('template bundle imports with the current session', () => {
  it('imports through the same HTTP surface as the pool button and remains idempotent', async () => {
    const user = await signUpTestUser();
    const owner = authedApi(user.cookie, {
      origin: (process.env.APP_URL ?? '').split(',')[0]!,
      'sec-fetch-site': 'same-origin',
    });
    const project = (await owner.projects.post({ key: 'POOL', name: 'Pool proof' })).data!;
    const routes = owner.teams({ teamId: project.teamId })['template-bundles'];
    const dry = await routes.import.post({ bundle, dryRun: true });
    expect(dry.data).toMatchObject({ written: 0, warnings: 0 });
    const imported = await routes.import.post({ bundle });
    expect(imported.status).toBe(200);
    expect(imported.data?.warnings).toBe(0);
    expect(imported.data?.written).toBeGreaterThan(0);
    const again = await routes.import.post({ bundle });
    expect(again.data?.written).toBe(0);
    expect(again.data?.warnings).toBe(0);
    const changed = structuredClone(bundle);
    changed.agents[0]!.instructions = 'Updated instructions.';
    const drift = await routes.import.post({ bundle: changed });
    expect(drift.data?.drift).toBeGreaterThan(0);
    expect(drift.data?.written).toBe(0);
    expect((await routes.import.post({ bundle: changed, update: true })).data?.warnings).toBe(0);
    const exported = await routes.export.get({ query: { agents: 'bundle-helper' } });
    expect(exported.status).toBe(200);
    expect(exported.data).toMatchObject({
      agents: [{ name: 'bundle-helper', instructions: 'Updated instructions.' }],
    });
  });
  it('refuses a missing session and a caller outside the team', async () => {
    const owner = authedApi((await signUpTestUser()).cookie);
    const project = (await owner.projects.post({ key: 'POOL', name: 'Pool proof' })).data!;
    expect(
      (await api.teams({ teamId: project.teamId })['template-bundles'].import.post({ bundle }))
        .status,
    ).toBe(401);
    const stranger = authedApi((await signUpTestUser()).cookie);
    expect(
      (await stranger.teams({ teamId: project.teamId })['template-bundles'].import.post({ bundle }))
        .status,
    ).toBe(404);
  });
});
