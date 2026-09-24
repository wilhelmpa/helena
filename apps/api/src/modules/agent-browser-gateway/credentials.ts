import { db, integrationCredential, integrationCredentialGrant } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { decryptSecret, totpCode, totpSecondsRemaining } from '@repo/crypto';
import { HttpError } from '#shared/lib';
import type { RunnerAgent } from '../agents/runner/service';
import { loginOrigins } from '../agents/credentials/kinds';
import {
  claimedWork,
  deliverWebLogins,
  recordWebLoginUses,
  workRefOf,
  type DeliveredLogin,
} from '../agents/credentials/delivery';

// The browser gateway's own use of the Credentials page's delivery functions
// (agents/credentials/delivery.ts), which already do everything design §6 needs: decrypt
// only for a granted agent, scope to the run or chat answer it holds when it has one, and
// write the "delivered"/"used" audit row with a label and a purpose, never a value. What
// this file adds on top: an origin filter (a login is only offered on a frame whose origin
// it was saved for), stripping totpSecret out of what the gateway receives for filling a
// password (2FA is a separate call, see loginCode below), and accepting a browser gateway
// call that carries no run or chat lease — Claude Code and Codex calls do not have Hermes'
// ITSAPLAN_RUN_ID convention yet — by falling back to a project-scoped check.

export interface GatewayWork {
  runId?: number;
  messageId?: number;
}

interface Claimed {
  runId: number | null;
  chatMessageId: number | null;
  projectId: number | null;
}

async function resolveWork(
  agent: RunnerAgent,
  work: GatewayWork,
  projectId: number | null,
): Promise<Claimed> {
  const ref = workRefOf(work);
  if (!ref) return { runId: null, chatMessageId: null, projectId };
  return claimedWork(agent.id, ref);
}

export type LoginForOrigin =
  | {
      status: 'filled';
      login: { id: number; label: string; username: string; password: string; has2fa: boolean };
    }
  | { status: 'choose'; candidates: { id: number; label: string; username: string }[] }
  | { status: 'none' };

function withoutSecret(login: DeliveredLogin) {
  return {
    id: login.id,
    label: login.label,
    username: login.username,
    password: login.password,
    has2fa: login.totpSecret !== null,
  };
}

// browser_login: no id picks by frame origin (design §6 — the origin of the frame the login
// field lives in, not just the top-level URL); a login used is recorded the same moment it
// is handed to the gateway, since the gateway fills it immediately and the secret itself is
// never held past that.
export async function loginForOrigin(
  agent: RunnerAgent,
  work: GatewayWork,
  projectId: number | null,
  frameOrigin: string,
  credentialId: number | undefined,
): Promise<LoginForOrigin> {
  const claimed = await resolveWork(agent, work, projectId);
  const logins = await deliverWebLogins(agent, claimed);
  const matches = logins.filter((login) => login.origins.includes(frameOrigin));
  if (credentialId !== undefined) {
    const chosen = matches.find((login) => login.id === credentialId);
    if (!chosen) return { status: 'none' };
    await recordWebLoginUses(agent, claimed, [
      { credentialId: chosen.id, tool: 'browser_login', origin: frameOrigin },
    ]);
    return { status: 'filled', login: withoutSecret(chosen) };
  }
  if (matches.length === 0) return { status: 'none' };
  if (matches.length > 1) {
    return {
      status: 'choose',
      candidates: matches.map((login) => ({
        id: login.id,
        label: login.label,
        username: login.username,
      })),
    };
  }
  const only = matches[0];
  await recordWebLoginUses(agent, claimed, [
    { credentialId: only.id, tool: 'browser_login', origin: frameOrigin },
  ]);
  return { status: 'filled', login: withoutSecret(only) };
}

// browser_login_code: the current TOTP code only, computed here, and only for a field on a
// page of the login's own site (a code typed into another site's form would hand that site
// a valid second factor). The secret is decrypted for this one call and discarded; it never
// appears in the response or an audit row.
export async function loginCode(
  agent: RunnerAgent,
  work: GatewayWork,
  credentialId: number,
  frameOrigin: string,
): Promise<{ code: string; secondsRemaining: number }> {
  const [row] = await db
    .select({
      id: integrationCredential.id,
      redacted: integrationCredential.redacted,
      ciphertext: integrationCredential.ciphertext,
      iv: integrationCredential.iv,
      authTag: integrationCredential.authTag,
    })
    .from(integrationCredential)
    .innerJoin(
      integrationCredentialGrant,
      and(
        eq(integrationCredentialGrant.credentialId, integrationCredential.id),
        eq(integrationCredentialGrant.agentId, agent.id),
      ),
    )
    .where(
      and(
        eq(integrationCredential.id, credentialId),
        eq(integrationCredential.teamId, agent.teamId),
        eq(integrationCredential.integrationKey, 'web_login'),
      ),
    );
  if (!row) throw new HttpError(404, 'Login not found or not granted to this agent');
  const readable = row.redacted as { loginUrl: string; allowedDomains?: string[] };
  if (!loginOrigins(readable.loginUrl, readable.allowedDomains ?? []).includes(frameOrigin)) {
    throw new HttpError(403, `This login is not for ${frameOrigin.slice(0, 200)}`);
  }
  const secrets = JSON.parse(decryptSecret(row)) as { totpSecret?: string };
  if (!secrets.totpSecret) throw new HttpError(400, 'This login has no authenticator key');
  const claimed = await resolveWork(agent, work, null);
  await recordWebLoginUses(agent, claimed, [
    { credentialId: row.id, tool: 'browser_login_code', origin: frameOrigin },
  ]);
  return {
    code: totpCode(secrets.totpSecret),
    secondsRemaining: totpSecondsRemaining(secrets.totpSecret),
  };
}
