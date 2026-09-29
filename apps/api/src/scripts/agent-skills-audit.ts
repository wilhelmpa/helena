import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type postgres from 'postgres';
import { auditAgent, type AuditAgent, type PoolRole } from '../modules/agents/core/skills-audit';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const value = (name: string) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const result = args[index + 1];
  if (!result || result.startsWith('--')) throw new Error(`Missing value for ${name}`);
  return result;
};
const snapshotPath = value('--snapshot');
const pool = fileURLToPath(new URL('../../../../bundles/agent-pool/agents/', import.meta.url));
const roles: PoolRole[] = await Promise.all(
  (await readdir(pool))
    .filter((name) => name.endsWith('.md'))
    .map(async (name) => {
      const markdown = await readFile(`${pool}/${name}`, 'utf8');
      const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!match) throw new Error(`Invalid pool role: ${name}`);
      const metadata = Bun.YAML.parse(match[1]!) as { name: string; skills: string[] };
      return { name: metadata.name, skills: metadata.skills, instructions: match[2]!.trim() };
    }),
);

interface Snapshot {
  agents: AuditAgent[];
  library: { id: number; teamId: number; name: string }[];
}
let snapshot: Snapshot;
let database: postgres.Sql | undefined;
try {
  if (snapshotPath) {
    if (apply) throw new Error('--snapshot is a read-only copy; --apply requires a database');
    snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as Snapshot;
  } else {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('Provide --snapshot COPY.json or DATABASE_URL (dry run by default)');
    const postgres = (await import('postgres')).default;
    database = postgres(url, { max: 1, prepare: false });
    const agents = await database<AuditAgent[]>`
    select a.id, a.team_id as "teamId", u.name, a.username, a.template,
      a.source_template_id as "sourceTemplateId", a.template_overrides as "templateOverrides",
      a.instructions, a.runtime_policy as "runtimePolicy",
      (select case when d.skills_restricted then coalesce((select jsonb_agg(ds.skill_id) from organization_department_skill ds where ds.department_id = d.id), '[]') else null end from organization_agent_assignment oa join organization_department d on d.id = oa.department_id where oa.agent_id = a.id) as "allowedSkillIds",
      jsonb_build_object('role', (select nullif(oa.role_title, '') from organization_agent_assignment oa where oa.agent_id = a.id)) as context,
      coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name)) from agent_skill_link l join agent_skill s on s.id = l.skill_id where l.agent_id = a.id), '[]') as skills,
      coalesce((select jsonb_agg(l.agent_tool_id) from agent_tool_link l where l.agent_id = a.id), '[]') as tools,
      coalesce((select jsonb_agg(jsonb_build_object('key', p.key, 'instructions', m.description)) from project_member m join project p on p.id = m.project_id where m.user_id = a.user_id and p.team_id = a.team_id), '[]') as projects
    from ai_agent a join "user" u on u.id = a.user_id order by a.id`;
    snapshot = {
      agents,
      library: await database`select id, team_id as "teamId", name from agent_skill`,
    };
  }

  const reports = snapshot.agents.map((agent) => auditAgent(agent, snapshot.agents, roles));
  const rows = [];
  for (const report of reports) {
    const agent = snapshot.agents.find((entry) => entry.id === report.agentId)!;
    const skills = report.addSkills.flatMap((name) => {
      const matches = snapshot.library.filter(
        (skill) => skill.teamId === agent.teamId && skill.name === name,
      );
      if (matches.length !== 1) {
        report.findings.push(`Skill ${name}: library entry absent or ambiguous`);
        return [];
      }
      if (agent.allowedSkillIds && !agent.allowedSkillIds.includes(matches[0]!.id)) {
        report.findings.push(`Skill ${name}: blocked by department policy`);
        return [];
      }
      const disabled = agent.runtimePolicy.skillsDisabled ?? [];
      if (
        disabled.includes(`plan-${matches[0]!.id}`) ||
        disabled.includes(String(matches[0]!.id))
      ) {
        report.findings.push(`Skill ${name}: explicitly disabled by owner`);
        return [];
      }
      return matches;
    });
    const added: string[] = [];
    if (apply && database) {
      await database.begin(async (tx) => {
        // Refuse a stale target so owner edits made during the audit survive.
        const current =
          await tx`select runtime_policy, template_overrides, instructions, source_template_id from ai_agent where id = ${agent.id} for update`;
        const row = current[0];
        if (
          !row ||
          JSON.stringify(row.runtime_policy) !== JSON.stringify(agent.runtimePolicy) ||
          JSON.stringify(row.template_overrides) !== JSON.stringify(agent.templateOverrides) ||
          row.instructions !== agent.instructions ||
          row.source_template_id !== agent.sourceTemplateId
        )
          throw new Error(`Agent ${agent.id} changed; rerun the audit`);
        for (const skill of skills) {
          const inserted =
            await tx`insert into agent_skill_link(agent_id, skill_id) select ${agent.id}, ${skill.id} where not exists (
              select 1 from organization_agent_assignment oa join organization_department d on d.id = oa.department_id
              where oa.agent_id = ${agent.id} and d.skills_restricted and not exists (
                select 1 from organization_department_skill ds where ds.department_id = d.id and ds.skill_id = ${skill.id}
              )
            ) on conflict do nothing returning skill_id`;
          if (inserted.length) added.push(skill.name);
        }
        for (const id of report.addTools)
          await tx`insert into agent_tool_link(agent_id, agent_tool_id) values (${agent.id}, ${id}) on conflict do nothing`;
        const policy = {
          ...agent.runtimePolicy,
          ...(report.addGrants.length && {
            toolAllow: [...(agent.runtimePolicy.toolAllow ?? []), ...report.addGrants],
          }),
          ...(report.addFiles.length && {
            files: [...(agent.runtimePolicy.files ?? []), ...report.addFiles],
          }),
        };
        if (report.instructions || report.addGrants.length || report.addFiles.length)
          await tx`update ai_agent set instructions = ${report.instructions ?? agent.instructions}, runtime_policy = ${tx.json(policy)} where id = ${agent.id}`;
        if (
          agent.sourceTemplateId &&
          (added.length ||
            report.addTools.length ||
            report.addGrants.length ||
            report.addFiles.length ||
            report.instructions)
        ) {
          const groups = [
            ...(added.length ? ['skills'] : []),
            ...(report.addTools.length ? ['tools'] : []),
            ...(report.addGrants.length ? ['approvals'] : []),
            ...(report.addFiles.length || report.instructions ? ['instructions'] : []),
          ];
          await tx`insert into agent_template_sync_log(team_id, template_id, copy_id, groups) values (${agent.teamId}, ${agent.sourceTemplateId}, ${agent.id}, ${tx.json(groups)})`;
        }
      });
    }
    rows.push({ ...report, added, proposedSkills: skills.map((skill) => skill.name) });
  }
  const cell = (items: string[]) =>
    items.join(', ').replaceAll('|', '\\|').replaceAll('\n', ' ') || '—';
  console.log(
    '| Agent | Origin | Missing skills | Added | Extra (preserved) | Missing tools / grants / files | Context / owner changes |',
  );
  console.log('|---|---|---|---|---|---|---|');
  for (const row of rows)
    console.log(
      `| ${cell([row.agent])} | ${row.origin} | ${cell(row.missing)} | ${apply ? cell(row.added) : 'dry run'} | ${cell(row.extra)} | ${cell([...row.missingTools.map(String), ...row.missingGrants, ...row.missingFiles])} | ${cell([...row.findings, ...row.ownerOverrides.map((group) => `owner:${group}`)])} |`,
    );
  if (value('--out'))
    await writeFile(
      value('--out')!,
      JSON.stringify({ mode: apply ? 'apply' : 'dry-run', rows }, null, 2),
      { mode: 0o600 },
    );
} finally {
  await database?.end();
}
