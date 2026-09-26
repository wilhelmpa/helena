import {
  db,
  agentRun,
  integrationCredential,
  integrationCredentialUse,
  issue,
  project,
} from '@repo/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { iso } from '#shared/lib';
import type { UseAction } from './delivery';

// The audit log of the access center, read per credential or for the whole team, and the
// entries a person's own changes write ('changed'). Such an entry's purpose is the change's
// key, then a space and a detail where there is one ("clone <url> <folder>"); the page
// names the key in the viewer's language.

export const OWNER_CHANGES = [
  'created',
  'edited',
  'deleted',
  'new-key',
  'grants',
  'signed-in',
  'settings',
  'removed',
  'listed-from-gog',
  'clone',
  // An agent's own runtime login signed out in Zugänge (access-logins); no credential.
  'signed-out',
] as const;
export type OwnerChange = (typeof OWNER_CHANGES)[number];

export async function recordOwnerChange(
  teamId: number,
  credentialId: number,
  person: { name?: string | null; email?: string | null } | null | undefined,
  change: OwnerChange,
  detail?: string,
): Promise<void> {
  const purpose = detail ? `${change} ${detail}` : change;
  const [row] = await db
    .select({ label: integrationCredential.label })
    .from(integrationCredential)
    .where(
      and(eq(integrationCredential.id, credentialId), eq(integrationCredential.teamId, teamId)),
    );
  if (!row) return;
  await db.insert(integrationCredentialUse).values({
    teamId,
    credentialId,
    credentialLabel: row.label ?? '',
    agentId: null,
    agentName: person?.name || person?.email || '',
    action: 'changed',
    purpose: purpose.slice(0, 500),
  });
}

export interface AuditEntry {
  id: number;
  credentialId: number | null;
  credentialLabel: string;
  action: UseAction;
  category: string | null;
  purpose: string;
  agentId: number | null;
  agentName: string;
  runId: number | null;
  issueIdentifier: string | null;
  chatMessageId: number | null;
  createdAt: string;
}

// Newest first. `credentialId` narrows it to one credential, `actions` to some actions.
export async function listAudit(
  teamId: number,
  filter: { credentialId?: number; actions?: UseAction[] },
  window: { limit: number; offset: number },
): Promise<{ items: AuditEntry[]; total: number }> {
  const where = and(
    eq(integrationCredentialUse.teamId, teamId),
    filter.credentialId === undefined
      ? undefined
      : eq(integrationCredentialUse.credentialId, filter.credentialId),
    filter.actions?.length ? inArray(integrationCredentialUse.action, filter.actions) : undefined,
  );
  const [rows, counted] = await Promise.all([
    db
      .select({
        id: integrationCredentialUse.id,
        credentialId: integrationCredentialUse.credentialId,
        credentialLabel: integrationCredentialUse.credentialLabel,
        action: integrationCredentialUse.action,
        category: integrationCredentialUse.category,
        purpose: integrationCredentialUse.purpose,
        agentId: integrationCredentialUse.agentId,
        agentName: integrationCredentialUse.agentName,
        runId: integrationCredentialUse.runId,
        issueIdentifier: sql<
          string | null
        >`case when ${issue.id} is null then null else ${project.key} || '-' || ${issue.sequenceNumber} end`,
        chatMessageId: integrationCredentialUse.chatMessageId,
        createdAt: integrationCredentialUse.createdAt,
      })
      .from(integrationCredentialUse)
      .leftJoin(agentRun, eq(agentRun.id, integrationCredentialUse.runId))
      .leftJoin(issue, eq(issue.id, agentRun.issueId))
      .leftJoin(project, eq(project.id, issue.projectId))
      .where(where)
      .orderBy(desc(integrationCredentialUse.createdAt), desc(integrationCredentialUse.id))
      .limit(window.limit)
      .offset(window.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(integrationCredentialUse)
      .where(where),
  ]);
  return {
    items: rows.map((row) => ({
      ...row,
      action: row.action as UseAction,
      createdAt: iso(row.createdAt),
    })),
    total: counted[0]?.count ?? 0,
  };
}
