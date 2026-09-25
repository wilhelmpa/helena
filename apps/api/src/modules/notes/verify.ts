import { sql } from 'drizzle-orm';
import { Elysia } from 'elysia';
import { getSessionFromHeaders } from '@repo/auth';
import { db } from '@repo/db';
import { user } from '@repo/db/schema';
import { EdgeAccessError } from '../edge-access/providers';
import { edgeEntry, verifyEdgeRequest } from '../edge-access/service';

// The notes (the tool "Notizen": SilverBullet on the knowledge vault, deployment/volition-stack/
// native/notes) run on an origin of their own and have no sign-in of their own: nginx asks
// this check before every request (auth_request /_helena_notes_auth). The notes reach the
// whole vault except Private/, and a note may hold script, so they are the owner's alone, in
// his browser, never through an API key. docs/helena-decisions/notes-silverbullet.md §3.
//
// - At home (https://<home name>:<port>) the browser brings Helena's host-only session cookie
//   (a cookie belongs to the name, not the port): the session must be the owner's.
// - Through the tunnel (https://helena-notes.<domain>, marked X-Helena-Entry by nginx) no
//   Helena cookie arrives: Cloudflare Access's assertion must hold (signature, audience,
//   issuer, the allow list) and name the e-mail of the owner's Helena account.
export type NotesVerdict = 204 | 401 | 403;

async function ownerByEmail(email: string): Promise<boolean> {
  const [row] = await db
    .select({ role: user.role, active: user.active })
    .from(user)
    .where(sql`lower(${user.email}) = ${email.trim().toLowerCase()}`)
    .limit(1);
  return row?.role === 'god' && row.active !== false;
}

export async function notesOwnerCheck(headers: Headers): Promise<NotesVerdict> {
  if (headers.has('x-api-key') || headers.has('authorization')) return 403;
  if (edgeEntry(headers)) {
    let email: string | null;
    try {
      email = (await verifyEdgeRequest(headers)).email;
    } catch (error) {
      if (error instanceof EdgeAccessError) return 403;
      throw error;
    }
    return email && (await ownerByEmail(email)) ? 204 : 403;
  }
  const session = await getSessionFromHeaders(headers);
  if (!session || session.user.active === false) return 401;
  return session.user.role === 'god' ? 204 : 403;
}

export const notesVerifyRoutes = new Elysia({ name: 'notes-verify' }).get(
  '/auth/verify/notes',
  async ({ request, set, status }) => {
    set.headers['Cache-Control'] = 'no-store';
    return status(await notesOwnerCheck(request.headers));
  },
  {
    detail: {
      tags: ['System'],
      summary: 'Check the owner for the notes proxy',
      description:
        "nginx's auth_request target in front of the notes (Notizen). 204 for the instance " +
        "owner: his signed-in session at home, or through the tunnel a Cloudflare Access " +
        "assertion naming his account's e-mail. 401 without a session, 403 for anyone else, " +
        'for an invalid assertion and for any request that carries an API key.',
    },
  },
);
