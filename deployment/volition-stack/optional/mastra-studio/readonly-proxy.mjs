import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';

const catalog = JSON.parse(await readFile(new URL('./catalog/flows.json', import.meta.url), 'utf8'));
const ownerEmail = process.env.STUDIO_OWNER_EMAIL;
if (!ownerEmail) throw new Error('STUDIO_OWNER_EMAIL is required');
const inboxAdapterTokenPath = process.env.INBOX_ADAPTER_TOKEN_FILE;
if (!inboxAdapterTokenPath?.startsWith('/run/secrets/')) {
  throw new Error('INBOX_ADAPTER_TOKEN_FILE must be a mounted Docker secret');
}
const inboxAdapterToken = (await readFile(inboxAdapterTokenPath, 'utf8')).trim();
if (Buffer.byteLength(inboxAdapterToken) < 32 || inboxAdapterToken.length > 2048) {
  throw new Error('The inbox adapter token is invalid');
}
const workflowIds = new Set(catalog.flows.map(flow => flow.id));
const inboxRuns = new Map();
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
  const match = path.match(/^\/workflows\/([a-z0-9-]+)\/(create-run|start|start-async|stream|resume|resume-async|resume-no-wait|resume-stream|restart-async)$/);
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
function authorized(header, expected) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const wanted = Buffer.from(expected);
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}
async function upstreamJson(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:4112/mastra/api${path}`, {
    ...options,
    signal: AbortSignal.timeout(330_000),
  });
  const text = await response.text();
  let value = null;
  try { value = text ? JSON.parse(text) : null; } catch { /* handled below */ }
  return { status: response.status, ok: response.ok, value };
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
  if (!authorized(req.headers.authorization, inboxAdapterToken)) {
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
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function catalogHtml() {
  return '<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Control Plane – Verträge und Grenzen</title><style>body{max-width:960px;margin:40px auto;padding:0 24px;font:16px/1.6 system-ui;background:#111923;color:#e8edf5}a{color:#9bd0ff}section{margin:36px 0;padding-top:10px;border-top:1px solid #445}code{overflow-wrap:anywhere;font-size:13px}.warning{color:#ffda95}</style><h1>Sichere Control Plane</h1><p>Die sechs Abläufe sind echte typisierte Mastra-Workflows. Inbox-Triage nutzt produktiv die projektgebundene, providerneutrale Capability inbox-triage.v1. Gmail-Zugangsdaten, Agent-ID, Provider und Modell bleiben im Host-Adapter. Die übrigen Workflows erzeugen im Dry-Run deterministische Pläne. Externe Sends und Writes pausieren zur Freigabe.</p><p>Der bestehende Plan-Worker bleibt alleiniger Inbox- und Ticket-Writer.</p><p><a href="/mastra/workflows">Zu den Workflows</a> · <a href="/">It’s a Plan</a></p>'
    + catalog.flows.map(flow => `<section><h2><a href="/mastra/workflows/${encodeURIComponent(flow.id)}/graph">${escape(flow.name)}</a></h2><p>${escape(flow.description)}</p><ol>${flow.steps.map(step => `<li><strong>${escape(step.title)}</strong><p>${escape(step.description)}</p><small>${step.sourceRefs.map(ref => `<code>${escape(ref)}</code>`).join('<br>')}</small></li>`).join('')}</ol><ul class="warning">${flow.currentLimits.map(warning => `<li>${escape(warning)}</li>`).join('')}</ul></section>`).join('') + '</html>';
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/healthz' && req.method === 'GET') {
      const response = await fetch('http://127.0.0.1:4112/mastra/api/workflows', { signal: AbortSignal.timeout(2000) });
      return json(res, response.ok ? 200 : 503, { ok: response.ok, mode: 'safe-control-plane', workflows: workflowIds.size });
    }
    if (req.url === '/internal/inbox/triage' && req.method === 'POST') {
      return await internalInbox(req, res);
    }
    if (req.headers['x-volition-auth'] !== 'verified' || req.headers['x-auth-request-email'] !== ownerEmail) {
      return json(res, 403, { error: 'Cloudflare-authenticated gateway access required' });
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
      hostname: '127.0.0.1', port: 4112, path: req.url, method: req.method,
      // Never send Plan cookies, Access assertions, or authentication material to Mastra.
      headers: {
        accept: req.headers.accept ?? '*/*',
        'accept-encoding': 'identity',
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
        response.on('end', () => res.end(Buffer.concat(chunks).toString('utf8').replace(/      \(function \(\) \{[\s\S]*?      \}\)\(\);/, '').replace('</head>', `${style}</head>`).replace(/<body([^>]*)>/, `<body$1>${banner}`)));
      } else response.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('Upstream timeout')));
    upstream.on('error', () => { if (!res.headersSent) json(res, 502, { error: 'Studio is starting or unavailable' }); else res.destroy(); });
    upstream.end(body);
  } catch {
    if (!res.headersSent) json(res, 503, { error: 'Studio is starting or unavailable' }); else res.destroy();
  }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(Number(process.env.STUDIO_PROXY_PORT ?? 4111), process.env.STUDIO_PROXY_HOST ?? '127.0.0.1');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
