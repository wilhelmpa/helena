import { auth, trustedOrigins } from '@repo/auth';
import { HttpError } from '#shared/lib';

// These operations belong to the owner's interactive UI. A personal API key or
// an MCP OAuth credential must not turn an agent into a mail-sending browser.
export async function requireInteractiveOwner(request: Request, userId: string) {
  if (request.headers.has('x-api-key') || request.headers.has('authorization')) {
    throw new HttpError(403, 'Use the signed-in owner interface for this operation');
  }
  const cookie = request.headers.get('cookie');
  if (!cookie) throw new HttpError(403, 'An interactive owner session is required');
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session || session.user.id !== userId || session.user.role !== 'god') {
    throw new HttpError(403, 'An interactive owner session is required');
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const origin = request.headers.get('origin');
    if (!origin || !trustedOrigins.includes(origin)) {
      throw new HttpError(403, 'The request must come from the signed-in application');
    }
  }
}
