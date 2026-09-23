import { aiAgent } from '@repo/db';
import { sql } from 'drizzle-orm';

// The Home agent is the master of a team's agents and is used from Home only. It is a
// member of the team's projects so it can read and create work there, and the lists of
// a project leave it out.
export const HOME_AGENT_USERNAME = 'master';

export function isHomeAgent(username: string): boolean {
  return username.toLowerCase() === HOME_AGENT_USERNAME;
}

// isHomeAgent as a condition on a query that reads ai_agent. A row without an agent,
// such as a person's membership read through a left join, passes.
export function notHomeAgent() {
  return sql`coalesce(lower(${aiAgent.username}), '') <> ${HOME_AGENT_USERNAME}`;
}
