import { db, browserGatewayEvent } from '@repo/db';
import { and, desc, eq, lt } from 'drizzle-orm';
import { iso } from '#shared/lib';

// The gateway's own audit trail (design §9: "Browser-Aktionen in der Aktivität/Audit (ohne
// Werte)") for tool calls that are not a login fill/2FA read — those already have a home in
// integration_credential_use (agents/credentials/delivery.ts), which records a label and an
// origin, never a secret. This one records a tool name and a short, non-secret target label
// the caller chose itself (a tab title, an origin, a file name — never a URL query string or
// page content).

export interface BrowserGatewayEventInput {
  projectId: number;
  agentId: number;
  agentName: string;
  actor: 'agent' | 'owner';
  tool: string;
  target: string | null;
}

export async function recordBrowserGatewayEvent(input: BrowserGatewayEventInput): Promise<void> {
  await db.insert(browserGatewayEvent).values(input);
}

export interface BrowserGatewayEventRow {
  id: number;
  agentId: number | null;
  agentName: string;
  actor: 'agent' | 'owner';
  tool: string;
  target: string | null;
  createdAt: string;
}

// Newest first, for the project's Aktivität feed (a "Browser" filter — see
// apps/api/src/modules/agent-activity for the merge this can join) and for the live view's
// own recent-actions strip.
export async function listBrowserGatewayEvents(
  projectId: number,
  query: { limit?: number; before?: number } = {},
): Promise<{ items: BrowserGatewayEventRow[]; nextBefore: number | null }> {
  const limit = query.limit ?? 50;
  const conditions = [eq(browserGatewayEvent.projectId, projectId)];
  if (query.before) conditions.push(lt(browserGatewayEvent.id, query.before));
  const rows = await db
    .select()
    .from(browserGatewayEvent)
    .where(and(...conditions))
    .orderBy(desc(browserGatewayEvent.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    items: page.map((row) => ({
      id: row.id,
      agentId: row.agentId,
      agentName: row.agentName,
      actor: row.actor as 'agent' | 'owner',
      tool: row.tool,
      target: row.target,
      createdAt: iso(row.createdAt),
    })),
    nextBefore: rows.length > limit ? page[page.length - 1].id : null,
  };
}
