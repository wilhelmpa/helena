import { Elysia } from 'elysia';
import { HttpError } from '#shared/lib';
import { commonErrors, errors } from '#shared/responses';
import { LocalTerminalKindParam } from './model';
import { bootstrapLocalTerminal, localTerminalResponse } from './local-model';

// Native-only capabilities are never cookies, personal API keys or agent keys.
// Each capability is minted from the existing signed interactive-owner grant.
export const ownerLocalInferenceRoutes = new Elysia({ name: 'owner-local-inference' })
  .onError(({ error, code, set }) => {
    set.headers['cache-control'] = 'no-store';
    set.status = error instanceof HttpError ? error.status : code === 'VALIDATION' ? 400 : 500;
    return { error: error instanceof HttpError ? error.message : 'local_terminal_request_failed' };
  })
  .onBeforeHandle(({ request }) => {
    if (
      request.headers.has('cookie') ||
      request.headers.has('origin') ||
      request.headers.has('x-api-key') ||
      request.headers.has('sec-fetch-site') ||
      request.headers.has('x-real-ip') ||
      request.headers.has('x-forwarded-for') ||
      request.headers.has('forwarded')
    ) {
      throw new HttpError(403, 'local_terminal_native_only');
    }
  })
  .post(
    '/owner-terminal/local/:kind/bootstrap',
    ({ params, request, set }) => {
      set.headers['cache-control'] = 'no-store';
      return bootstrapLocalTerminal(request, params.kind);
    },
    {
      parse: 'none',
      params: LocalTerminalKindParam,
      response: { ...commonErrors, ...errors(503) },
      detail: { hide: true, summary: 'Exchange a native owner-terminal proof for local inference' },
    },
  )
  .post(
    '/owner-terminal/local/:kind/v1/responses',
    ({ params, request }) => localTerminalResponse(request, params.kind),
    {
      parse: 'none',
      params: LocalTerminalKindParam,
      detail: {
        hide: true,
        summary: 'Bounded local Responses inference for an active owner terminal',
      },
    },
  );
