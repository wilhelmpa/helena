import { Elysia } from 'elysia';
import { HttpError } from '#shared/lib';
import { taskByToken, taskSystemOne } from './runs';

// Helena's System One proxy for jev-browser in Browser 2.0 (docs/helena-decisions/browser-task.md
// §3.5): jev-browser posts to `JEV_API_URL` with `Authorization: Bearer <TYPESAFE_API_KEY>`; the
// browser router starts it with this address and the run's one-time token instead of a key. The
// call is made with the run's connection and key, counted on the run, and refused once the run
// ended. Reached over loopback only: a request that came through nginx carries its client
// address and is refused.

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

function viaProxy(request: Request): boolean {
  return request.headers.has('x-real-ip') || request.headers.has('x-forwarded-for');
}

export const browserTaskInternalRoutes = new Elysia({ name: 'browser-task-internal' })
  .post(
    '/internal/systemone/v1/systemone',
    async ({ request }) => {
      if (viaProxy(request)) return json({ detail: 'not found' }, 404);
      const token = bearer(request);
      if (!token || !(await taskByToken(token)))
        return json({ detail: 'invalid or missing bearer token' }, 401);
      let body: { state?: unknown; questions?: unknown };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ detail: 'request body must be valid JSON' }, 400);
      }
      if (!body?.questions || typeof body.questions !== 'object' || Array.isArray(body.questions)) {
        return json({ detail: "request body must be an object with a 'questions' field" }, 422);
      }
      try {
        const reply = await taskSystemOne(token, {
          state: body.state,
          questions: body.questions as Record<string, unknown>,
        });
        return json({
          model: reply.model,
          answers: reply.answers,
          usage: { input_tokens: reply.inputTokens, output_tokens: reply.outputTokens },
        });
      } catch (error) {
        if (error instanceof HttpError) return json({ detail: error.message }, error.status);
        throw error;
      }
    },
    { detail: { hide: true } },
  )
  .get(
    '/internal/systemone/v1/models',
    async ({ request }) => {
      if (viaProxy(request)) return json({ detail: 'not found' }, 404);
      const token = bearer(request);
      const row = token ? await taskByToken(token) : null;
      if (!row) return json({ detail: 'invalid or missing bearer token' }, 401);
      return json({
        models: [
          {
            name: row.modelConfigured ?? 'jev-latest',
            description: row.backendLabel,
            release_date: null,
          },
        ],
      });
    },
    { detail: { hide: true } },
  );
