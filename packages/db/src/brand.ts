import { and, eq, inArray } from 'drizzle-orm';
import { db } from './client';
import { aiAgent } from './schema/app';
import { user } from './schema/auth';
import { getSetting, setSetting } from './settings';

export const DEFAULT_DISPLAY_NAME = 'Ava';
export const DISPLAY_NAME_SETTING_KEY = 'brand.displayName';

export function validDisplayName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 40 &&
    /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .&_-]*$/u.test(value) &&
    value === value.trim()
  );
}

export async function getDisplayName(): Promise<string> {
  const stored = await getSetting<unknown>(DISPLAY_NAME_SETTING_KEY);
  if (validDisplayName(stored)) return stored;
  const fallback = process.env.APP_NAME;
  return validDisplayName(fallback) ? fallback : DEFAULT_DISPLAY_NAME;
}

export async function setDisplayName(value: string): Promise<string> {
  if (!validDisplayName(value)) throw new Error('Invalid display name');
  const previous = await getDisplayName();
  await setSetting(DISPLAY_NAME_SETTING_KEY, value);
  // The Home agent follows the instance name while its visible name still has the
  // previous default. An owner who named that agent separately keeps their choice.
  await db
    .update(user)
    .set({ name: value })
    .where(
      and(
        eq(user.name, previous),
        inArray(
          user.id,
          db.select({ id: aiAgent.userId }).from(aiAgent).where(eq(aiAgent.agentRole, 'home')),
        ),
      ),
    );
  const homeAgents = await db
    .select({
      id: aiAgent.id,
      instructions: aiAgent.instructions,
      runtimePolicy: aiAgent.runtimePolicy,
    })
    .from(aiAgent)
    .where(eq(aiAgent.agentRole, 'home'));
  for (const agent of homeAgents) {
    const instructionPrefix = `Du bist ${previous}, der Home-Agent`;
    if (agent.instructions?.startsWith(instructionPrefix))
      await db
        .update(aiAgent)
        .set({
          instructions: `Du bist ${value}, der Home-Agent${agent.instructions.slice(instructionPrefix.length)}`,
        })
        .where(eq(aiAgent.id, agent.id));
    const policy = agent.runtimePolicy as Record<string, unknown>;
    if (!Array.isArray(policy.files)) continue;
    let changed = false;
    const files = policy.files.map((file: unknown) => {
      if (!file || typeof file !== 'object') return file;
      const entry = file as Record<string, unknown>;
      const prefix = `Du bist ${previous}, der Home-Agent.`;
      if (entry.path !== 'SOUL.md' || typeof entry.content !== 'string') return file;
      if (!entry.content.startsWith(prefix)) return file;
      changed = true;
      return {
        ...entry,
        content: `Du bist ${value}, der Home-Agent.` + entry.content.slice(prefix.length),
      };
    });
    if (changed)
      await db
        .update(aiAgent)
        .set({ runtimePolicy: { ...policy, files } })
        .where(eq(aiAgent.id, agent.id));
  }
  return value;
}
