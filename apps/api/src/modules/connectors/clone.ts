import {
  db,
  aiAgent,
  integrationCredential,
  organizationAgentAssignment,
  project,
  projectMember,
  projectViewFolder,
  user,
} from '@repo/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { projectSlug } from '#shared/agent-socket';
import { enqueueAgentRun } from '#modules/agents/core/run-queue';
import { projectRoot } from '#modules/project-files/roots';

// "Repo in Bereichsordner klonen": the owner picks an SSH key, a project area and a
// repository; the runner of an agent working in the project clones it with that key into
// the area's folder of the project's workspace (a run with trigger 'workspace', see
// packages/runner/src/workspace-job.ts). The workspace repository then ignores the nested
// repository. With agent isolation the clone runs as the project's own user, so the agent
// has to be one whose runner works in that project: its coordinator first, then an agent
// of that project alone; the Home agent, whose runner works in a workspace of its own, only
// when the project has no agent (2026-09-25: runs 90/91 cloned into Home's workspace).

export interface CloneTarget {
  url: string;
  // The directory the repository lands in.
  name: string;
}

const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const SEGMENT = /^[A-Za-z0-9._~-]+$/;

function checkedHost(host: string): string {
  const name = host.toLowerCase();
  if (!HOST.test(name)) throw new HttpError(400, `The host ${host} is not a public host name.`);
  return name;
}

function checkedPath(path: string): string[] {
  const parts = path.replace(/^\/+/, '').replace(/\/+$/, '').split('/');
  if (
    parts.length === 0 ||
    parts.some((part) => !SEGMENT.test(part) || part === '.' || part === '..')
  ) {
    throw new HttpError(400, 'The repository path is not valid.');
  }
  return parts;
}

// A git address over SSH (git@host:owner/repo.git, ssh://git@host[:port]/owner/repo) or
// https, on a public host name. The clone lands in a folder named after the repository.
export function cloneTarget(raw: string): CloneTarget {
  const url = raw.trim();
  let host: string;
  let parts: string[];
  const scp = /^([A-Za-z0-9._-]+)@([^:/]+):(.+)$/.exec(url);
  if (scp) {
    host = checkedHost(scp[2]!);
    parts = checkedPath(scp[3]!);
  } else {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new HttpError(400, 'That is not a repository address.');
    }
    if (parsed.protocol !== 'ssh:' && parsed.protocol !== 'https:') {
      throw new HttpError(400, 'Use an ssh:// or https:// address, or git@host:owner/repo.');
    }
    if (parsed.password || parsed.search || parsed.hash) {
      throw new HttpError(400, 'The address cannot carry a password, query or fragment.');
    }
    host = checkedHost(parsed.hostname);
    parts = checkedPath(parsed.pathname);
  }
  void host;
  const name = parts.at(-1)!.replace(/\.git$/, '');
  if (!name || name.startsWith('.')) throw new HttpError(400, 'The repository has no name.');
  return { url, name };
}

export async function startClone(
  teamId: number,
  credentialId: number,
  input: { projectId: number; areaId?: number | null; url: string; agentId?: number },
): Promise<{ runId: number; agentId: number; agentName: string; folder: string; name: string }> {
  const [key] = await db
    .select({ id: integrationCredential.id, projectId: integrationCredential.projectId })
    .from(integrationCredential)
    .where(
      and(
        eq(integrationCredential.id, credentialId),
        eq(integrationCredential.teamId, teamId),
        eq(integrationCredential.integrationKey, 'ssh_key'),
      ),
    );
  if (!key) throw new HttpError(404, 'SSH key not found');
  const [target] = await db
    .select({ id: project.id, key: project.key })
    .from(project)
    .where(and(eq(project.id, input.projectId), eq(project.teamId, teamId)));
  if (!target) throw new HttpError(400, 'The project is not a project of this team.');
  if (key.projectId !== null && key.projectId !== target.id) {
    throw new HttpError(400, 'The key is limited to another project.');
  }
  let folder = '';
  if (input.areaId != null) {
    const [area] = await db
      .select({ folder: projectViewFolder.folder })
      .from(projectViewFolder)
      .where(
        and(eq(projectViewFolder.id, input.areaId), eq(projectViewFolder.projectId, target.id)),
      );
    if (!area) throw new HttpError(400, 'The area is not an area of this project.');
    folder = area.folder;
  }
  const { url, name } = cloneTarget(input.url);
  const agents = await db
    .select({ id: aiAgent.id, name: user.name })
    .from(aiAgent)
    .innerJoin(user, eq(user.id, aiAgent.userId))
    .where(
      and(
        eq(aiAgent.teamId, teamId),
        eq(aiAgent.kind, 'external'),
        eq(aiAgent.template, false),
        input.agentId === undefined ? undefined : eq(aiAgent.id, input.agentId),
        sql`exists (select 1 from ${projectMember} where ${projectMember.userId} = ${aiAgent.userId} and ${projectMember.projectId} = ${target.id})`,
      ),
    )
    .orderBy(cloneAgentRank(), asc(aiAgent.id))
    .limit(1);
  const agent = agents[0];
  if (!agent) {
    throw new HttpError(
      400,
      input.agentId === undefined
        ? `No agent with a runner works in ${target.key}.`
        : 'That agent does not work in the project.',
    );
  }
  const runId = await enqueueAgentRun({
    agentId: agent.id,
    projectId: target.id,
    issueId: null,
    sourceActivityId: null,
    trigger: 'workspace',
    // The project's workspace, which the runner resolves the folder against (never its own
    // working directory), and its slug, which an isolated runner checks is its own.
    prompt: JSON.stringify({
      op: 'git_clone',
      url,
      folder,
      name,
      credentialId: key.id,
      slug: projectSlug(target.key),
      workspace: projectRoot(target.key, 'code').directory,
    }),
  });
  return { runId, agentId: agent.id, agentName: agent.name, folder, name };
}

// The project's coordinator first, then an agent that works in this one project, then one
// that works in several, and the Home agent last.
function cloneAgentRank() {
  return sql`case
    when ${aiAgent.agentRole} = 'home' then 3
    when exists (select 1 from ${organizationAgentAssignment} oa where oa.agent_id = ${aiAgent.id} and oa.role = 'coordinator') then 0
    when (select count(*) from ${projectMember} pm where pm.user_id = ${aiAgent.userId}) = 1 then 1
    else 2
  end`;
}
