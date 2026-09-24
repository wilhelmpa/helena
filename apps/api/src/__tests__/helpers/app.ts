import { treaty, type Treaty } from '@elysiajs/eden';
import { app } from '../../app';

// The client's type, computed once as an alias. Letting every `treaty(app)` call infer it
// checks the whole app against Elysia's type once per call, which with the app's size
// runs into TypeScript's instantiation limit (TS2589).
type Client = Treaty.Sign<(typeof app)['~Routes']>;
export const client = treaty as unknown as (domain: typeof app, config?: Treaty.Config) => Client;

// The app itself, for a route Treaty cannot drive (an event stream, where there is no
// JSON body to hand back).
export { app };

// Anonymous Eden Treaty client bound to the in-memory app (no network, no port).
// Use for unauthenticated routes; planner routes return 401 through this.
export const api = client(app);

// Treaty client that sends a session cookie on every request. Pass additional
// headers when the route behavior depends on request metadata.
export function authedApi(cookie: string, headers?: Record<string, string>) {
  return client(app, { headers: { ...headers, cookie } });
}

// Treaty client that authenticates with an API key instead of a session cookie —
// how an external agent and its runner call the API.
export function apiKeyApi(apiKey: string) {
  return client(app, { headers: { 'x-api-key': apiKey } });
}

// Treaty client that authenticates with the instance SCIM token — how an identity
// provider calls /scim/v2.
export function scimApi(token: string) {
  return client(app, { headers: { authorization: `Bearer ${token}` } });
}

export type Api = typeof api;
