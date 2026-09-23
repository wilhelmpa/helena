import { timingSafeEqual } from 'node:crypto';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';

export function localOwnerAuthorized(headers: Headers, env = process.env): boolean {
  const token = env.LOCAL_SINGLE_USER_TOKEN;
  const supplied = headers.get('x-volition-local-access');
  return Boolean(
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
          const account = await ctx.context.internalAdapter.findUserByEmail(
            process.env.LOCAL_SINGLE_USER_EMAIL!,
          );
          if (!account || !('role' in account.user) || account.user.role !== 'god') {
            throw new APIError('FORBIDDEN', { message: 'Local owner unavailable' });
          }
          const session = await ctx.context.internalAdapter.createSession(account.user.id);
          if (!session) throw new APIError('FORBIDDEN', { message: 'Local session unavailable' });
          await setSessionCookie(ctx, { session, user: account.user });
          ctx.setHeader('Cache-Control', 'no-store');
          return ctx.json({ success: true });
        },
      ),
    },
  };
}
