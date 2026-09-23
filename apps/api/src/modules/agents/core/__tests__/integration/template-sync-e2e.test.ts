import { beforeEach, describe, expect, it } from 'bun:test';
import { agentTemplateSyncLog, db } from '@repo/db';
import { eq } from 'drizzle-orm';
import { authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { loadProjectContext, resolveRoles } from '#modules/pipelines/project-context';
import { bootstrapHomeAgent } from '../../../../../scripts/bootstrap-home-agent';
import { runtimePolicySnapshot } from '../../../runtime-policy/service';
import { getAgentById } from '../../service';

// End to end: Helena is the source of truth for a template and its copies (the owner's
// requirement), so a change to a template must reach, in order: the copy's own row,
// the runtime policy the runner projects into Hermes for that copy, and the agent
// Mastra's deterministic role resolution (a 'template' role) hands a workflow step. A
// copy's own edit must survive the same template change (it is recorded as an
// override) until the owner resets it.

const agents = (api: Api, teamId: number) => api.teams({ teamId })['ai-agents'];
const skillsRoute = (api: Api, teamId: number) => api.teams({ teamId })['agent-skills'];

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const home = await bootstrapHomeAgent();
  if (home.status !== 'ready') throw new Error('Home agent was not provisioned');
  const project = (await asOwner.projects.post({ key: 'VOL', name: 'Volition' })).data!;
  return { asOwner, teamId: project.teamId, project };
}

const skillMd = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\n\nBody.`;

describe('template sync end to end', () => {
  beforeEach(resetDb);

  it('a template change reaches its copy, the runtime policy, and Mastra role resolution', async () => {
    const { asOwner, teamId, project } = await setup();

    const skillA = (
      await skillsRoute(asOwner, teamId).post({ source: 'inline', markdown: skillMd('Base') })
    ).data!;
    const skillB = (
      await skillsRoute(asOwner, teamId).post({ source: 'inline', markdown: skillMd('Added') })
    ).data!;

    // A template with one skill, copied into the project as a specialist.
    const template = (
      await agents(asOwner, teamId).post({
        name: 'Coder',
        username: 'coder',
        kind: 'external',
        template: true,
      })
    ).data!.agent;
    await agents(asOwner, teamId)({ agentId: template.id }).skills.put({ skillIds: [skillA.id] });

    const copyRes = await agents(asOwner, teamId)({ agentId: template.id }).copy.post({
      projectId: project.id,
    });
    expect(copyRes.status).toBe(201);
    const copy = copyRes.data!.agent;
    expect(copy.sourceTemplateId).toBe(template.id);
    expect(copy.templateOverrides).toEqual([]);

    // The copy's own runtime policy snapshot (what the runner would project into
    // Hermes) already carries the template's skill from the copy itself.
    const before = await runtimePolicySnapshot(copy);
    expect(before.skills.map((s) => s.name)).toEqual(['Base']);

    // The template changes: a second skill is added.
    await agents(asOwner, teamId)({ agentId: template.id }).skills.put({
      skillIds: [skillA.id, skillB.id],
    });

    // The copy picked it up on its own (no API call against the copy at all), because
    // it has not overridden the 'skills' group.
    const copyAfter = await getAgentById(copy.id, teamId);
    expect(copyAfter!.templateOverrides).not.toContain('skills');
    expect(copyAfter!.templateSyncedAt).not.toBeNull();

    // The change is visible in the sync log ("in der Aktivität sichtbar").
    const logRows = await db
      .select()
      .from(agentTemplateSyncLog)
      .where(eq(agentTemplateSyncLog.copyId, copy.id));
    expect(logRows.some((row) => (row.groups as string[]).includes('skills'))).toBe(true);

    // The copy's runtime policy now contains the change: the exact thing the runner
    // hands Hermes for this agent.
    const after = await runtimePolicySnapshot(copyAfter!);
    expect(after.skills.map((s) => s.name).sort()).toEqual(['Added', 'Base']);

    // Mastra's deterministic role resolution (a workflow step with a 'template' role,
    // as project-context.ts resolves it for the agent-team / workflow-builder paths)
    // finds this exact copy, and the agent it names carries the synced setting.
    const context = await loadProjectContext({ id: project.id, key: project.key, teamId });
    const [resolved] = resolveRoles(
      [{ key: 'coder', name: 'Coder', match: { type: 'template', agentId: template.id } }],
      {},
      context,
    );
    expect(resolved.source).toBe('match');
    expect(resolved.agent?.id).toBe(copy.id);
    const resolvedFull = await getAgentById(resolved.agent!.id, teamId);
    const resolvedSnapshot = await runtimePolicySnapshot(resolvedFull!);
    expect(resolvedSnapshot.skills.map((s) => s.name).sort()).toEqual(['Added', 'Base']);
  });

  it("keeps a copy's own edit until the owner resets it, and applies it again once reset", async () => {
    const { asOwner, teamId, project } = await setup();

    const skillA = (
      await skillsRoute(asOwner, teamId).post({ source: 'inline', markdown: skillMd('Base') })
    ).data!;
    const skillB = (
      await skillsRoute(asOwner, teamId).post({ source: 'inline', markdown: skillMd('TemplateOnly') })
    ).data!;
    const skillC = (
      await skillsRoute(asOwner, teamId).post({ source: 'inline', markdown: skillMd('CopyOnly') })
    ).data!;

    const template = (
      await agents(asOwner, teamId).post({
        name: 'Coder',
        username: 'coder',
        kind: 'external',
        template: true,
      })
    ).data!.agent;
    await agents(asOwner, teamId)({ agentId: template.id }).skills.put({ skillIds: [skillA.id] });
    const copy = (
      await agents(asOwner, teamId)({ agentId: template.id }).copy.post({ projectId: project.id })
    ).data!.agent;

    // The owner edits the copy's own skills directly (a deliberate divergence).
    await agents(asOwner, teamId)({ agentId: copy.id }).skills.put({
      skillIds: [skillA.id, skillC.id],
    });
    const copyAfterEdit = await getAgentById(copy.id, teamId);
    expect(copyAfterEdit!.templateOverrides).toEqual(['skills']);

    // The template changes its own skills. The sync runs, but this copy's 'skills'
    // group is overridden, so it is left alone.
    await agents(asOwner, teamId)({ agentId: template.id }).skills.put({
      skillIds: [skillA.id, skillB.id],
    });
    const copyStillDiverged = await getAgentById(copy.id, teamId);
    expect(copyStillDiverged!.templateOverrides).toEqual(['skills']);
    const stillDivergedSnapshot = await runtimePolicySnapshot(copyStillDiverged!);
    expect(stillDivergedSnapshot.skills.map((s) => s.name).sort()).toEqual(['Base', 'CopyOnly']);

    // "Auf Vorlage zurücksetzen": the override is dropped and the template's current
    // skills are applied right away.
    const resetRes = await agents(asOwner, teamId)({ agentId: copy.id })['reset-to-template'].post(
      { group: 'skills' },
    );
    expect(resetRes.status).toBe(200);
    const copyAfterReset = await getAgentById(copy.id, teamId);
    expect(copyAfterReset!.templateOverrides).toEqual([]);
    const afterResetSnapshot = await runtimePolicySnapshot(copyAfterReset!);
    expect(afterResetSnapshot.skills.map((s) => s.name).sort()).toEqual(['Base', 'TemplateOnly']);
  });
});
