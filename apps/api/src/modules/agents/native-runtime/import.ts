import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  aiAgent,
  db,
  agentMemoryRevision,
  agentRun,
  agentChatMessage,
  agentChatThread,
  helenaAgentSession,
  helenaAgentSessionItem,
  volitionProfileImport,
} from '@repo/db';
import { looksSecret } from '@helena/facts';
import { agentSessionSource, agentMemorySource, reindexItems } from '@helena/knowledge';
import { HttpError } from '#shared/lib';
import type { profileImportBody } from './model';
import { learnedInventory, nativeSkills, validateNativeSkill } from './skills';
import type { AgentRuntimeState } from '../core/service';
import { maskForTeam } from '../credentials/env';

type Bundle = typeof profileImportBody.static;
const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

function sessionId(agentId: number, sourceId: string): string {
  const hex = fingerprint([agentId, 'hermes', sourceId]);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function importProfile(agentId: number, teamId: number, input: Bundle) {
  const bundle = await maskForTeam(teamId, input);
  const { apply = false, ...data } = bundle;
  if (new Set(data.memory.map((memory) => memory.file)).size !== data.memory.length)
    throw new HttpError(400, 'Duplicate memory file');
  if (JSON.stringify(data).length > 32 * 1024 * 1024)
    throw new HttpError(413, 'Profile exceeds the import limit');
  for (const skill of data.skills) validateNativeSkill(skill);
  if (
    new Set(data.skills.map((skill) => skill.path)).size !== data.skills.length ||
    new Set(data.sessions.map((session) => session.id)).size !== data.sessions.length
  )
    throw new HttpError(400, 'Duplicate source identifiers');
  for (const memory of data.memory)
    if (looksSecret(memory.content))
      throw new HttpError(400, 'Memory looks like it holds a secret');
  const digest = fingerprint(data);
  const result = await db.transaction(async (tx) => {
    if (apply)
      await tx.execute(sql`LOCK TABLE agent_run, agent_chat_message IN SHARE ROW EXCLUSIVE MODE`);
    const [agent] = await tx
      .select()
      .from(aiAgent)
      .where(and(eq(aiAgent.id, agentId), eq(aiAgent.teamId, teamId)))
      .for('update');
    if (!agent) throw new HttpError(404, 'Agent not found');
    const [prior] = await tx
      .select()
      .from(volitionProfileImport)
      .where(
        and(
          eq(volitionProfileImport.agentId, agentId),
          eq(volitionProfileImport.sourceKey, data.sourceKey),
        ),
      );
    if (prior) {
      if (prior.fingerprint !== digest)
        throw new HttpError(409, 'This source profile was imported with different content');
      return {
        applied: false,
        unchanged: true,
        sessions: prior.sessions as { sourceId: string; sessionId: string }[],
        memory: 0,
        skills: 0,
      };
    }
    const active = await tx
      .select({ id: agentRun.id })
      .from(agentRun)
      .where(and(eq(agentRun.agentId, agentId), eq(agentRun.status, 'pending')))
      .limit(1);
    const chats = await tx
      .select({ id: agentChatMessage.id })
      .from(agentChatMessage)
      .where(
        and(
          eq(agentChatMessage.agentId, agentId),
          inArray(agentChatMessage.status, ['pending', 'streaming']),
        ),
      )
      .limit(1);
    if (active.length || chats.length)
      throw new HttpError(409, 'Drain runs and chats before importing');
    const memories = await tx
      .selectDistinctOn([agentMemoryRevision.file])
      .from(agentMemoryRevision)
      .where(eq(agentMemoryRevision.agentId, agentId))
      .orderBy(agentMemoryRevision.file, desc(agentMemoryRevision.id));
    const newMemory = data.memory.filter((memory) => {
      const current = memories.find((row) => row.file === memory.file);
      if (current && current.content !== memory.content)
        throw new HttpError(409, `Existing memory differs: ${memory.file}`);
      return !current;
    });
    const skills = nativeSkills(agent.volitionLearnedSkills);
    const addedSkills = data.skills.filter((skill) => {
      const current = skills.find((row) => row.path === skill.path);
      if (
        current &&
        fingerprint([
          current.name,
          current.markdown,
          current.files.map((file) => [file.path, file.content]),
        ]) !==
          fingerprint([
            skill.name,
            skill.markdown,
            skill.files.map((file) => [file.path, file.content]),
          ])
      )
        throw new HttpError(409, `Existing skill differs: ${skill.path}`);
      return !current;
    });
    const mappings: { sourceId: string; sessionId: string }[] = [];
    for (const source of data.sessions) {
      const id = sessionId(agentId, source.id);
      const [existing] = await tx
        .select({ id: helenaAgentSession.id })
        .from(helenaAgentSession)
        .where(eq(helenaAgentSession.id, id));
      if (existing) throw new HttpError(409, `Session already exists: ${source.id}`);
      const [run] = await tx
        .select()
        .from(agentRun)
        .where(
          and(
            eq(agentRun.agentId, agentId),
            source.runId ? eq(agentRun.id, source.runId) : eq(agentRun.sessionId, source.id),
          ),
        )
        .limit(1);
      const [thread] = await tx
        .select({ id: agentChatThread.id, projectId: agentChatThread.projectId })
        .from(agentChatThread)
        .leftJoin(agentChatMessage, eq(agentChatMessage.threadId, agentChatThread.id))
        .where(
          and(
            eq(agentChatMessage.agentId, agentId),
            source.threadId
              ? eq(agentChatThread.id, source.threadId)
              : eq(agentChatMessage.sessionId, source.id),
          ),
        )
        .limit(1);
      const [legacyThread] = thread
        ? []
        : await tx
            .select({ id: agentChatThread.id, projectId: agentChatThread.projectId })
            .from(agentChatThread)
            .where(
              and(
                eq(agentChatThread.agentId, agentId),
                eq(agentChatThread.cliSessionId, source.id),
              ),
            )
            .limit(1);
      const chat = thread ?? legacyThread;
      if ((source.runId && !run) || (source.threadId && !chat))
        throw new HttpError(404, 'Import session link not found for this agent');
      if (run && chat) throw new HttpError(409, 'Session has ambiguous ownership');
      if (source.kind === 'chat' && !chat)
        throw new HttpError(409, 'A chat import requires its existing owner thread');
      mappings.push({ sourceId: source.id, sessionId: id });
      if (!apply) continue;
      let kind = 'reflection';
      if (chat) kind = 'chat';
      else if (run) kind = 'run';
      await tx.insert(helenaAgentSession).values({
        id,
        agentId,
        teamId,
        kind,
        projectId: chat?.projectId ?? run?.projectId ?? null,
        runId: run?.id ?? null,
        chatThreadId: chat?.id ?? null,
        model: source.model,
        importedFrom: { runtime: 'hermes', sourceKey: data.sourceKey, sessionId: source.id },
        createdAt: new Date(source.startedAt),
        updatedAt: new Date(source.updatedAt),
      });
      for (let offset = 0; offset < source.items.length; offset += 200) {
        const items = source.items.slice(offset, offset + 200).map((item, index) => ({
          sessionId: id,
          seq: offset + index + 1,
          step: 0,
          role: item.role,
          content: { role: item.role, content: item.content },
          text: item.text,
          createdAt: new Date(item.timestamp),
        }));
        if (items.length) await tx.insert(helenaAgentSessionItem).values(items);
      }
    }
    if (apply) {
      if (newMemory.length)
        await tx.insert(agentMemoryRevision).values(
          newMemory.map((memory) => ({
            agentId,
            file: memory.file,
            content: memory.content,
            sha256: createHash('sha256').update(memory.content).digest('hex'),
            source: 'observed',
          })),
        );
      const learned = [...skills, ...addedSkills];
      if (JSON.stringify(learned).length > 2 * 1024 * 1024)
        throw new HttpError(413, 'Learned skills exceed the native limit');
      const state = agent.runtimeState as AgentRuntimeState;
      const inventory = state.inventory ?? { toolsets: [], mcpServers: [], skills: [], memory: [] };
      await tx
        .update(aiAgent)
        .set({
          volitionLearnedSkills: learned,
          runtimeState: {
            ...state,
            inventory: {
              ...inventory,
              skills: [
                ...inventory.skills.filter((skill) => skill.origin !== 'agent'),
                ...learnedInventory(learned),
              ],
            },
          },
        })
        .where(eq(aiAgent.id, agentId));
      await tx
        .insert(volitionProfileImport)
        .values({ agentId, sourceKey: data.sourceKey, fingerprint: digest, sessions: mappings });
    }
    return {
      applied: apply,
      unchanged: false,
      sessions: mappings,
      memory: newMemory.length,
      skills: addedSkills.length,
    };
  });
  if (result.applied) {
    await reindexItems(
      agentSessionSource,
      result.sessions.map((session) => session.sessionId),
    ).catch(() => console.error('[volition-import] session indexing failed'));
    await reindexItems(
      agentMemorySource,
      data.memory.map((memory) => `${agentId}:${memory.file}`),
    ).catch(() => console.error('[volition-import] memory indexing failed'));
  }
  return result;
}
