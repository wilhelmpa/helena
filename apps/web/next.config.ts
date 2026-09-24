import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Two paths that hold only while this repository is the workspace root. A build that
// nests it under another one overrides them; unset, they are what they have always been.
const tracingRoot = process.env.WEB_TRACING_ROOT ?? path.join(import.meta.dirname, '../../');
// Where `@/cloud` resolves. Unset, tsconfig resolves it to src/ce, the stubs a
// self-hosted instance runs.
const cloudUiEntry = process.env.CLOUD_UI_ENTRY;

// Fixed on every response. The Content-Security-Policy is not here: it names the api
// origin, which is read from the environment at startup (utils/runtimeEnv), while this
// list is frozen into the build. It is set per request in src/proxy.ts.
// HSTS is sent on plain http too, where browsers ignore it, so a local instance is
// unaffected and one behind TLS gets it without a second setting.
const SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Passkeys and same-origin microphone input are the powerful features the app uses;
  // the rest is switched off for this origin and for anything it might embed.
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(self), geolocation=(), payment=(), usb=(), ' +
      'publickey-credentials-get=(self), publickey-credentials-create=(self)',
  },
];

const nextConfig: NextConfig = {
  // Native LAN development is reverse-proxied through Nginx. Next otherwise
  // blocks its own HMR/client resources and leaves the server-rendered UI inert.
  allowedDevOrigins: ['kingston-server.local', 'kingston-server'],
  // standalone build for a lean docker image.
  output: 'standalone',
  poweredByHeader: false,
  // Set by web-release.sh to the commit being built: Next then notices when an open page
  // belongs to an older release and loads the new one in full on its next navigation.
  ...(process.env.NEXT_DEPLOYMENT_ID ? { deploymentId: process.env.NEXT_DEPLOYMENT_ID } : {}),
  headers: async () => [{ source: '/(.*)', headers: SECURITY_HEADERS }],
  // Monorepo: include the repo root in file tracing for standalone.
  outputFileTracingRoot: tracingRoot,
  // isomorphic-dompurify loads jsdom on the server, and jsdom reads its own data
  // files (default-stylesheet.css) by a path relative to its module. Bundling it
  // breaks that path, so it is required from node_modules at runtime instead.
  serverExternalPackages: ['isomorphic-dompurify'],
  // @repo/agent-naming, @helena/sdk, @helena/locales and @helena/brand ship plain TypeScript source (no
  // build step, like every package in this monorepo) — Next only bundles that from a
  // workspace package when it is listed here, otherwise it is served/imported unprocessed
  // from node_modules. The web imports only @helena/sdk/web, which has no server code.
  transpilePackages: ['@repo/agent-naming', '@helena/sdk', '@helena/locales', '@helena/brand'],
  // next dev otherwise appends a block of its own to apps/web/AGENTS.md on every
  // start, which leaves the working tree dirty for anyone running the dev server.
  agentRules: false,
  // The live instance runs `next dev` (dev mode, see CLAUDE.md), and the owner uses it
  // as the real app: the floating "N" / "Issues" badge sat over the sidebar's account
  // row. Errors still reach the browser console and the terminal.
  devIndicators: false,
  ...(cloudUiEntry ? { turbopack: { resolveAlias: { '@/cloud': cloudUiEntry } } } : {}),
};

export default createNextIntlPlugin('./src/i18n/request.ts')(nextConfig);
