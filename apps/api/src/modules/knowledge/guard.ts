import { Elysia, type DocumentDecoration } from 'elysia';
import { normalizeVaultPath, VaultError } from '@repo/vault';
import { requireUser } from '#shared/access';
import { authContext } from '#shared/auth-context';
import { requiresPermission } from '#shared/guards';
import { HttpError } from '#shared/lib';
import { isMcpRequest } from '#shared/mcp-request';
import { canAccess, vaultScope, type VaultAction } from './scope';

export interface VaultAccess {
  action: VaultAction;
  // The query or body fields holding vault paths the route acts on. Each is
  // normalized and checked; the handler reads them from `paths`.
  fields: string[];
}

function fieldValue(source: unknown, field: string): unknown {
  return source && typeof source === 'object'
    ? (source as Record<string, unknown>)[field]
    : undefined;
}

// Resolves the caller's reach in the vault (see scope.ts) and asserts the action on
// every path the route names. Set `vault: { action, fields }` in the route options and
// read `scope` and `paths` in the handler. The permission it publishes for the MCP tool
// table is the Docs one, which is what the role matrix grants in a project.
export const vaultGuard = new Elysia({ name: 'vault-guard' }).use(authContext).macro({
  vault(access: VaultAccess) {
    return {
      detail: requiresPermission([
        'documents',
        access.action === 'read' ? 'read' : 'edit',
      ]) as DocumentDecoration,
      async resolve({ user, query, body, request }) {
        const scope = await vaultScope(
          requireUser(user),
          isMcpRequest(request.headers),
          request.headers,
        );
        const paths: Record<string, string> = {};
        for (const field of access.fields) {
          const raw = fieldValue(query, field) ?? fieldValue(body, field);
          if (raw === undefined) continue;
          if (typeof raw !== 'string') throw new HttpError(400, `${field} must be a path`);
          let relative: string;
          try {
            relative = normalizeVaultPath(raw);
          } catch (error) {
            if (error instanceof VaultError) throw new HttpError(error.status, error.message);
            throw error;
          }
          if (!canAccess(scope, relative, access.action)) {
            throw new HttpError(403, `You cannot ${access.action} ${relative || 'the vault root'}`);
          }
          paths[field] = relative;
        }
        return { scope, paths };
      },
    };
  },
});
