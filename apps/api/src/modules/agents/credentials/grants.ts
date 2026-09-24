import {
  db,
  aiAgent,
  integrationCredential,
  integrationCredentialGrant,
  project,
  projectMember,
  user,
} from '@repo/db';
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { agentWorksInProject } from '../core/service';

// The one grant system of the access center. A grant lets one agent, or every agent that
// works in one project, use a credential: a web login, API key, SSH key or secret, or a
// connector account such as a Google account. On an account it can be narrowed to one of
// its services ('mail', 'calendar' …) and to reading ('read' allows only actions of the
// read category; 'write' allows every action, which the policy may still send to the
// owner for approval). A credential limited to a project is granted only there.

export type GrantAccess = 'read' | 'write';

export interface GrantEntry {
  id: number;
  agentId: number | null;
  agentName: string | null;
  projectId: number | null;
  projectKey: string | null;
  service: string | null;
  access: GrantAccess;
}

export interface GrantInput {
  agentId?: number | null;
  projectId?: number | null;
  service?: string | null;
  access?: GrantAccess;
}

export async function grantsOf(credentialIds: number[]): Promise<Map<number, GrantEntry[]>> {
  const byCredential = new Map<number, GrantEntry[]>();
  if (credentialIds.length === 0) return byCredential;
  const rows = await db
    .select({
      id: integrationCredentialGrant.id,
      credentialId: integrationCredentialGrant.credentialId,
      agentId: integrationCredentialGrant.agentId,
      agentName: user.name,
      projectId: integrationCredentialGrant.projectId,
      projectKey: project.key,
      service: integrationCredentialGrant.service,
      access: integrationCredentialGrant.access,
    })
    .from(integrationCredentialGrant)
    .leftJoin(aiAgent, eq(aiAgent.id, integrationCredentialGrant.agentId))
    .leftJoin(user, eq(user.id, aiAgent.userId))
    .leftJoin(project, eq(project.id, integrationCredentialGrant.projectId))
    .where(inArray(integrationCredentialGrant.credentialId, credentialIds))
    .orderBy(integrationCredentialGrant.id);
  for (const { credentialId, ...row } of rows) {
    const list = byCredential.get(credentialId) ?? [];
    list.push({ ...row, access: row.access as GrantAccess });
    byCredential.set(credentialId, list);
  }
  return byCredential;
}

interface GrantTarget {
  id: number;
  teamId: number;
  projectId: number | null;
  projectKey: string | null;
  // The services a grant may name; empty for a credential without services.
  services: readonly string[];
  // A runtime login signs in one runtime (claude, codex): an agent granted it by name
  // has to run on it. A project grant reaches only that project's agents on it.
  runtime?: string | null;
}

function sameGrant(left: GrantInput, right: GrantInput): boolean {
  return (
    (left.agentId ?? null) === (right.agentId ?? null) &&
    (left.projectId ?? null) === (right.projectId ?? null) &&
    (left.service ?? null) === (right.service ?? null)
  );
}

// Checks every grant against the team, the credential's project and its services, and
// returns them normalized. A later duplicate of the same subject and service replaces the
// earlier one.
async function validGrants(target: GrantTarget, grants: GrantInput[]): Promise<GrantInput[]> {
  const out: GrantInput[] = [];
  for (const grant of grants) {
    const agentId = grant.agentId ?? null;
    const projectId = grant.projectId ?? null;
    if ((agentId === null) === (projectId === null)) {
      throw new HttpError(400, 'A grant names either an agent or a project.');
    }
    const service = grant.service ?? null;
    if (service !== null && !target.services.includes(service)) {
      throw new HttpError(400, `This credential has no service ${service}.`);
    }
    const normalized: GrantInput = {
      agentId,
      projectId,
      service: target.services.length > 0 ? service : null,
      access: grant.access === 'read' ? 'read' : 'write',
    };
    const index = out.findIndex((entry) => sameGrant(entry, normalized));
    if (index >= 0) out.splice(index, 1);
    out.push(normalized);
  }
  const agentIds = [...new Set(out.flatMap((grant) => (grant.agentId ? [grant.agentId] : [])))];
  if (agentIds.length > 0) {
    const agents = await db
      .select({
        id: aiAgent.id,
        name: user.name,
        kind: aiAgent.kind,
        template: aiAgent.template,
        runtime: sql<string | null>`${aiAgent.runtimePolicy}->>'runtime'`,
      })
      .from(aiAgent)
      .innerJoin(user, eq(user.id, aiAgent.userId))
      .where(and(eq(aiAgent.teamId, target.teamId), inArray(aiAgent.id, agentIds)));
    if (agents.length !== agentIds.length)
      throw new HttpError(400, 'An agent is not of this team.');
    for (const agent of agents) {
      if (agent.kind !== 'external' || agent.template) {
        throw new HttpError(400, `${agent.name} does not run in a runner.`);
      }
      if (target.runtime && (agent.runtime ?? 'hermes') !== target.runtime) {
        throw new HttpError(400, `${agent.name} does not run on ${target.runtime}.`);
      }
      if (target.projectId !== null && !(await agentWorksInProject(agent.id, target.projectId))) {
        throw new HttpError(400, `${agent.name} does not work in ${target.projectKey}.`);
      }
    }
  }
  const projectIds = [
    ...new Set(out.flatMap((grant) => (grant.projectId ? [grant.projectId] : []))),
  ];
  if (projectIds.length > 0) {
    const rows = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.teamId, target.teamId), inArray(project.id, projectIds)));
    if (rows.length !== projectIds.length) {
      throw new HttpError(400, 'A project is not of this team.');
    }
    if (target.projectId !== null && projectIds.some((id) => id !== target.projectId)) {
      throw new HttpError(400, `This credential is limited to ${target.projectKey}.`);
    }
  }
  return out;
}

// Replaces every grant of a credential.
export async function replaceGrants(target: GrantTarget, grants: GrantInput[]): Promise<void> {
  const valid = await validGrants(target, grants);
  await db.transaction(async (tx) => {
    await tx
      .delete(integrationCredentialGrant)
      .where(eq(integrationCredentialGrant.credentialId, target.id));
    if (valid.length > 0) {
      await tx.insert(integrationCredentialGrant).values(
        valid.map((grant) => ({
          credentialId: target.id,
          agentId: grant.agentId ?? null,
          projectId: grant.projectId ?? null,
          service: grant.service ?? null,
          access: grant.access ?? 'write',
        })),
      );
    }
  });
}

// A credential moved to a project keeps only the grants that still fit there: its agents
// that work there, and a grant to that project.
export async function pruneGrantsOutside(
  credentialId: number,
  projectId: number,
  tx: Pick<typeof db, 'delete'> = db,
): Promise<void> {
  await tx
    .delete(integrationCredentialGrant)
    .where(
      and(
        eq(integrationCredentialGrant.credentialId, credentialId),
        or(
          and(
            sql`${integrationCredentialGrant.projectId} is not null`,
            sql`${integrationCredentialGrant.projectId} <> ${projectId}`,
          ),
          and(
            sql`${integrationCredentialGrant.agentId} is not null`,
            sql`not exists (select 1 from ${aiAgent} a join ${projectMember} pm on pm.user_id = a.user_id where a.id = ${integrationCredentialGrant.agentId} and pm.project_id = ${projectId})`,
          ),
        ),
      ),
    );
}

// Who is asking, for the grant lookups below: the agent and its member id, and the
// project its run works in. A chat answer has no project: then a grant to any project the
// agent works in counts.
export interface GrantSubject {
  agentId: number;
  userId: string;
  projectId: number | null;
}

// The grants that reach the subject.
export function grantReaches(subject: GrantSubject): SQL {
  const byProject =
    subject.projectId !== null
      ? eq(integrationCredentialGrant.projectId, subject.projectId)
      : sql`${integrationCredentialGrant.projectId} in (select ${projectMember.projectId} from ${projectMember} where ${projectMember.userId} = ${subject.userId})`;
  return or(eq(integrationCredentialGrant.agentId, subject.agentId), byProject)!;
}

// A credential limited to a project reaches a run in that project, and a chat answer of an
// agent that works there.
export function credentialInScope(subject: GrantSubject): SQL {
  const projectId = integrationCredential.projectId;
  return or(
    isNull(projectId),
    subject.projectId !== null
      ? eq(projectId, subject.projectId)
      : sql`exists (select 1 from ${projectMember} where ${projectMember.projectId} = ${projectId} and ${projectMember.userId} = ${subject.userId})`,
  )!;
}

export interface EffectiveGrant {
  credentialId: number;
  // The access per service; the key '' holds a grant to every service.
  access: Map<string, GrantAccess>;
}

// What the subject may do with each credential it reaches: per service, the widest
// access any of its grants gives.
export async function effectiveGrants(
  subject: GrantSubject,
  filter: { kinds?: string[]; credentialIds?: number[] } = {},
): Promise<Map<number, EffectiveGrant>> {
  const rows = await db
    .select({
      credentialId: integrationCredentialGrant.credentialId,
      service: integrationCredentialGrant.service,
      access: integrationCredentialGrant.access,
    })
    .from(integrationCredentialGrant)
    .innerJoin(
      integrationCredential,
      eq(integrationCredential.id, integrationCredentialGrant.credentialId),
    )
    .innerJoin(aiAgent, eq(aiAgent.id, subject.agentId))
    .where(
      and(
        eq(integrationCredential.teamId, aiAgent.teamId),
        grantReaches(subject),
        credentialInScope(subject),
        filter.kinds ? inArray(integrationCredential.integrationKey, filter.kinds) : undefined,
        filter.credentialIds
          ? inArray(
              integrationCredential.id,
              filter.credentialIds.length ? filter.credentialIds : [-1],
            )
          : undefined,
      ),
    );
  const out = new Map<number, EffectiveGrant>();
  for (const row of rows) {
    const entry = out.get(row.credentialId) ?? {
      credentialId: row.credentialId,
      access: new Map(),
    };
    const key = row.service ?? '';
    const access = row.access as GrantAccess;
    if (entry.access.get(key) !== 'write') entry.access.set(key, access);
    out.set(row.credentialId, entry);
  }
  return out;
}

// The access a grant set gives to one service, or null when it gives none.
export function accessTo(
  grant: EffectiveGrant | undefined,
  service: string | null,
): GrantAccess | null {
  if (!grant) return null;
  const all = grant.access.get('');
  const own = service ? grant.access.get(service) : undefined;
  if (all === 'write' || own === 'write') return 'write';
  return all ?? own ?? null;
}

// Whether the agent may use any web login, in any run or chat answer: the runner then
// keeps the logins in sync.
export async function hasWebLoginGrant(agentId: number): Promise<boolean> {
  const [agent] = await db
    .select({ userId: aiAgent.userId })
    .from(aiAgent)
    .where(eq(aiAgent.id, agentId));
  if (!agent) return false;
  const [row] = await db
    .select({ id: integrationCredential.id })
    .from(integrationCredentialGrant)
    .innerJoin(
      integrationCredential,
      and(
        eq(integrationCredential.id, integrationCredentialGrant.credentialId),
        eq(integrationCredential.integrationKey, 'web_login'),
      ),
    )
    .where(grantReaches({ agentId, userId: agent.userId, projectId: null }))
    .limit(1);
  return Boolean(row);
}
