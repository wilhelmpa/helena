import postgres from 'postgres';

const CONTENT_TABLES = [
  'ai_agent',
  'project',
  'organization_department',
  'organization_agent_assignment',
  'organization_project_assignment',
  'organization_goal',
  'helena_goal_note',
  'helena_schedule',
  'issue',
  'issue_template',
  'issue_checklist_item',
  'issue_activity',
  'pipeline',
  'pipeline_version',
] as const;

type Rename = { agentId: number; projectId: number; old: string; next: string };

function displayNameWithoutHermes(name: string, agentId: number): string {
  return (
    name
      .replace(/^Hermes-Koordinator /i, 'Koordinator ')
      .replace(/^Hermes (.+) Coordinator$/i, 'Coordinator $1')
      .replace(/\bHermes\b[- ]*/gi, '')
      .trim() || `Agent ${agentId}`
  );
}

function agentKeyLabel(name: string): string {
  let label = 'agent:';
  for (const character of name) {
    if (label.length + character.length > 32) break;
    label += character;
  }
  return label.trimEnd();
}

export async function renameProjectCoordinators(
  options: { apply?: boolean; log?: (line: string) => void } = {},
) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  const log = options.log ?? console.log;
  try {
    return await client.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(101, 20260929)`;
      const rows = await tx<
        {
          agent_id: number;
          project_id: number | null;
          project_key: string | null;
          team_id: number;
          username: string;
        }[]
      >`
        select a.id agent_id, pm.project_id, p.key project_key,
               a.team_id, a.username
        from ai_agent a
        left join project_member pm on pm.user_id = a.user_id
        left join project p on p.id = pm.project_id
        where a.username ~ '^hermes-[a-z0-9_-]+-coordinator$'
        order by a.id
      `;
      const byAgent = new Map<number, (typeof rows)[number][]>();
      for (const row of rows)
        byAgent.set(row.agent_id, [...(byAgent.get(row.agent_id) ?? []), row]);
      const renames: Rename[] = [];
      for (const members of byAgent.values()) {
        const row = members[0]!;
        if (members.length !== 1 || !row.project_key || row.project_id == null) {
          throw new Error(`Coordinator agent ${row.agent_id} has no unique project`);
        }
        const slug = row.project_key === 'VERV' ? 'verve' : row.project_key.toLowerCase();
        const next = `${slug}-koordinator`;
        if (row.username !== `hermes-${slug}-coordinator`) {
          throw new Error(`Coordinator agent ${row.agent_id} does not match its project key`);
        }
        const collision = await tx`
          select 1 from ai_agent where team_id = ${row.team_id}
            and lower(username) = ${next} and id <> ${row.agent_id}
          union all
          select 1 from "user" where lower(username) = ${next}
          limit 1
        `;
        if (collision.length) throw new Error(`Reserved handle ${next} is already in use`);
        renames.push({
          agentId: row.agent_id,
          projectId: row.project_id,
          old: row.username,
          next,
        });
      }

      const columns = await tx<{ table_name: string; column_name: string; data_type: string }[]>`
        select table_name, column_name, data_type from information_schema.columns
        where table_schema = 'public' and table_name = any(${[...CONTENT_TABLES]})
          and data_type in ('text', 'jsonb', 'character varying')
        order by table_name, ordinal_position
      `;
      let replacements = 0;
      for (const rename of renames) {
        for (const column of columns) {
          if (column.table_name === 'ai_agent' && column.column_name === 'username') continue;
          const needle = `@${rename.old}`;
          const replacement = `@${rename.next}`;
          const pattern = `${needle}([^A-Za-z0-9_-]|$)`;
          const replaceWith = `${replacement}\\1`;
          const matches = await tx<{ count: string }[]>`
            select count(*)::text as count from ${tx(column.table_name)}
            where ${tx(column.column_name)}::text ~ ${pattern}
          `;
          const count = Number(matches[0]?.count ?? 0);
          if (!count) continue;
          replacements += count;
          log(
            `${column.table_name}.${column.column_name}: ${count} mention(s) ${needle} → ${replacement}`,
          );
          if (options.apply) {
            if (column.data_type === 'jsonb') {
              await tx`
                update ${tx(column.table_name)}
                set ${tx(column.column_name)} = regexp_replace(${tx(column.column_name)}::text,
                  ${pattern}, ${replaceWith}, 'g')::jsonb
                where ${tx(column.column_name)}::text ~ ${pattern}
              `;
            } else {
              await tx`
                update ${tx(column.table_name)}
                set ${tx(column.column_name)} = regexp_replace(${tx(column.column_name)},
                  ${pattern}, ${replaceWith}, 'g')
                where ${tx(column.column_name)} ~ ${pattern}
              `;
            }
          }
        }
        log(`ai_agent ${rename.agentId}: ${rename.old} → ${rename.next}`);
        if (options.apply) {
          await tx`update ai_agent set username = ${rename.next} where id = ${rename.agentId}`;
          await tx`
            update organization_agent_assignment set runtime_agent_id = ${rename.next}
            where agent_id = ${rename.agentId} and runtime_agent_id = ${rename.old}
          `;
          await tx`
            insert into project_provisioning_job (project_id, requested_resources, status)
            values (${rename.projectId}, '["coordinator"]'::jsonb, 'pending')
            on conflict (project_id) do update
            set id = gen_random_uuid(), status = 'pending', attempts = 0,
                next_attempt_at = now(), last_error = null, result = null,
                completed_at = null, updated_at = now()
          `;
        }
      }
      const names = await tx<{ agent_id: number; user_id: string; name: string }[]>`
        select a.id agent_id, u.id user_id, u.name
        from ai_agent a join "user" u on u.id = a.user_id
        where u.name ilike '%Hermes%'
        order by a.id
      `;
      for (const row of names) {
        const nextName = displayNameWithoutHermes(row.name, row.agent_id);
        log(`user.name for agent ${row.agent_id}: ${row.name} → ${nextName}`);
        if (options.apply) await tx`update "user" set name = ${nextName} where id = ${row.user_id}`;
      }
      const keyLabels = await tx<
        { key_id: string; agent_id: number; agent_name: string; key_name: string }[]
      >`
        select k.id key_id, a.id agent_id, u.name agent_name, k.name key_name
        from apikey k
        join ai_agent a on a.user_id = k.reference_id
        join "user" u on u.id = a.user_id
        where k.name ilike '%Hermes%'
      `;
      for (const row of keyLabels) {
        const nextName = row.key_name.startsWith('agent:')
          ? agentKeyLabel(displayNameWithoutHermes(row.agent_name, row.agent_id))
          : displayNameWithoutHermes(row.key_name, row.agent_id);
        log(`apikey.name ${row.key_id}: ${row.key_name} → ${nextName}`);
        if (options.apply) await tx`update apikey set name = ${nextName} where id = ${row.key_id}`;
      }
      log(
        `${options.apply ? 'Applied' : 'Dry-run'}: ${renames.length} coordinator(s), ${names.length} display name(s), ${keyLabels.length} key label(s), ${replacements} text row(s)`,
      );
      return {
        coordinators: renames.length,
        displayNames: names.length,
        keyLabels: keyLabels.length,
        replacements,
      };
    });
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (
    args.some((arg) => !['--apply', '--dry-run'].includes(arg)) ||
    (args.includes('--apply') && args.includes('--dry-run'))
  ) {
    throw new Error('Usage: bun rename-project-coordinators.ts [--apply|--dry-run]');
  }
  await renameProjectCoordinators({ apply: args.includes('--apply') });
}
