import { timingSafeEqual } from 'node:crypto';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import type { SignInEvent } from './sign-in-events';

// The trail is written through the database; loaded on use, so the checks here stay
// testable without one.
const recordSignIn = async (event: SignInEvent) =>
  (await import('./sign-in-events')).recordSignIn(event);

export function localOwnerAuthorized(headers: Headers, env = process.env): boolean {
  const token = env.LOCAL_SINGLE_USER_TOKEN;
  const supplied = headers.get('x-volition-local-access');
  return Boolean(
    env.HELENA_LOCAL_SIGN_IN_MODE === 'single-user' &&
    env.LOCAL_SINGLE_USER_EMAIL &&
    token &&
    token.length >= 32 &&
    supplied &&
    Buffer.byteLength(token) === Buffer.byteLength(supplied) &&
    timingSafeEqual(Buffer.from(token), Buffer.from(supplied)),
  );
}

export function localOwner() {
  return {
    id: 'local-owner',
    endpoints: {
      signInLocalOwner: createAuthEndpoint(
        '/sign-in/local-owner',
        {
          method: 'POST',
        },
        async (ctx) => {
          if (!localOwnerAuthorized(ctx.headers ?? new Headers())) {
            throw new APIError('NOT_FOUND', { message: 'Not found' });
          }
          const { hasMultipleHumans } = await import('./human-account');
          if (await hasMultipleHumans())
            throw new APIError('FORBIDDEN', { message: 'Personal sign-in required' });
          const account = await ctx.context.internalAdapter.findUserByEmail(
            process.env.LOCAL_SINGLE_USER_EMAIL!,
          );
          if (!account || !('role' in account.user) || account.user.role !== 'god') {
            throw new APIError('FORBIDDEN', { message: 'Local owner unavailable' });
          }
          const session = await ctx.context.internalAdapter.createSession(account.user.id);
          if (!session) throw new APIError('FORBIDDEN', { message: 'Local session unavailable' });
          await setSessionCookie(ctx, { session, user: account.user });
          // The trail of password-less sign-ins (Administrator → Sicherheit). The web app
          // passes the client's address and browser on; a failed write does not stop the
          // sign-in at home.
          await recordSignIn({
            method: 'local_owner',
            outcome: 'ok',
            userId: account.user.id,
            ipAddress: ctx.headers?.get('x-real-ip'),
            userAgent: ctx.headers?.get('user-agent'),
          });
          ctx.setHeader('Cache-Control', 'no-store');
          return ctx.json({ success: true });
        },
      ),
    },
  };
}
