import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createEventIngressService, EventIngressError } from './event-ingress.mjs';
import { createMastraControlService, MastraControlError } from '../../integration/mastra-control.mjs';

const catalog = JSON.parse(await readFile(new URL('./catalog/flows.json', import.meta.url), 'utf8'));
const workflowIds = new Set(catalog.flows.map(flow => flow.id));
const apiReads = new Set([
  '/auth/capabilities', '/auth/me', '/agents', '/tools', '/workflows',
  '/stored/workflows', '/workspaces', '/memory/status', '/processors',
  '/scorers', '/vectors', '/system/packages', '/system/api-schema',
  '/mcp/v0/servers', '/scores/scorers', '/workflows/run-counts',
  '/observability/feedback', '/experiments/review-summary', '/editor/builder/settings',
  '/control-plane-catalog',
]);
const banner = '<aside id="volition-studio-notice" role="note">'
  + '<strong>Control Plane</strong> — Inbox-Triage ist produktiv über die projektgebundene Capability; weitere Abläufe bleiben im sicheren Dry-Run. '
  + 'Externe Sends pausieren weiterhin zur Freigabe. '
  + '<a href="/mastra/catalog">Verträge &amp; Grenzen</a> · <a href="/">Zurück zu It’s a Plan</a></aside>';
const style = '<style>#volition-studio-notice{height:44px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;padding:6px 14px;background:#172b41;color:#e3efff;font:12px/1.35 system-ui;border-bottom:1px solid #356081;overflow:auto}#volition-studio-notice a{color:#a8d7ff;text-decoration:underline}body{overflow:hidden!important}#root{height:calc(100dvh - 44px)!important;min-height:0!important}#root>div{max-height:calc(100dvh - 44px)}</style>';
const headers = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'none'",
};
function json(res, status, value) {
  res.writeHead(status, { ...headers, 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}
function apiAllowed(path) {
  if (apiReads.has(path)) return true;
  if (/^\/schedules(?:\/[A-Za-z0-9_-]+(?:\/triggers)?)?$/.test(path)) return true;
  const match = path.match(/^\/workflows\/([a-z0-9-]+)(?:\/(runs)(?:\/([a-zA-Z0-9_-]+))?)?$/);
  return Boolean(match && workflowIds.has(match[1]));
}
function apiWriteAllowed(method, path) {
  if (method === 'DELETE' && /^\/schedules\/[A-Za-z0-9_-]+$/.test(path)) return true;
  if (method !== 'POST' && method !== 'PATCH') return false;
  if (path === '/schedules' && method === 'POST') return true;
  if (/^\/schedules\/[A-Za-z0-9_-]+(?:\/(?:pause|resume|run))?$/.test(path)) return true;
  const cancel = path.match(/^\/workflows\/([a-z0-9-]+)\/runs\/([a-zA-Z0-9_-]+)\/cancel$/);
  if (cancel) return workflowIds.has(cancel[1]);
  const match = path.match(/^\/workflows\/([a-z0-9-]+)\/(create-run|start|start-async|stream|resume|resume-async|resume-no-wait|resume-stream|restart-async|time-travel)$/);
  return Boolean(match && workflowIds.has(match[1]));
}
async function readBody(req, limit = 128 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function sameSecret(given, expected) {
  if (typeof given !== 'string' || !expected) return false;
  const supplied = Buffer.from(given);
  const wanted = Buffer.from(expected);
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}
function bearer(header) {
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined;
}
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function catalogHtml() {
  return '<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Control Plane – Verträge und Grenzen</title><style>body{max-width:960px;margin:40px auto;padding:0 24px;font:16px/1.6 system-ui;background:#111923;color:#e8edf5}a{color:#9bd0ff}section{margin:36px 0;padding-top:10px;border-top:1px solid #445}code{overflow-wrap:anywhere;font-size:13px}.warning{color:#ffda95}</style><h1>Sichere Control Plane</h1><p>Die sechs Abläufe sind echte typisierte Mastra-Workflows. Inbox-Triage nutzt produktiv die projektgebundene, providerneutrale Capability inbox-triage.v1. Gmail-Zugangsdaten, Agent-ID, Provider und Modell bleiben im Host-Adapter. Die übrigen Workflows erzeugen im Dry-Run deterministische Pläne. Externe Sends und Writes pausieren zur Freigabe.</p><p>Der bestehende Plan-Worker bleibt alleiniger Inbox- und Ticket-Writer.</p><p><a href="/mastra/workflows">Zu den Workflows</a> · <a href="/">It’s a Plan</a></p>'
    + catalog.flows.map(flow => `<section><h2><a href="/mastra/workflows/${encodeURIComponent(flow.id)}/graph">${escape(flow.name)}</a></h2><p>${escape(flow.description)}</p><ol>${flow.steps.map(step => `<li><strong>${escape(step.title)}</strong><p>${escape(step.description)}</p><small>${step.sourceRefs.map(ref => `<code>${escape(ref)}</code>`).join('<br>')}</small></li>`).join('')}</ol><ul class="warning">${flow.currentLimits.map(warning => `<li>${escape(warning)}</li>`).join('')}</ul></section>`).join('') + '</html>';
}

// The proxy in front of Mastra. Mastra accepts only `upstreamToken`, which this proxy
// adds to every request it forwards. Plan's control requests need `controlToken`, the
// event and inbox ingress `ingressToken`, and Studio the `gatewayToken` that Nginx adds
// after Plan confirmed the instance owner. Without an ingress or gateway token that
// route is closed.
export function createStudioProxy({ upstreamPort, upstreamToken, controlToken, ingressToken = null, gatewayToken = null }) {
  const upstreamAuthorization = `Bearer ${upstreamToken}`;
  const inboxRuns = new Map();

  async function upstreamJson(path, options = {}) {
    const response = await fetch(`http://127.0.0.1:${upstreamPort}/mastra/api${path}`, {
      ...options,
      headers: { ...options.headers, authorization: upstreamAuthorization },
      signal: AbortSignal.timeout(330_000),
    });
    const text = await response.text();
    let value = null;
    try { value = text ? JSON.parse(text) : null; } catch { /* handled below */ }
    return { status: response.status, ok: response.ok, value };
  }
  const eventIngress = createEventIngressService({
    catalog,
    lookupRun: async (workflowId, eventId) => {
      const response = await upstreamJson(
        `/workflows/${workflowId}/runs/${encodeURIComponent(eventId)}`,
      );
      if (response.status === 404) return null;
      if (!response.ok || !response.value) {
        throw new EventIngressError(502, 'mastra_lookup_failed', 'Mastra run lookup failed');
      }
      return response.value;
    },
    startWorkflow: async ({ workflowId, eventId, projectRef, envelope }) => {
      const response = await upstreamJson(
        `/workflows/${workflowId}/start-async?runId=${encodeURIComponent(eventId)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            inputData: envelope,
            resourceId: projectRef,
            requestContext: envelope.context,
          }),
        },
      );
      if (!response.ok || !response.value) {
        throw new EventIngressError(502, 'mastra_start_failed', 'Mastra workflow start failed');
      }
      return response.value;
    },
  });
  const planControl = createMastraControlService({
    mastraApiUrl: `http://127.0.0.1:${upstreamPort}/mastra/api/`,
    mastraApiToken: upstreamToken,
    catalog,
  });

  async function internalControl(req, res) {
    if (!sameSecret(bearer(req.headers.authorization), controlToken)) {
      res.setHeader('www-authenticate', 'Bearer');
      return json(res, 401, { error: 'unauthorized' });
    }
    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      return json(res, 415, { error: 'json_required' });
    }
    try {
      const input = JSON.parse((await readBody(req, 128 * 1024)).toString('utf8'));
      return json(res, 200, await planControl.execute(input));
    } catch (error) {
      if (error instanceof MastraControlError) return json(res, error.status, { message: error.message });
      return json(res, 502, { message: 'Workflow control plane failed' });
    }
  }

  async function internalEvent(req, res) {
    if (!sameSecret(bearer(req.headers.authorization), ingressToken)) {
      res.setHeader('www-authenticate', 'Bearer');
      return json(res, 401, { error: 'unauthorized' });
    }
    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      return json(res, 415, { error: 'json_required' });
    }
    let input;
    try {
      input = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'));
    } catch (error) {
      if (error instanceof Error && error.message === 'Request body too large') {
        return json(res, 413, { error: 'request_too_large' });
      }
      return json(res, 400, { error: 'invalid_json' });
    }
    try {
      return json(res, 200, await eventIngress.execute(input));
    } catch (error) {
      if (error instanceof EventIngressError) {
        return json(res, error.status, { error: error.code, message: error.message });
      }
      return json(res, 502, { error: 'event_ingress_failed' });
    }
  }

  async function runInboxWorkflow(envelope) {
    const runId = envelope.eventId;
    const existing = await upstreamJson(`/workflows/inbox-triage/runs/${encodeURIComponent(runId)}?fields=result,error`);
    if (existing.ok && existing.value?.status === 'success') return existing.value.result;
    if (existing.ok && ['running', 'pending'].includes(existing.value?.status)) {
      throw new Error('The inbox workflow is already running');
    }
    const started = await upstreamJson(`/workflows/inbox-triage/start-async?runId=${encodeURIComponent(runId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        inputData: envelope,
        resourceId: envelope.context.projectRef,
        requestContext: {
          organizationRef: envelope.context.organizationRef,
          projectRef: envelope.context.projectRef,
          capabilityRefs: envelope.context.capabilityRefs,
          connectionRefs: envelope.context.connectionRefs,
        },
      }),
    });
    if (!started.ok || started.value?.status !== 'success' || !started.value?.result) {
      throw new Error('The inbox workflow failed');
    }
    return started.value.result;
  }
  async function internalInbox(req, res) {
    if (!sameSecret(bearer(req.headers.authorization), ingressToken)) {
      res.setHeader('www-authenticate', 'Bearer');
      return json(res, 401, { error: 'unauthorized' });
    }
    let envelope;
    try {
      envelope = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'));
    } catch {
      return json(res, 400, { error: 'invalid_request' });
    }
    const keys = envelope && typeof envelope === 'object' && !Array.isArray(envelope)
      ? Object.keys(envelope).sort().join(',') : '';
    if (
      keys !== 'actor,context,correlationId,dryRun,eventId,occurredAt,payload,source' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(envelope.eventId) ||
      envelope.source !== 'hub-inbox' ||
      envelope.dryRun !== false ||
      envelope.actor?.type !== 'service' ||
      envelope.actor?.id !== 'itsaplan-worker' ||
      !/^organization:[A-Za-z0-9._-]+$/.test(envelope.context?.organizationRef ?? '') ||
      !/^project:[A-Za-z0-9._-]+$/.test(envelope.context?.projectRef ?? '') ||
      !Array.isArray(envelope.context?.capabilityRefs) ||
      !envelope.context.capabilityRefs.includes('inbox-triage.v1') ||
      !Array.isArray(envelope.context?.connectionRefs)
    ) {
      return json(res, 400, { error: 'invalid_request' });
    }
    const pending = inboxRuns.get(envelope.eventId) ?? runInboxWorkflow(envelope);
    inboxRuns.set(envelope.eventId, pending);
    try {
      return json(res, 200, await pending);
    } catch {
      return json(res, 502, { error: 'workflow_failed' });
    } finally {
      if (inboxRuns.get(envelope.eventId) === pending) inboxRuns.delete(envelope.eventId);
    }
  }

  return http.createServer(async (req, res) => {
    try {
      if (req.url === '/healthz' && req.method === 'GET') {
        const response = await fetch(`http://127.0.0.1:${upstreamPort}/mastra/api/workflows`, {
          headers: { authorization: upstreamAuthorization },
          signal: AbortSignal.timeout(2000),
        });
        return json(res, response.ok ? 200 : 503, { ok: response.ok, mode: 'safe-control-plane', workflows: workflowIds.size });
      }
      if (req.url === '/internal/events' && ingressToken) {
        if (req.method !== 'POST') {
          res.setHeader('allow', 'POST');
          return json(res, 405, { error: 'method_not_allowed' });
        }
        return await internalEvent(req, res);
      }
      if (req.url === '/internal/inbox/triage' && req.method === 'POST' && ingressToken) {
        return await internalInbox(req, res);
      }
      if (req.url === '/internal/mastra/control') {
        if (req.method !== 'POST') {
          res.setHeader('allow', 'POST');
          return json(res, 405, { error: 'method_not_allowed' });
        }
        return await internalControl(req, res);
      }
      if (!sameSecret(req.headers['x-volition-gateway-token'], gatewayToken)) {
        return json(res, 403, { error: 'Studio is available to the instance owner through Plan only' });
      }
      // Reject ambiguous encodings and path normalization before forwarding.
      if (!req.url?.startsWith('/') || /[%\\]|\/{2}|(?:^|\/)\.{1,2}(?:\/|\?|$)/.test(req.url.split('?')[0])) {
        return json(res, 400, { error: 'Invalid path' });
      }
      const url = new URL(req.url, 'http://studio.invalid');
      const path = url.pathname;
      const apiPath = path.startsWith('/mastra/api/') ? path.slice('/mastra/api'.length) : '';
      const isRead = ['GET', 'HEAD'].includes(req.method);
      if (!isRead && !apiWriteAllowed(req.method, apiPath)) {
        res.setHeader('allow', 'GET, HEAD, POST');
        return json(res, 405, { error: 'Only safe workflow start and resume operations are available.' });
      }
      // This isolated catalog has no traces or feedback. LibSQL does not implement
      // feedback listing, but Studio polls its sidebar badge even without tracing.
      if (path === '/mastra/api/observability/feedback') {
        return json(res, 200, { feedback: [], pagination: { total: 0, page: 0, perPage: 20, hasMore: false }, mode: 'safe-control-plane' });
      }
      if (path === '/mastra/api/control-plane-catalog') {
        return json(res, 200, catalog);
      }
      if (path === '/mastra/catalog') {
        res.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8' });
        return res.end(req.method === 'HEAD' ? undefined : catalogHtml());
      }
      if (path.startsWith('/mastra/api/')) {
        if (isRead && !apiAllowed(apiPath)) return json(res, 403, { error: 'Endpoint not available in the control plane' });
      } else if (!/^\/mastra(?:\/?|\/(?:workflows|agents|tools|scorers|workspaces|observability|datasets|experiments|processors)(?:\/[a-zA-Z0-9_-]+)*\/?|\/assets\/[a-zA-Z0-9_.-]+|(?:\/favicon\.(?:ico|svg)|\/mastra\.svg)|\/index\.html)$/.test(path)) {
        return json(res, 404, { error: 'Not found' });
      }
      const body = isRead ? Buffer.alloc(0) : await readBody(req);
      const upstream = http.request({
        hostname: '127.0.0.1', port: upstreamPort, path: req.url, method: req.method,
        // Only the upstream token reaches Mastra: never Plan cookies, the gateway token or
        // other authentication material of the request.
        headers: {
          accept: req.headers.accept ?? '*/*',
          'accept-encoding': 'identity',
          authorization: upstreamAuthorization,
          ...(body.length > 0 ? { 'content-type': 'application/json', 'content-length': String(body.length) } : {}),
        },
        timeout: 10000,
      }, response => {
        const type = response.headers['content-type'] ?? 'application/octet-stream';
        const responseHeaders = { ...headers, 'content-type': type };
        res.writeHead(response.statusCode ?? 502, responseHeaders);
        if (type.includes('text/html') && req.method !== 'HEAD') {
          const chunks = [];
          response.on('data', chunk => chunks.push(chunk));
          response.on('end', () => res.end(Buffer.concat(chunks).toString('utf8').replace(/ {6}\(function \(\) \{[\s\S]*? {6}\}\)\(\);/, '').replace('</head>', `${style}</head>`).replace(/<body([^>]*)>/, `<body$1>${banner}`)));
        } else response.pipe(res);
      });
      upstream.on('timeout', () => upstream.destroy(new Error('Upstream timeout')));
      upstream.on('error', () => { if (!res.headersSent) json(res, 502, { error: 'Studio is starting or unavailable' }); else res.destroy(); });
      upstream.end(body);
    } catch {
      if (!res.headersSent) json(res, 503, { error: 'Studio is starting or unavailable' }); else res.destroy();
    }
  });
}

async function credential(name) {
  const path = process.env[name];
  if (!path) return null;
  if (!path.startsWith('/run/secrets/') && !path.startsWith('/run/credentials/')) {
    throw new Error(`${name} must be a runtime credential`);
  }
  const token = (await readFile(path, 'utf8')).trim();
  if (Buffer.byteLength(token) < 32 || token.length > 2048) throw new Error(`${name} is invalid`);
  return token;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const upstreamToken = process.env.MASTRA_UPSTREAM_TOKEN ?? '';
  if (upstreamToken.length < 32) throw new Error('MASTRA_UPSTREAM_TOKEN is required');
  const controlToken = await credential('MASTRA_CONTROL_TOKEN_FILE');
  if (!controlToken) throw new Error('MASTRA_CONTROL_TOKEN_FILE is required');
  // The development instance runs on other ports.
  const server = createStudioProxy({
    upstreamPort: Number(process.env.MASTRA_UPSTREAM_PORT ?? 4112),
    upstreamToken,
    controlToken,
    ingressToken: await credential('INBOX_ADAPTER_TOKEN_FILE'),
    gatewayToken: await credential('STUDIO_GATEWAY_TOKEN_FILE'),
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.listen(Number(process.env.STUDIO_PROXY_PORT ?? 4111), process.env.STUDIO_PROXY_HOST ?? '127.0.0.1');
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
