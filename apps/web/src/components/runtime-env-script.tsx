import { headers } from 'next/headers';
import { connection } from 'next/server';
import { appOrigins, serverRuntimeEnv } from '@/utils/runtimeEnv';
import { requestOrigin } from '@/utils/appOrigins';
import { getDisplayName } from '@/i18n/displayName';

// Publishes the per-instance origins to the browser. It renders before any bundle
// script, so a client module reading runtimeEnv() at import time already sees them.
// `connection()` keeps the values out of a prerender: a page rendered at build time
// would carry the building machine's environment into the HTML.
// `<` is escaped because the JSON is written into an inline script, where a
// `</script>` inside a value would end the element.
// It carries the request's script nonce (see src/proxy.ts), which the policy requires.
// The addresses follow the origin the page was opened on (utils/appOrigins.ts).
export default async function RuntimeEnvScript() {
  await connection();
  const requestHeaders = await headers();
  const nonce = requestHeaders.get('x-nonce') ?? undefined;
  const origin = requestOrigin(requestHeaders, appOrigins());
  const json = JSON.stringify({
    ...serverRuntimeEnv(origin),
    displayName: await getDisplayName(),
  }).replace(/</g, '\\u003c');
  return (
    <script nonce={nonce} dangerouslySetInnerHTML={{ __html: `window.__ITSAPLAN_ENV__=${json}` }} />
  );
}
