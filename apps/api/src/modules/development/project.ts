import { randomUUID } from 'node:crypto';
import { VaultError } from '@repo/vault';
import {
  aiAgent,
  db,
  organizationAgentAssignment,
  project,
  projectMember,
  volitionRootExecution,
} from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { createAgent, getAgentById, updateAgent } from '#modules/agents/core/service';
import {
  createSkill,
  listAgentSkills,
  listSkillOptions,
  replaceSkillFromFiles,
  setAgentSkills,
} from '#modules/agents/skills/service';
import { rootOwner, rootSettings } from '#modules/root-access/service';
import { updateProject } from '#modules/projects/service';
import { vaultScope } from '#modules/knowledge/scope';
import { readDocument, writeNote } from '#modules/knowledge/service';
import { HttpError } from '#shared/lib';

export async function configureDevelopmentProject(
  agentId: number,
  runtime: 'claude' | 'codex',
  dryRun: boolean,
) {
  const ownerId = await rootOwner(agentId);
  const settings = await rootSettings();
  if (!settings.enabled) throw new HttpError(409, 'Root access is disabled');
  const [target] = await db.select().from(project).where(eq(project.id, 15));
  if (!target || target.key !== 'HELENA')
    throw new HttpError(409, 'Existing HELENA project #15 is required');
  const [member] = await db
    .select()
    .from(projectMember)
    .where(
      and(
        eq(projectMember.projectId, target.id),
        eq(projectMember.userId, ownerId),
        eq(projectMember.role, 'owner'),
      ),
    );
  if (!member) throw new HttpError(403, 'The instance owner must own HELENA #15');
  const [coordinator] = await db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .innerJoin(projectMember, eq(projectMember.userId, aiAgent.userId))
    .innerJoin(organizationAgentAssignment, eq(organizationAgentAssignment.agentId, aiAgent.id))
    .where(
      and(
        eq(projectMember.projectId, 15),
        eq(aiAgent.teamId, target.teamId),
        eq(aiAgent.agentRole, 'agent'),
        eq(organizationAgentAssignment.role, 'coordinator'),
      ),
    )
    .limit(1);
  if (!coordinator) throw new HttpError(409, 'Existing project coordinator is required');
  const model = runtime === 'claude' ? 'claude-opus-5-5' : 'gpt-6.1-sol';
  const document = `Projects/${target.key}/Docs/Ava Entwicklung.md`;
  const handoff = '/home/wilhelmpa/volition/CLAUDE.md';
  const result = {
    projectId: 15,
    name: 'Ava Entwicklung',
    runtime,
    model,
    coordinatorId: coordinator.id,
    specialists: ['Reviewer', 'Coder'],
    document,
    handoff,
    dryRun,
  };
  let status = 'success';
  try {
    if (dryRun) return result;
    const markdown = await Bun.file(
      new URL('../../../../../bundles/agent-pool/skills/ava-entwicklung/SKILL.md', import.meta.url),
    ).text();
    const existing = (await listSkillOptions(target.teamId)).find(
      (skill) => skill.name === 'ava-entwicklung',
    );
    const skill = existing ?? (await createSkill(target.teamId, { markdown, source: 'inline' }));
    if (existing) await replaceSkillFromFiles(existing.id, target.teamId, { markdown, refs: [] });
    await updateProject(15, { name: result.name });
    const current = (await getAgentById(coordinator.id, target.teamId))!;
    await updateAgent(
      coordinator.id,
      target.teamId,
      {
        model,
        runtimePolicy: { ...current.runtimePolicy, runtime },
        instructions: `Du koordinierst Ava Entwicklung mit dem Skill ava-entwicklung; Handoff ${handoff}. Lass Agenten-Branches prüfen und übergib die Ergebnisse an Ava/Home, die Gate und Release mit den typisierten Home-Werkzeugen ausführt. Koordinator und Spezialisten führen keinen Deploy aus.`,
      },
      ownerId,
    );
    const agents = [agentId, coordinator.id];
    for (const role of ['Reviewer', 'Coder']) {
      const username = `volition-development-${role.toLowerCase()}`;
      const [found] = await db
        .select({ id: aiAgent.id })
        .from(aiAgent)
        .where(and(eq(aiAgent.teamId, target.teamId), eq(aiAgent.username, username)));
      if (found) {
        const specialist = (await getAgentById(found.id, target.teamId))!;
        await updateAgent(
          found.id,
          target.teamId,
          {
            model: 'gpt-6.1-sol',
            runtimePolicy: { ...specialist.runtimePolicy, runtime: 'codex' },
            projectIds: [...new Set([...specialist.projects.map((entry) => entry.id), 15])],
          },
          ownerId,
        );
        agents.push(found.id);
      } else {
        const created = await createAgent(target.teamId, {
          name: role,
          username,
          projectId: 15,
          roleTitle: role,
          capabilities: [role.toLowerCase()],
          model: 'gpt-6.1-sol',
          runtimePolicy: { ...current.runtimePolicy, runtime: 'codex' },
          instructions:
            role === 'Reviewer'
              ? 'Prüfe zuerst geänderte bestehende Tests, dann Diff gegen Auftrag, Implementer-Sweep und eigene gezielte Gates; melde Belege und konkrete Befunde. Kein Deploy.'
              : 'Bearbeite genau einen Auftrag nach ava-entwicklung. Backend/API/Runner/Datenbank/Skripte; Ergebnis als Branch und Bericht, kein Deploy.',
          runnerScope: 'owner',
          ownerUserId: ownerId,
          skillIds: [skill.id],
        });
        agents.push(created.agent.id);
      }
    }
    for (const id of agents)
      await setAgentSkills(id, target.teamId, [
        ...(await listAgentSkills(id)).map((entry) => entry.id),
        skill.id,
      ]);
    let sha: string | null = null;
    try {
      sha = (await readDocument(document)).sha256;
    } catch (error) {
      if (!(error instanceof VaultError && error.status === 404)) throw error;
    }
    await writeNote(await vaultScope({ id: ownerId }, false), {
      path: document,
      expectedSha: sha,
      content: `---\ntitle: Ava Entwicklung\n---\n\n[Gemeinsame Handoff-Datei](file://${handoff})\n\nQuelle: ${handoff}; diese Datei bleibt die aktuelle Quelle und wird gezielt mit den Dateiwerkzeugen im Owner-Terminal gelesen.\n\nKoordinator: ${runtime}, ${model}; verfügbare Wahl: Claude Code Opus 5.5 oder Codex gpt-6.1-sol. Spezialisten: Reviewer und Coder.\n\nSkill: ava-entwicklung. Ablauf: Auftrag → Codex → Bericht → Review → Gate → Probestart → Deploy → Smoke/Integrity.\n`,
    });
    return result;
  } catch (error) {
    status = 'failed';
    throw error;
  } finally {
    await db.insert(volitionRootExecution).values({
      id: randomUUID().replaceAll('-', ''),
      agentId,
      command: 'ConfigureDevelopmentProject',
      reason: JSON.stringify({ runtime, dryRun, projectId: 15 }),
      origin: 'system',
      runtime,
      taintSources: [],
      persistence: [],
      epoch: settings.epoch,
      status,
      startedAt: new Date(),
      finishedAt: new Date(),
    });
  }
}
