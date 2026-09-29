import { and, desc, eq, exists, ilike, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { containsPattern, db, noteBoard, noteBoardMember, project } from '@repo/db';
import type { KnowledgeReach } from '@helena/knowledge';
import { getNoteBoard } from '#modules/note-boards/service';
import { HttpError } from '#shared/lib';

// Private and restricted canvases live in the database. Public canvases already have
// canonical vault files in the knowledge index; their second result is omitted here.
export async function privateBoardHits(
  reach: KnowledgeReach,
  q: string,
  limit: number,
  projectId?: number,
) {
  const ids = [...reach.projects]
    .filter(
      ([id, permissions]) =>
        permissions.has('note_boards') && (projectId === undefined || id === projectId),
    )
    .map(([id]) => id);
  if (!ids.length) return [];
  const visible = or(
    eq(noteBoard.ownerUserId, reach.userId),
    exists(
      db
        .select({ one: sql`1` })
        .from(noteBoardMember)
        .where(
          and(eq(noteBoardMember.boardId, noteBoard.id), eq(noteBoardMember.userId, reach.userId)),
        ),
    ),
  );
  const match = q
    ? or(
        ilike(noteBoard.name, containsPattern(q)),
        sql`${noteBoard.canvas}::text ilike ${containsPattern(q)}`,
      )
    : undefined;
  const rows = await db
    .select({ board: noteBoard, key: project.key })
    .from(noteBoard)
    .innerJoin(project, eq(project.id, noteBoard.projectId))
    .where(
      and(
        inArray(noteBoard.projectId, ids),
        eq(project.notesEnabled, true),
        isNotNull(noteBoard.ownerUserId),
        visible,
        match,
      ),
    )
    .orderBy(desc(noteBoard.updatedAt))
    .limit(limit);
  return rows.map(({ board, key }) => ({
    ref: `board:${board.id}`,
    source: 'board',
    id: String(board.id),
    title: board.name,
    snippet: JSON.stringify(board.canvas).slice(0, 240),
    href: `/project/${encodeURIComponent(key)}/files?view=boards&board=${board.id}`,
    projectKey: key,
    updatedAt: board.updatedAt.toISOString(),
  }));
}

export async function attachedPrivateBoard(
  id: string,
  person: KnowledgeReach,
  agent: KnowledgeReach,
  agentTeamId: number,
) {
  const boardId = Number(id);
  if (!Number.isSafeInteger(boardId) || boardId <= 0) throw new HttpError(404, 'Board not found');
  const board = await getNoteBoard(boardId);
  if (!board || board.ownerUserId === null) throw new HttpError(404, 'Board not found');
  const [scope] = await db
    .select({ key: project.key, teamId: project.teamId, notesEnabled: project.notesEnabled })
    .from(project)
    .where(eq(project.id, board.projectId));
  if (
    !scope?.notesEnabled ||
    scope.teamId !== agentTeamId ||
    !person.projects.get(board.projectId)?.has('note_boards') ||
    !agent.projects.has(board.projectId) ||
    (board.ownerUserId !== person.userId && !board.memberIds.includes(person.userId))
  )
    throw new HttpError(404, 'Board not found');
  return {
    kind: 'knowledge' as const,
    ref: `board:${board.id}`,
    source: 'board',
    title: board.name,
    href: `/project/${encodeURIComponent(scope.key)}/files?view=boards&board=${board.id}`,
    snapshot: JSON.stringify(board.canvas).slice(0, 20_000),
  };
}
