import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { knowledgeItem } from '@repo/db';

// What one reader may see of the index: the resources their role reads in each project
// and in each team, and their own user id for private items. `*` stands for every
// resource. The API builds it from the same membership and role rules its routes check
// (see apps/api/src/modules/knowledge/reach.ts), so a search never shows an item the
// item's own page would refuse.
export const ANY_RESOURCE = '*';

export interface KnowledgeReach {
  userId: string;
  // project id → resources the reader reads there.
  projects: Map<number, ReadonlySet<string>>;
  // team id → resources the reader reads among the team's items of no project. A team
  // member who does not run the team gets an empty set: only items without a
  // permission (the shared templates).
  teams: Map<number, ReadonlySet<string>>;
}

export function emptyReach(userId: string): KnowledgeReach {
  return { userId, projects: new Map(), teams: new Map() };
}

function reads(resources: ReadonlySet<string>): SQL | undefined {
  if (resources.has(ANY_RESOURCE)) return undefined;
  const named = [...resources];
  return named.length > 0
    ? or(isNull(knowledgeItem.permission), inArray(knowledgeItem.permission, named))
    : isNull(knowledgeItem.permission);
}

// Groups the scopes that read the same resources, so the condition stays short for a
// reader of many projects.
function grouped(
  scopes: Map<number, ReadonlySet<string>>,
): Map<string, { ids: number[]; resources: ReadonlySet<string> }> {
  const groups = new Map<string, { ids: number[]; resources: ReadonlySet<string> }>();
  for (const [id, resources] of scopes) {
    const key = [...resources].sort().join('\u0000');
    const group = groups.get(key) ?? { ids: [], resources };
    group.ids.push(id);
    groups.set(key, group);
  }
  return groups;
}

// The rows of knowledge_item the reader may see, as one condition.
export function readableItems(reach: KnowledgeReach): SQL {
  const parts: SQL[] = [
    and(eq(knowledgeItem.visibility, 'private'), eq(knowledgeItem.ownerId, reach.userId))!,
  ];
  for (const { ids, resources } of grouped(reach.projects).values()) {
    parts.push(
      and(
        eq(knowledgeItem.visibility, 'project'),
        inArray(knowledgeItem.projectId, ids),
        reads(resources),
      )!,
    );
  }
  for (const { ids, resources } of grouped(reach.teams).values()) {
    parts.push(
      and(
        eq(knowledgeItem.visibility, 'team'),
        inArray(knowledgeItem.teamId, ids),
        reads(resources),
      )!,
    );
  }
  return or(...parts) ?? sql`false`;
}

// The same rule for one item in memory (reading an item by its ref).
export function canRead(
  reach: KnowledgeReach,
  item: {
    visibility: string;
    ownerId: string | null;
    projectId: number | null;
    teamId: number;
    permission: string | null;
  },
): boolean {
  const allows = (resources: ReadonlySet<string> | undefined) =>
    !!resources &&
    (resources.has(ANY_RESOURCE) || item.permission === null || resources.has(item.permission));
  switch (item.visibility) {
    case 'private':
      return item.ownerId === reach.userId;
    case 'project':
      return item.projectId !== null && allows(reach.projects.get(item.projectId));
    case 'team':
      return allows(reach.teams.get(item.teamId));
    default:
      return false;
  }
}
