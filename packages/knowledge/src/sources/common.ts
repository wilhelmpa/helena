import { and, asc, eq, inArray } from 'drizzle-orm';
import { aiAgent, db, team, teamMember, user } from '@repo/db';
import type { KnowledgeListContext } from '@helena/sdk';

// What the built-in sources share: paging, the instance owner and Home's team, authors
// as `user:`/`agent:` refs, and the routes items open at. The routes are the web app's
// (apps/web/src/utils/paths.ts).

export const PAGE_LIMIT = 500;

export function pageLimit(ctx: KnowledgeListContext): number {
  return Math.max(1, Math.min(ctx.limit || PAGE_LIMIT, PAGE_LIMIT));
}

// Sources page by their numeric row id; the cursor is the last id of the page.
export function cursorId(ctx: KnowledgeListContext): number {
  const value = Number(ctx.cursor ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function nextCursor<T>(rows: T[], limit: number, idOf: (row: T) => number): string | null {
  return rows.length < limit ? null : String(idOf(rows[rows.length - 1]!));
}

export function numericIds(ids: string[]): number[] {
  return ids.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
}

export function iso(value: Date | string | null | undefined, fallback: Date = new Date(0)): string {
  if (!value) return fallback.toISOString();
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export interface InstanceHome {
  // The instance owner (the Administrator account): Private/ is theirs.
  ownerId: string | null;
  // The team Home and the vault's Home/ belong to: the one the owner owns, else the
  // oldest.
  teamId: number | null;
}

export async function instanceHome(): Promise<InstanceHome> {
  const [owner] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.role, 'god'))
    .orderBy(asc(user.createdAt))
    .limit(1);
  let teamId: number | null = null;
  if (owner) {
    const [owned] = await db
      .select({ teamId: teamMember.teamId })
      .from(teamMember)
      .where(and(eq(teamMember.userId, owner.id), eq(teamMember.role, 'owner')))
      .orderBy(asc(teamMember.teamId))
      .limit(1);
    teamId = owned?.teamId ?? null;
  }
  if (teamId === null) {
    const [first] = await db.select({ id: team.id }).from(team).orderBy(asc(team.id)).limit(1);
    teamId = first?.id ?? null;
  }
  return { ownerId: owner?.id ?? null, teamId };
}

// `agent:<id>` for an agent's bot user, `user:<id>` for a person.
export async function authorRefs(userIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  const refs = new Map(ids.map((id) => [id, `user:${id}`]));
  if (ids.length === 0) return refs;
  const agents = await db
    .select({ id: aiAgent.id, userId: aiAgent.userId })
    .from(aiAgent)
    .where(inArray(aiAgent.userId, ids));
  for (const agent of agents) refs.set(agent.userId, `agent:${agent.id}`);
  return refs;
}

const enc = encodeURIComponent;

export const routes = {
  issue: (key: string, sequence: number) => `/project/${enc(key)}/issue/${sequence}`,
  note: (relative: string) => {
    const [top, key] = relative.split('/');
    const base = top === 'Projects' && key ? `/project/${enc(key)}/docs` : '/docs';
    return `${base}?path=${enc(relative)}`;
  },
  // The Files page takes the folder and the file relative to the root it shows: a
  // project's folder, or Home, Private or Templates on the Home page.
  file: (relative: string) => {
    const [top, key, ...rest] = relative.split('/');
    const query = new URLSearchParams();
    if (top === 'Projects' && key) {
      const folder = rest.slice(0, -1).join('/');
      if (folder) query.set('path', folder);
      query.set('file', rest.join('/'));
      return `/project/${enc(key)}/files?${query}`;
    }
    const roots: Record<string, string> = { Private: 'private', Templates: 'templates' };
    const inner = relative.split('/').slice(top === 'Home' || roots[top] ? 1 : 0);
    if (roots[top]) query.set('root', roots[top]);
    const folder = inner.slice(0, -1).join('/');
    if (folder) query.set('path', folder);
    query.set('file', inner.join('/'));
    return `/files?${query}`;
  },
  board: (relative: string) => {
    const [top, key] = relative.split('/');
    return top === 'Projects' && key
      ? `/project/${enc(key)}/notes?canvas=${enc(relative)}`
      : routes.file(relative);
  },
  mail: (key: string | null, threadId: number) =>
    key ? `/project/${enc(key)}/inbox?thread=${threadId}` : `/inbox?thread=${threadId}`,
  chat: (key: string | null, agentId: number, threadId: string) => {
    const query = new URLSearchParams({ agent: String(agentId), thread: threadId });
    return key ? `/project/${enc(key)}/chat?${query}` : `/chat?${query}`;
  },
  activity: (key: string, agentId: number) =>
    `/project/${enc(key)}/activity?${new URLSearchParams({ agent: String(agentId) })}`,
};
