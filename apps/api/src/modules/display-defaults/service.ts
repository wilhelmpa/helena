import { db, project, userPreference } from '@repo/db';
import { eq } from 'drizzle-orm';

// The fields task views show by default (docs/design-system.md, "Felder"): a project's own
// default and the member's default for every project, both stored as { layout: [keys] }.
// A view that was never changed follows them; a saved view keeps what it stored.
export type FieldDefaults = {
  kanban?: string[];
  list?: string[];
  table?: string[];
  calendar?: string[];
};

const LAYOUTS = ['kanban', 'list', 'table', 'calendar'] as const;

// Only the known layouts, each once, without repeated keys; nothing left means no default.
function clean(defaults: FieldDefaults | null): FieldDefaults | null {
  if (!defaults) return null;
  const out: FieldDefaults = {};
  for (const layout of LAYOUTS) {
    const keys = defaults[layout];
    if (keys) out[layout] = [...new Set(keys)];
  }
  return Object.keys(out).length ? out : null;
}

export async function getDisplayDefaults(projectId: number, userId: string) {
  const [[row], [prefs]] = await Promise.all([
    db.select({ defaults: project.displayDefaults }).from(project).where(eq(project.id, projectId)),
    db
      .select({ defaults: userPreference.fieldDefaults })
      .from(userPreference)
      .where(eq(userPreference.userId, userId)),
  ]);
  return {
    project: (row?.defaults as FieldDefaults | null | undefined) ?? null,
    global: (prefs?.defaults as FieldDefaults | null | undefined) ?? null,
  };
}

export async function setProjectDisplayDefaults(projectId: number, defaults: FieldDefaults | null) {
  await db
    .update(project)
    .set({ displayDefaults: clean(defaults) })
    .where(eq(project.id, projectId));
}

export async function setGlobalDisplayDefaults(userId: string, defaults: FieldDefaults | null) {
  const value = clean(defaults);
  await db
    .insert(userPreference)
    .values({ userId, fieldDefaults: value })
    .onConflictDoUpdate({
      target: userPreference.userId,
      set: { fieldDefaults: value, updatedAt: new Date() },
    });
}
