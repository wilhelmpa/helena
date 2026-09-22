import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// Operator-approved internal data access. Native provider credentials stay on the
// host. Classifiers/model-only workers must never receive this policy.
export const INTERNAL_READ_TOOLS = Object.freeze([
  'google-private__gmail_search',
  'google-private__gmail_thread_get',
  'google-private__gmail_attachment_metadata',
  'google-private__contacts_search',
  'google-private__calendar_list',
]);

export const INTERNAL_WORKSPACE_TOOLS = Object.freeze([
  'workspace-private__projects_list',
  'workspace-private__files_list',
  'workspace-private__file_link',
  'workspace-private__file_read_text',
  'workspace-private__file_create_text',
]);

// The delegated KARR job agent owns only the state transition of the ticket it
// is currently processing. The runner owns the final comment, so direct comment
// creation remains denied to prevent comment-trigger feedback loops.
export const KARR_CAREER_STATE_TOOLS = Object.freeze([
  'itsaplan__update_issue',
]);

export function withInternalDataAccess(tools = {}) {
  const result = withInternalReadAccess(tools);
  result.alsoAllow = [...new Set([...result.alsoAllow, ...INTERNAL_WORKSPACE_TOOLS])];
  result.sandbox.tools.alsoAllow = [...new Set([...result.sandbox.tools.alsoAllow, ...INTERNAL_WORKSPACE_TOOLS])];
  return result;
}

export function withInternalReadAccess(tools = {}) {
  if (tools.deny?.includes('*') || tools.sandbox?.tools?.deny?.includes('*')) {
    throw new Error('A tools-disabled worker cannot receive internal data access');
  }
  return {
    ...tools,
    alsoAllow: [...new Set([...(tools.alsoAllow || []), ...INTERNAL_READ_TOOLS])],
    sandbox: {
      ...tools.sandbox,
      tools: {
        ...tools.sandbox?.tools,
        alsoAllow: [...new Set([...(tools.sandbox?.tools?.alsoAllow || []), ...INTERNAL_READ_TOOLS])],
      },
    },
  };
}

export function withKarrCareerStateAccess(tools = {}) {
  if (tools.deny?.includes('*') || tools.sandbox?.tools?.deny?.includes('*')) {
    throw new Error('A tools-disabled worker cannot receive KARR state access');
  }
  for (const name of KARR_CAREER_STATE_TOOLS) {
    if (tools.deny?.includes(name) || tools.sandbox?.tools?.deny?.includes(name)) {
      throw new Error(`KARR state access conflicts with an explicit deny: ${name}`);
    }
  }
  return {
    ...tools,
    alsoAllow: [...new Set([...(tools.alsoAllow || []), ...KARR_CAREER_STATE_TOOLS])],
    sandbox: {
      ...tools.sandbox,
      tools: {
        ...tools.sandbox?.tools,
        alsoAllow: [...new Set([...(tools.sandbox?.tools?.alsoAllow || []), ...KARR_CAREER_STATE_TOOLS])],
      },
    },
  };
}

export async function ensureKarrCareerStateAccess({ agentId, runOpenClaw, stateDirectory }) {
  if (agentId !== 'karriere-job') throw new Error('KARR state access is restricted to karriere-job');
  const read = async () => JSON.parse((await runOpenClaw(['config', 'get', 'agents.entries', '--json'])).stdout)?.[agentId];
  const before = await read();
  if (!before) throw new Error('KARR career agent is missing');
  const tools = withKarrCareerStateAccess(before.tools);
  if (JSON.stringify(tools) === JSON.stringify(before.tools)) return { changed: false, tools: [...KARR_CAREER_STATE_TOOLS] };
  const file = path.join(stateDirectory, `.karr-career-state-access.${crypto.randomUUID()}.json`);
  await fs.writeFile(file, JSON.stringify({ agents: { entries: { [agentId]: { tools } } } }), { mode: 0o600, flag: 'wx' });
  try {
    await runOpenClaw(['config', 'patch', '--file', file, '--dry-run']);
    await runOpenClaw(['config', 'patch', '--file', file]);
  } finally { await fs.rm(file, { force: true }); }
  const after = await read();
  if (JSON.stringify(after?.tools) !== JSON.stringify(tools) || JSON.stringify(before.sandbox) !== JSON.stringify(after.sandbox)) throw new Error('KARR state access was not confirmed');
  return { changed: true, tools: [...KARR_CAREER_STATE_TOOLS] };
}

export async function ensureInternalReadAccess({ agentId, runOpenClaw, stateDirectory }) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(agentId)) throw new Error('Invalid agent ID');
  const read = async () => JSON.parse((await runOpenClaw(['config', 'get', 'agents.entries', '--json'])).stdout)?.[agentId];
  const before = await read();
  if (!before) throw new Error('Agent is missing');
  const tools = withInternalDataAccess(before.tools);
  if (JSON.stringify(tools) === JSON.stringify(before.tools)) return { changed: false, tools: INTERNAL_READ_TOOLS.length + INTERNAL_WORKSPACE_TOOLS.length };
  const file = path.join(stateDirectory, `.internal-access.${crypto.randomUUID()}.json`);
  await fs.writeFile(file, JSON.stringify({ agents: { entries: { [agentId]: { tools } } } }), { mode: 0o600, flag: 'wx' });
  try {
    await runOpenClaw(['config', 'patch', '--file', file, '--dry-run']);
    await runOpenClaw(['config', 'patch', '--file', file]);
  } finally { await fs.rm(file, { force: true }); }
  const after = await read();
  if (JSON.stringify(after?.tools) !== JSON.stringify(tools) || JSON.stringify(before.sandbox) !== JSON.stringify(after.sandbox)) throw new Error('Internal data access was not confirmed');
  return { changed: true, tools: INTERNAL_READ_TOOLS.length + INTERNAL_WORKSPACE_TOOLS.length };
}
