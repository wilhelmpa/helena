import { db, chatPrompt, project, projectMember } from '@repo/db';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { HttpError, iso, rethrowDuplicate } from '#shared/lib';

// A member's saved chat prompts. They belong to the member alone: Home ones are offered
// in every chat, a project's only in its chats, and only while the member is in it.

export interface ChatPromptDTO {
  id: number;
  command: string;
  title: string;
  content: string;
  project: { key: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

const columns = {
  id: chatPrompt.id,
  command: chatPrompt.command,
  title: chatPrompt.title,
  content: chatPrompt.content,
  projectKey: project.key,
  projectName: project.name,
  createdAt: chatPrompt.createdAt,
  updatedAt: chatPrompt.updatedAt,
};

type Row = {
  id: number;
  command: string;
  title: string;
  content: string;
  projectKey: string | null;
  projectName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function dto(row: Row): ChatPromptDTO {
  return {
    id: row.id,
    command: row.command,
    title: row.title,
    content: row.content,
    project: row.projectKey ? { key: row.projectKey, name: row.projectName! } : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

// The project of a key the member is in, or a 404.
async function memberProject(userId: string, key: string): Promise<number> {
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .innerJoin(
      projectMember,
      and(eq(projectMember.projectId, project.id), eq(projectMember.userId, userId)),
    )
    .where(eq(project.key, key));
  if (!row) throw new HttpError(404, 'Project not found');
  return row.id;
}

export async function listChatPrompts(
  userId: string,
  projectKey?: string,
): Promise<ChatPromptDTO[]> {
  const projectId = projectKey ? await memberProject(userId, projectKey) : null;
  const rows = await db
    .select(columns)
    .from(chatPrompt)
    .leftJoin(project, eq(project.id, chatPrompt.projectId))
    .where(
      and(
        eq(chatPrompt.userId, userId),
        projectId == null
          ? isNull(chatPrompt.projectId)
          : or(isNull(chatPrompt.projectId), eq(chatPrompt.projectId, projectId)),
      ),
    )
    .orderBy(asc(chatPrompt.command));
  return rows.map(dto);
}

async function readPrompt(userId: string, id: number): Promise<ChatPromptDTO | null> {
  const [row] = await db
    .select(columns)
    .from(chatPrompt)
    .leftJoin(project, eq(project.id, chatPrompt.projectId))
    .where(and(eq(chatPrompt.id, id), eq(chatPrompt.userId, userId)));
  return row ? dto(row) : null;
}

export async function createChatPrompt(
  userId: string,
  input: { command: string; title: string; content: string; projectKey?: string },
): Promise<ChatPromptDTO> {
  const projectId = input.projectKey ? await memberProject(userId, input.projectKey) : null;
  try {
    const [row] = await db
      .insert(chatPrompt)
      .values({
        userId,
        projectId,
        command: input.command,
        title: input.title,
        content: input.content,
      })
      .returning({ id: chatPrompt.id });
    return (await readPrompt(userId, row.id))!;
  } catch (err) {
    rethrowDuplicate(err, 'prompt');
  }
}

export async function updateChatPrompt(
  userId: string,
  id: number,
  patch: { command?: string; title?: string; content?: string },
): Promise<ChatPromptDTO | null> {
  try {
    const rows = await db
      .update(chatPrompt)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(chatPrompt.id, id), eq(chatPrompt.userId, userId)))
      .returning({ id: chatPrompt.id });
    if (rows.length === 0) return null;
  } catch (err) {
    rethrowDuplicate(err, 'prompt');
  }
  return readPrompt(userId, id);
}

export async function deleteChatPrompt(userId: string, id: number): Promise<boolean> {
  const rows = await db
    .delete(chatPrompt)
    .where(and(eq(chatPrompt.id, id), eq(chatPrompt.userId, userId)))
    .returning({ id: chatPrompt.id });
  return rows.length > 0;
}
