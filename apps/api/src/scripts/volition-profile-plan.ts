import { aiAgent, agentRun, agentChatMessage, agentChatThread, db, project } from '@repo/db';
import { isNotNull } from 'drizzle-orm';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Mapping } from '../../../../scripts/volition-profile-import';

export async function planProfiles(profilesRoot: string): Promise<Mapping[]> {
  const agents = await db
    .select({
      id: aiAgent.id,
      teamId: aiAgent.teamId,
      username: aiAgent.username,
      role: aiAgent.agentRole,
    })
    .from(aiAgent);
  const projects = await db.select({ key: project.key, teamId: project.teamId }).from(project);
  const runs = await db
    .select({ agentId: agentRun.agentId, sessionId: agentRun.sessionId, runId: agentRun.id })
    .from(agentRun)
    .where(isNotNull(agentRun.sessionId));
  const chats = await db
    .select({
      agentId: agentChatMessage.agentId,
      sessionId: agentChatMessage.sessionId,
      threadId: agentChatMessage.threadId,
    })
    .from(agentChatMessage)
    .where(isNotNull(agentChatMessage.sessionId));
  const threads = await db
    .select({
      agentId: agentChatThread.agentId,
      sessionId: agentChatThread.cliSessionId,
      threadId: agentChatThread.id,
    })
    .from(agentChatThread)
    .where(isNotNull(agentChatThread.cliSessionId));
  const mappings: Mapping[] = [];
  for (const entry of (await readdir(profilesRoot, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.isSymbolicLink()) throw new Error(`Profile symlink refused: ${entry.name}`);
    if (!entry.isDirectory()) continue;
    const match = /^([a-z0-9-]+?)(?:_([1-9][0-9]*))?$/.exec(entry.name);
    if (!match) throw new Error(`Unrecognized profile: ${entry.name}`);
    const slug = match[1]!;
    const teams = projects
      .filter((row) => (row.key === 'VERV' ? 'verve' : row.key.toLowerCase()) === slug)
      .map((row) => row.teamId);
    const candidates = agents.filter((agent) =>
      match[2]
        ? agent.id === Number(match[2]) && (slug === 'home' || teams.includes(agent.teamId))
        : slug === 'home'
          ? agent.role === 'home'
          : teams.includes(agent.teamId) &&
            [`${slug}-koordinator`, `hermes-${slug}-coordinator`].includes(
              agent.username.toLowerCase(),
            ),
    );
    if (candidates.length !== 1)
      throw new Error(`Profile ${entry.name} has no unique agent/team assignment`);
    const agent = candidates[0]!;
    const sessions: NonNullable<Mapping['sessions']> = {};
    for (const link of [...runs, ...chats, ...threads]) {
      if (link.agentId !== agent.id || !link.sessionId) continue;
      const existing = sessions[link.sessionId] ?? {};
      const next = 'runId' in link ? { runId: link.runId } : { threadId: link.threadId };
      // A run resumed after an approval or a restart continues its Hermes session, so one
      // session can belong to several runs of the same agent: it belongs to the run that
      // started it, the earliest.
      if (existing.runId && 'runId' in next) {
        sessions[link.sessionId] = { ...existing, runId: Math.min(existing.runId, next.runId) };
        continue;
      }
      if (
        (existing.threadId && 'threadId' in next && existing.threadId !== next.threadId) ||
        (existing.runId && 'threadId' in next) ||
        (existing.threadId && 'runId' in next)
      )
        throw new Error(`Ambiguous session ownership for agent ${agent.id}`);
      sessions[link.sessionId] = { ...existing, ...next };
    }
    mappings.push({
      sourceKey: `hermes:${entry.name}:${agent.id}`,
      profile: join(resolve(profilesRoot), entry.name),
      teamId: agent.teamId,
      agentId: agent.id,
      sessions,
    });
  }
  return mappings;
}
