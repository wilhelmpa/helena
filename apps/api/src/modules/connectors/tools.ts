import {
  db,
  aiAgent,
  agentRun,
  approvalRequest,
  connectorAction,
  integrationCredential,
  user,
} from '@repo/db';
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { connectors, toolCategory, type ActionCategory } from '@helena/connectors';
import { GOOGLE_TOOLS, type GoogleTool } from '@helena/connectors/google';
import { HttpError, iso } from '#shared/lib';
import { createApprovalRequest, type RequestKind } from '#modules/approvals/service';
import { accessTo, effectiveGrants, type GrantSubject } from '#modules/agents/credentials/grants';
import { recordAgentUses, type UseAction } from '#modules/agents/credentials/delivery';
import { ENV_KINDS } from '#modules/agents/credentials/env';
import { listAccounts, getAccount, type AccountRow } from './store';
import { googleReadable, googleToolContext } from './google/engine';
import { decideConnectorAction } from './policy';

// Carrying out a connector tool call for an agent: find the account it names among the
// ones granted to the agent, ask the policy, then run the tool, file it for the owner's
// approval, or refuse it. Every outcome goes into the audit log with the action category.
// An action waiting for approval is stored exactly as asked (connector_action) and run by
// the background loop once approved, so what runs is what the approval card showed.

export interface ToolCaller {
  agent: { id: number; userId: string; teamId: number; name: string };
  project: { id: number; key: string };
  run: { id: number; issueId: number | null } | null;
}

export type ToolCallResult =
  | { status: 'done'; result: unknown }
  | { status: 'pending_approval'; actionId: number; approvalId: number; message: string }
  | { status: 'denied'; reason: string };

const byName = new Map<string, GoogleTool>(GOOGLE_TOOLS.map((tool) => [tool.name, tool]));

export function connectorTool(name: string): GoogleTool | undefined {
  return byName.get(name);
}

// The one run the agent works on in the project right now, if there is exactly one.
export async function currentRun(agentId: number, projectId: number) {
  const rows = await db
    .select({ id: agentRun.id, issueId: agentRun.issueId })
    .from(agentRun)
    .where(
      and(
        eq(agentRun.agentId, agentId),
        eq(agentRun.projectId, projectId),
        eq(agentRun.status, 'pending'),
        isNotNull(agentRun.startedAt),
      ),
    )
    .limit(2);
  return rows.length === 1 ? rows[0]! : null;
}

export async function callerOf(
  userId: string,
  project: { id: number; key: string; teamId: number },
): Promise<ToolCaller> {
  const [agent] = await db
    .select({ id: aiAgent.id, userId: aiAgent.userId, teamId: aiAgent.teamId, name: user.name })
    .from(aiAgent)
    .innerJoin(user, eq(user.id, aiAgent.userId))
    .where(and(eq(aiAgent.userId, userId), eq(aiAgent.teamId, project.teamId)));
  if (!agent) throw new HttpError(403, 'Only an agent uses connections.');
  return {
    agent,
    project: { id: project.id, key: project.key },
    run: await currentRun(agent.id, project.id),
  };
}

function subjectOf(caller: ToolCaller): GrantSubject {
  return { agentId: caller.agent.id, userId: caller.agent.userId, projectId: caller.project.id };
}

async function audit(
  caller: ToolCaller,
  account: AccountRow,
  action: UseAction,
  category: ActionCategory,
  purpose: string,
) {
  await recordAgentUses(
    {
      id: caller.agent.id,
      teamId: caller.agent.teamId,
      userId: caller.agent.userId,
      username: caller.agent.name,
    },
    { runId: caller.run?.id ?? null, chatMessageId: null },
    action,
    [{ credentialId: account.id, label: account.label, purpose, category }],
  );
}

const APPROVAL_KIND: Partial<Record<ActionCategory, RequestKind>> = {
  send: 'send',
  publish: 'publish',
  pay: 'pay',
  delete: 'delete',
};

function failure(error: unknown): string {
  const response = (error as { response?: { data?: { error?: { message?: unknown } } } })?.response;
  const message = response?.data?.error?.message;
  if (typeof message === 'string') return message.slice(0, 500);
  return error instanceof Error ? error.message.slice(0, 500) : 'The call failed.';
}

// The Google account named by address, among the team's accounts the caller reaches. One
// it does not reach is reported the same as one that does not exist.
async function reachableAccount(caller: ToolCaller, email: string) {
  const address = email.trim().toLowerCase();
  const account = (await listAccounts(caller.agent.teamId, 'google')).find(
    (row) => googleReadable(row).email === address,
  );
  if (!account) return null;
  const grants = await effectiveGrants(subjectOf(caller), { credentialIds: [account.id] });
  return { account, grant: grants.get(account.id) };
}

export async function callConnectorTool(
  caller: ToolCaller,
  toolName: string,
  input: Record<string, unknown>,
): Promise<ToolCallResult> {
  const tool = connectorTool(toolName);
  if (!tool) throw new HttpError(404, `Unknown connector tool ${toolName}.`);
  const reached = await reachableAccount(caller, String(input.account ?? ''));
  const category = toolCategory(tool, input);
  if (!reached?.grant) {
    return {
      status: 'denied',
      reason: `No Google account ${String(input.account)} is granted to you.`,
    };
  }
  const { account, grant } = reached;
  const summary = tool.summarize(input);
  const readable = googleReadable(account);
  const serviceOff = !readable.services.includes(tool.service);
  const noGog = readable.engine === 'gog' && !tool.gogCommand;
  if (serviceOff || noGog) {
    const reason = serviceOff
      ? `The ${tool.service} service of ${readable.email} is switched off.`
      : `${tool.name} is not available for ${readable.email}, whose sign-in is kept in gog.`;
    await audit(caller, account, 'denied', category, `${tool.name}: ${reason}`);
    return { status: 'denied', reason };
  }
  const access = accessTo(grant, tool.service);
  const decision = await decideConnectorAction({
    agent: { id: caller.agent.id, name: caller.agent.name },
    project: { id: caller.project.id, key: caller.project.key },
    action: category,
    context: {
      tool: tool.name,
      connector: 'google',
      service: tool.service,
      target: summary,
      runId: caller.run?.id ?? null,
      grant: access ? { access } : null,
    },
  });
  if (decision.effect === 'deny') {
    await audit(caller, account, 'denied', category, `${tool.name}: ${decision.reason}`);
    return { status: 'denied', reason: decision.reason };
  }
  if (decision.effect === 'needs-approval') {
    return requestApproval(caller, account, tool, input, category, summary, decision.reason);
  }
  return runNow(caller, account, tool, input, category, summary);
}

async function runNow(
  caller: ToolCaller,
  account: AccountRow,
  tool: GoogleTool,
  input: Record<string, unknown>,
  category: ActionCategory,
  summary: string,
): Promise<ToolCallResult> {
  try {
    const result = await tool.handler(input, await googleToolContext(account));
    await audit(caller, account, 'called', category, `${tool.name}: ${summary}`);
    return { status: 'done', result };
  } catch (error) {
    const reason = failure(error);
    await audit(caller, account, 'called', category, `${tool.name} failed: ${reason}`);
    throw new HttpError(error instanceof HttpError ? error.status : 502, reason);
  }
}

async function requestApproval(
  caller: ToolCaller,
  account: AccountRow,
  tool: GoogleTool,
  input: Record<string, unknown>,
  category: ActionCategory,
  summary: string,
  reason: string,
): Promise<ToolCallResult> {
  const details = [
    `${googleReadable(account).email} · ${tool.name} (${category})`,
    '',
    JSON.stringify(input, null, 2).slice(0, 8000),
    '',
    'Helena carries this out exactly as shown once it is approved.',
  ].join('\n');
  const { approval } = await createApprovalRequest({
    projectId: caller.project.id,
    agent: caller.agent,
    kind: APPROVAL_KIND[category] ?? 'other',
    action: summary.slice(0, 500),
    details,
    issueId: caller.run?.issueId ?? undefined,
  });
  let [action] = await db
    .select({ id: connectorAction.id })
    .from(connectorAction)
    .where(eq(connectorAction.approvalRequestId, approval.id));
  if (!action) {
    [action] = await db
      .insert(connectorAction)
      .values({
        teamId: caller.agent.teamId,
        credentialId: account.id,
        agentId: caller.agent.id,
        projectId: caller.project.id,
        runId: caller.run?.id ?? null,
        connector: 'google',
        tool: tool.name,
        category,
        service: tool.service,
        input,
        summary: summary.slice(0, 500),
        approvalRequestId: approval.id,
      })
      .returning({ id: connectorAction.id });
    await audit(caller, account, 'approval', category, `${tool.name}: ${summary}`);
  }
  return {
    status: 'pending_approval',
    actionId: action!.id,
    approvalId: approval.id,
    message:
      `${reason} Approval request #${approval.id} is filed. End your run now: once the owner ` +
      `decides, Helena carries out the action itself and starts a new run of yours; check ` +
      `the outcome with get_connection_action ${action!.id}.`,
  };
}

// ── Approved actions ───────────────────────────────────────────────────────────────────────

// Runs the actions whose approval was granted and closes the rejected ones. Claims each
// row first ('pending' → 'running'), so two API processes never run one twice.
export async function processConnectorActions(): Promise<number> {
  const due = await db
    .select({ id: connectorAction.id, decision: approvalRequest.status })
    .from(connectorAction)
    .innerJoin(approvalRequest, eq(approvalRequest.id, connectorAction.approvalRequestId))
    .where(
      and(
        eq(connectorAction.status, 'pending'),
        inArray(approvalRequest.status, ['approved', 'rejected']),
      ),
    )
    .orderBy(asc(connectorAction.id))
    .limit(20);
  let handled = 0;
  for (const { id, decision } of due) {
    const [claimed] = await db
      .update(connectorAction)
      .set({
        status: decision === 'approved' ? 'running' : 'rejected',
        ...(decision !== 'approved' && { finishedAt: new Date() }),
      })
      .where(and(eq(connectorAction.id, id), eq(connectorAction.status, 'pending')))
      .returning();
    if (!claimed || decision !== 'approved') continue;
    handled++;
    await runApproved(claimed);
  }
  return handled;
}

async function runApproved(action: typeof connectorAction.$inferSelect): Promise<void> {
  const finish = (fields: { status: 'done' | 'failed'; result?: unknown; error?: string }) =>
    db
      .update(connectorAction)
      .set({ ...fields, finishedAt: new Date() })
      .where(eq(connectorAction.id, action.id));
  const tool = connectorTool(action.tool);
  const account =
    action.credentialId === null
      ? null
      : await getAccount(action.credentialId, action.teamId, ['google']);
  if (!tool || !account) {
    await finish({ status: 'failed', error: 'The account or the tool no longer exists.' });
    return;
  }
  const [agent] =
    action.agentId === null
      ? []
      : await db
          .select({ id: aiAgent.id, userId: aiAgent.userId, name: user.name })
          .from(aiAgent)
          .innerJoin(user, eq(user.id, aiAgent.userId))
          .where(eq(aiAgent.id, action.agentId));
  const input = action.input as Record<string, unknown>;
  const category = action.category as ActionCategory;
  const log = (outcome: string) =>
    agent
      ? recordAgentUses(
          { id: agent.id, teamId: action.teamId, userId: agent.userId, username: agent.name },
          { runId: action.runId, chatMessageId: null },
          'called',
          [{ credentialId: account.id, label: account.label, purpose: outcome, category }],
        )
      : Promise.resolve();
  try {
    const result = await tool.handler(input, await googleToolContext(account));
    await finish({ status: 'done', result: result ?? null });
    await log(`${tool.name} (approved): ${action.summary}`);
  } catch (error) {
    const reason = failure(error);
    await finish({ status: 'failed', error: reason });
    await log(`${tool.name} (approved) failed: ${reason}`);
  }
}

export interface ConnectorActionEntry {
  id: number;
  tool: string;
  category: string;
  summary: string;
  status: string;
  approvalId: number | null;
  result: unknown;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export async function getConnectorAction(
  id: number,
  agentId: number,
): Promise<ConnectorActionEntry> {
  const [row] = await db
    .select()
    .from(connectorAction)
    .where(and(eq(connectorAction.id, id), eq(connectorAction.agentId, agentId)));
  if (!row) throw new HttpError(404, 'Connector action not found');
  return {
    id: row.id,
    tool: row.tool,
    category: row.category,
    summary: row.summary,
    status: row.status,
    approvalId: row.approvalRequestId,
    result: row.result,
    error: row.error,
    createdAt: iso(row.createdAt),
    finishedAt: row.finishedAt ? iso(row.finishedAt) : null,
  };
}

// ── What the caller may use ────────────────────────────────────────────────────────────────

export interface ConnectionListing {
  google: {
    account: string;
    engine: 'helena' | 'gog';
    services: { id: string; access: 'read' | 'write' }[];
    tools: string[];
  }[];
  webLogins: { id: number; label: string; origins: string[] }[];
  sshKeys: { id: number; label: string; publicKey: string | null }[];
  // The environment variables the agent's commands receive (Zugänge, "Als
  // Umgebungsvariable an Agenten geben"): names only.
  environment: { name: string; label: string; secret: boolean }[];
}

// The accounts and credentials the agent reaches in the project, with what it may do with
// each. Secret values never appear.
export async function listCallerConnections(caller: ToolCaller): Promise<ConnectionListing> {
  const grants = await effectiveGrants(subjectOf(caller), {
    kinds: ['google', 'web_login', 'ssh_key', ...ENV_KINDS],
  });
  if (grants.size === 0) return { google: [], webLogins: [], sshKeys: [], environment: [] };
  const rows = await db
    .select({
      id: integrationCredential.id,
      kind: integrationCredential.integrationKey,
      label: integrationCredential.label,
      redacted: integrationCredential.redacted,
    })
    .from(integrationCredential)
    .where(inArray(integrationCredential.id, [...grants.keys()]))
    .orderBy(asc(integrationCredential.label));
  const listing: ConnectionListing = { google: [], webLogins: [], sshKeys: [], environment: [] };
  const serviceIds = connectors.get('google')?.services.map((service) => service.id) ?? [];
  for (const row of rows) {
    const readable = (row.redacted ?? {}) as Record<string, unknown>;
    if (row.kind === 'google') {
      const google = googleReadable({ readable });
      const services = serviceIds.flatMap((id) => {
        const access = accessTo(grants.get(row.id), id);
        return access && google.services.includes(id) ? [{ id, access }] : [];
      });
      if (services.length === 0) continue;
      const allowed = new Set(services.map((service) => service.id));
      listing.google.push({
        account: google.email,
        engine: google.engine,
        services,
        tools: GOOGLE_TOOLS.filter(
          (tool) =>
            allowed.has(tool.service) &&
            (google.engine === 'helena' || tool.gogCommand !== null) &&
            (accessTo(grants.get(row.id), tool.service) === 'write' ||
              toolCategory(tool, {}) === 'read'),
        ).map((tool) => tool.name),
      });
    } else if (row.kind === 'web_login') {
      const loginUrl = typeof readable.loginUrl === 'string' ? readable.loginUrl : null;
      const domains = Array.isArray(readable.allowedDomains)
        ? (readable.allowedDomains as string[])
        : [];
      listing.webLogins.push({
        id: row.id,
        label: row.label ?? '',
        origins: [...new Set([...(loginUrl ? [new URL(loginUrl).origin] : []), ...domains])],
      });
    } else if (row.kind === 'ssh_key') {
      listing.sshKeys.push({
        id: row.id,
        label: row.label ?? '',
        publicKey: typeof readable.publicKey === 'string' ? readable.publicKey : null,
      });
    } else if (typeof readable.envName === 'string') {
      listing.environment.push({
        name: readable.envName,
        label: row.label ?? '',
        secret: row.kind !== 'variable',
      });
    }
  }
  listing.environment.sort((a, b) => a.name.localeCompare(b.name));
  return listing;
}

// The connectors whose tools the member reaches at all, for the MCP tool list: an agent
// sees a connector's tools only while one of its accounts is granted to it.
export async function visibleConnectors(userId: string): Promise<Set<string>> {
  const [agent] = await db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .where(eq(aiAgent.userId, userId));
  if (!agent) return new Set();
  const rows = await db.execute<{ kind: string }>(sql`
    select distinct c.integration_key as kind
      from integration_credential_grant g
      join integration_credential c on c.id = g.credential_id
     where g.agent_id = ${agent.id}
        or g.project_id in (select project_id from project_member where user_id = ${userId})
  `);
  return new Set((rows as unknown as { kind: string }[]).map((row) => row.kind));
}
