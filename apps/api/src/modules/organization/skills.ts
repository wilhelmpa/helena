import {
  agentSkill,
  db,
  organizationAgentAssignment,
  organizationDepartment,
  organizationDepartmentSkill,
} from '@repo/db';
import { and, eq, inArray } from 'drizzle-orm';
import { HttpError } from '#shared/lib';

export async function departmentSkills(teamId: number, departmentId: number) {
  const [department] = await db
    .select({
      id: organizationDepartment.id,
      restricted: organizationDepartment.skillsRestricted,
    })
    .from(organizationDepartment)
    .where(
      and(eq(organizationDepartment.id, departmentId), eq(organizationDepartment.teamId, teamId)),
    );
  if (!department) throw new HttpError(404, 'Department not found');
  const rows = await db
    .select({ id: agentSkill.id, name: agentSkill.name })
    .from(organizationDepartmentSkill)
    .innerJoin(agentSkill, eq(agentSkill.id, organizationDepartmentSkill.skillId))
    .where(eq(organizationDepartmentSkill.departmentId, departmentId))
    .orderBy(agentSkill.name);
  return { restricted: department.restricted, skills: rows };
}

export async function setDepartmentSkills(
  teamId: number,
  departmentId: number,
  input: { restricted: boolean; skillIds: number[] },
) {
  const ids = [...new Set(input.skillIds)];
  await db.transaction(async (tx) => {
    const [department] = await tx
      .select({ id: organizationDepartment.id })
      .from(organizationDepartment)
      .where(
        and(eq(organizationDepartment.id, departmentId), eq(organizationDepartment.teamId, teamId)),
      );
    if (!department) throw new HttpError(404, 'Department not found');
    const valid = ids.length
      ? await tx
          .select({ id: agentSkill.id })
          .from(agentSkill)
          .where(and(eq(agentSkill.teamId, teamId), inArray(agentSkill.id, ids)))
      : [];
    if (valid.length !== ids.length) throw new HttpError(400, 'Unknown team skill');
    await tx
      .update(organizationDepartment)
      .set({ skillsRestricted: input.restricted, updatedAt: new Date() })
      .where(eq(organizationDepartment.id, departmentId));
    await tx
      .delete(organizationDepartmentSkill)
      .where(eq(organizationDepartmentSkill.departmentId, departmentId));
    if (ids.length)
      await tx
        .insert(organizationDepartmentSkill)
        .values(ids.map((skillId) => ({ departmentId, skillId })));
  });
  return departmentSkills(teamId, departmentId);
}

export async function allowedSkillIds(agentId: number): Promise<Set<number> | null> {
  const [assignment] = await db
    .select({
      departmentId: organizationAgentAssignment.departmentId,
      restricted: organizationDepartment.skillsRestricted,
    })
    .from(organizationAgentAssignment)
    .innerJoin(
      organizationDepartment,
      eq(organizationDepartment.id, organizationAgentAssignment.departmentId),
    )
    .where(eq(organizationAgentAssignment.agentId, agentId));
  if (!assignment?.restricted || assignment.departmentId === null) return null;
  const rows = await db
    .select({ skillId: organizationDepartmentSkill.skillId })
    .from(organizationDepartmentSkill)
    .where(eq(organizationDepartmentSkill.departmentId, assignment.departmentId));
  return new Set(rows.map((row) => row.skillId));
}

export async function assertAllowedSkills(agentId: number, ids: number[]): Promise<void> {
  const allowed = await allowedSkillIds(agentId);
  if (allowed && ids.some((id) => !allowed.has(id)))
    throw new HttpError(403, 'A skill is blocked by the department policy');
}
