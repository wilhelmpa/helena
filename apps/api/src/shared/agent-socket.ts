import { aiAgent, db, project, projectMember } from '@repo/db';
import { eq } from 'drizzle-orm';
import { isHomeAgent } from '#modules/agents/core/home-agent';
import { HttpError } from './lib';

// Agents that run isolated (deployment/volition-stack/isolation) reach the API only through
// the agent socket, a small proxy that drops every header it does not know and names the
// project of the Unix user that connected. The project comes from the kernel (the peer's
// uid), so an agent cannot choose it. The header only ever narrows access: a request with
// it must authenticate with the key of an agent of that project, and nothing else about
// the request changes. A request without it is handled as before, so a caller outside the
// sandbox cannot use it to gain anything.
export const AGENT_PROJECT_HEADER = 'x-volition-agent-project';
export const AGENT_UNIT_HEADER = 'x-volition-agent-unit';

// The project slug the deployment derives from a project key (provisioner.mjs projectSlug):
// Home is the Home agent's own, every other slug is the key in lower case.
export const HOME_SLUG = 'home';
const SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function projectSlug(projectKey: string): string {
  return projectKey === 'VERV' ? 'verve' : projectKey.toLowerCase();
}

// The slug an agent-socket request names, null when it names none. A malformed value is
// refused rather than ignored: the proxy writes it, so anything else did not come from it.
export function agentSocketProject(headers: Headers): string | null {
  const value = headers.get(AGENT_PROJECT_HEADER);
  if (value === null) return null;
  if (!SLUG.test(value)) throw new HttpError(403, 'Invalid agent project');
  return value;
}

// Paths an isolated agent never needs: the host's control plane, the sign-in flows and
// the reverse-proxy checks. An agent authenticates with its key and nothing else.
const AGENT_SOCKET_DENIED = /^\/(?:internal\/|api\/auth\/|auth\/verify(?:\/|$))/;

// The part of the check that needs no credential, run before routing: the path, and a
// session cookie, which the socket never forwards and an agent therefore never holds.
export function agentSocketRequestAllowed(request: Request, path: string): boolean {
  if (agentSocketProject(request.headers) === null) return true;
  if (AGENT_SOCKET_DENIED.test(path)) return false;
  if (request.headers.has('cookie')) return false;
  return true;
}

// Whether a request carries an API key, the only credential the agent socket accepts.
export function hasApiKey(headers: Headers): boolean {
  if (headers.get('x-api-key')) return true;
  return /^Bearer\s+itp_/i.test(headers.get('authorization') ?? '');
}

// Checks that the user the key belongs to is an agent of the named project. The Home agent
// runs as Home and nowhere else; every other agent in a project it is a member of.
export async function assertAgentOfProject(userId: string, slug: string): Promise<void> {
  const [agent] = await db
    .select({ id: aiAgent.id, username: aiAgent.username, agentRole: aiAgent.agentRole })
    .from(aiAgent)
    .where(eq(aiAgent.userId, userId));
  if (!agent) throw new HttpError(403, 'Only an agent key is accepted on the agent socket');
  if (isHomeAgent(agent.agentRole)) {
    if (slug === HOME_SLUG) return;
    throw new HttpError(403, 'The agent key does not belong to this project');
  }
  if (slug === HOME_SLUG) throw new HttpError(403, 'The agent key does not belong to this project');
  const projects = await db
    .select({ key: project.key })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .where(eq(projectMember.userId, userId));
  if (!projects.some((row) => projectSlug(row.key) === slug)) {
    throw new HttpError(403, 'The agent key does not belong to this project');
  }
}

// The whole check for a request that has been authenticated as `userId`: nothing to do
// without the header, otherwise the credential has to be an API key of an agent of the
// project the socket named.
export async function checkAgentSocket(headers: Headers, userId: string): Promise<void> {
  const slug = agentSocketProject(headers);
  if (slug === null) return;
  if (!hasApiKey(headers) || headers.has('cookie')) {
    throw new HttpError(403, 'Only an agent key is accepted on the agent socket');
  }
  await assertAgentOfProject(userId, slug);
}
