import { serverRuntimeEnv } from '@/utils/runtimeEnv';
import { workspaceFrameOrigins } from '@/utils/workspaceTools';

// The api origin is read from the running server, so the policy is built per
// request (src/proxy.ts) rather than frozen into the build with the other headers
// in next.config.ts. A value that is not an absolute URL contributes nothing: the
// policy then only allows same-origin requests.
function apiOrigin(): string {
  try {
    return new URL(serverRuntimeEnv().apiUrl).origin;
  } catch {
    return '';
  }
}

// Scripts run by nonce ("strict CSP"): the proxy makes a fresh nonce per request, Next
// puts it on its own scripts and its flight payload, and the two inline scripts of the
// layout (RuntimeEnvScript, the next-themes bootstrap) carry it. 'strict-dynamic' lets a
// script with the nonce load Next's chunks. A browser that knows nonces ignores the
// fallbacks after them ('unsafe-inline', https:, http:), which only an old browser without
// CSP level 3 reads; so HTML that got into a page (agent-written markdown) runs nothing.
// Without a nonce (a caller outside the proxy) the policy keeps the old inline allowance.
// Inline styles are what tiptap, Radix, recharts and Scalar emit.
// Scripts may compile WebAssembly ('wasm-unsafe-eval', which allows no eval of JavaScript).
// Images and media come from anywhere: markdown embeds by URL, OAuth profile
// pictures, and the /media proxy on this origin. React evals in development only,
// to rebuild server error stacks in the browser. Frames come from this origin, where
// the file viewer opens a PDF, from the configured workspace tools, and from the api,
// which serves plugins' panel pages.
export function contentSecurityPolicy(nonce?: string): string {
  const frameOrigins = workspaceFrameOrigins(serverRuntimeEnv().workspace);
  const scriptSources = [
    ...(nonce
      ? [`'nonce-${nonce}'`, "'strict-dynamic'", 'https:', 'http:', "'unsafe-inline'"]
      : ["'self'", "'unsafe-inline'"]),
    // WebAssembly may be compiled (not JavaScript evaluated): the conversation mode's voice
    // detector runs Silero VAD in ONNX Runtime's WebAssembly build (features/voice).
    "'wasm-unsafe-eval'",
    ...(process.env.NODE_ENV === 'development' ? ["'unsafe-eval'"] : []),
  ].join(' ');
  return [
    "default-src 'self'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http:",
    "media-src 'self' data: blob: https: http:",
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin()}`.trimEnd(),
    // The service worker (public/sw.js) that shows push notifications. Named on its own:
    // workers fall back to script-src, whose nonce no worker script can carry.
    "worker-src 'self'",
    // Plugins' panel pages come from the api (/plugins/<id>/ui/…), sandboxed.
    ["frame-src 'self'", ...frameOrigins, apiOrigin()].filter(Boolean).join(' '),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
