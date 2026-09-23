import type { Holder } from './lock.ts';
import { ProjectBrowserLocks } from './lock.ts';
import { CREDENTIAL_TOOLS, requiresLock, toolByName } from './tools.ts';
import { HOME_SLUG, projectSlug } from './project-slug.ts';
import { hostAllowed } from './domain.ts';
import type { PlanClient } from './plan-client.ts';
import { PlanApiError } from './plan-client.ts';
import type { SessionProvider } from './session-types.ts';

// The gateway's tool dispatcher (design §3/§4): one instance per project-browser socket
// (see browser-gateway-server.mjs), wired to that socket's own slug. Everything here is
// plain logic over injected dependencies (PlanClient, a SessionProvider, the shared lock
// registry) so it is fully unit-testable without patchright or a live Plan API — session.ts
// (the real, patchright-backed SessionProvider) and the deployment glue are the only pieces
// that need a real browser or a real Plan.

export interface GatewayRequest {
  tool: string;
  args?: Record<string, unknown>;
  agentKey: string;
  runId?: number;
  messageId?: number;
}

export type GatewayResponse = { ok: true; content: string } | { ok: false; error: string };

export interface ControlNotifier {
  (slug: string, holder: Holder | null): void;
}

export interface DispatcherOptions {
  ownSlug: string; // which project-browser socket this dispatcher instance serves
  planClient: PlanClient;
  locks: ProjectBrowserLocks;
  sessions: SessionProvider;
  notify?: ControlNotifier;
}

function str(args: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = args?.[key];
  return typeof value === 'string' ? value : undefined;
}

function num(args: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = args?.[key];
  return typeof value === 'number' ? value : undefined;
}

function bool(args: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = args?.[key];
  return typeof value === 'boolean' ? value : undefined;
}

export class GatewayDispatcher {
  #ownSlug: string;
  #planClient: PlanClient;
  #locks: ProjectBrowserLocks;
  #sessions: SessionProvider;
  #notify: ControlNotifier;

  constructor(options: DispatcherOptions) {
    this.#ownSlug = options.ownSlug;
    this.#planClient = options.planClient;
    this.#locks = options.locks;
    this.#sessions = options.sessions;
    this.#notify = options.notify ?? (() => {});
  }

  // Resolves which project browser a request targets. Only the connection accepted on the
  // Home socket may name another project at all (design §5: "Der Home-Master bekommt das
  // Gateway mit Recht auf alle Projekte") — every other connection's own socket already IS
  // its one project, by construction (see the isolation launcher's per-project bind), and a
  // `project` in its args is refused rather than silently ignored, so a bug elsewhere is
  // caught here instead of quietly acting on the wrong browser.
  #targetSlug(args: Record<string, unknown> | undefined): { slug: string } | { error: string } {
    const projectKey = str(args, 'project');
    if (projectKey === undefined) return { slug: this.#ownSlug };
    if (this.#ownSlug !== HOME_SLUG) {
      return { error: 'Only the Home-Master may act on another project.' };
    }
    return { slug: projectSlug(projectKey) };
  }

  async handle(request: GatewayRequest): Promise<GatewayResponse> {
    const tool = toolByName(request.tool);
    if (!tool) return { ok: false, error: `Unknown tool: ${request.tool}` };

    const target = this.#targetSlug(request.args);
    if ('error' in target) return { ok: false, error: target.error };
    const slug = target.slug;

    let resolved;
    try {
      resolved = await this.#planClient.resolve(request.agentKey, slug);
    } catch (error) {
      if (error instanceof PlanApiError) return { ok: false, error: error.message };
      return { ok: false, error: 'Could not reach Plan.' };
    }
    if (!resolved.browserGatewayEnabled) {
      return { ok: false, error: 'The Projekt-Browser tool is not enabled for this agent.' };
    }

    const holder: Holder = {
      kind: 'agent',
      agentId: resolved.agentId,
      agentName: resolved.agentName,
    };
    const lock = this.#locks.of(slug, resolved.settings.lockTimeoutSec * 1000);

    if (request.tool === 'browser_status') {
      return this.#status(slug, lock);
    }
    if (request.tool === 'browser_acquire') {
      const timeoutSec = num(request.args, 'timeoutSec') ?? 30;
      const result = await lock.acquire(holder, timeoutSec);
      this.#notify(slug, lock.state().holder);
      if (!result.acquired) {
        const blockedBy = result.blockedBy;
        const name = blockedBy?.kind === 'agent' ? blockedBy.agentName : 'the owner';
        return { ok: false, error: `Still controlled by ${name}.` };
      }
      return { ok: true, content: 'Control acquired.' };
    }
    if (request.tool === 'browser_release') {
      const released = lock.release(holder);
      this.#notify(slug, lock.state().holder);
      return released
        ? { ok: true, content: 'Control released.' }
        : { ok: false, error: 'This agent does not currently hold control.' };
    }
    if (request.tool === 'browser_handover') {
      // The card and the wait live in the live view / web layer (design §5's "Übergabe-
      // Karte"); the gateway's own part is just: log the reason, keep the lock as-is (so
      // "Übernehmen" is what actually changes it), and let the caller poll browser_status.
      const reason = str(request.args, 'reason') ?? '';
      void this.#planClient
        .audit({
          agentKey: request.agentKey,
          projectSlug: slug,
          actor: 'agent',
          tool: 'browser_handover',
          target: reason.slice(0, 200),
        })
        .catch(() => {});
      return {
        ok: true,
        content: `Handover requested: ${reason}. Waiting for the owner in the live view.`,
      };
    }

    if (requiresLock(request.tool) && !lock.touch(holder)) {
      return { ok: false, error: 'Control is not held. Call browser_acquire first.' };
    }

    let session;
    try {
      session = await this.#sessions.get(slug);
    } catch {
      return { ok: false, error: 'The project browser is not reachable.' };
    }

    // Design §8: keeps the network guard in sync with the project's current settings
    // before anything else runs — applyDomainPolicy is a no-op when nothing changed, so
    // this costs nothing on the common path.
    await session.applyDomainPolicy(resolved.settings).catch(() => {});

    if (request.tool === 'browser_navigate') {
      const url = str(request.args, 'url');
      const host = url ? this.#hostOf(url) : null;
      if (!host || !hostAllowed(resolved.settings, host)) {
        return {
          ok: false,
          error: `Navigation to ${url ?? '(no url)'} is blocked by this project's browser settings.`,
        };
      }
    }

    try {
      const content = await this.#runTool(request, session, slug);
      const redacted = session.guard.redact(content);
      if (!CREDENTIAL_TOOLS.has(request.tool)) {
        void this.#planClient
          .audit({
            agentKey: request.agentKey,
            projectSlug: slug,
            actor: 'agent',
            tool: request.tool,
            target: this.#targetLabel(request),
          })
          .catch(() => {});
      }
      return { ok: true, content: redacted };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: session.guard.redact(message) };
    }
  }

  #hostOf(url: string): string | null {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  }

  #targetLabel(request: GatewayRequest): string | undefined {
    const url = str(request.args, 'url');
    if (url) return url;
    const ref = str(request.args, 'ref');
    if (ref) return `ref ${ref}`;
    return undefined;
  }

  async #status(
    slug: string,
    lock: ReturnType<ProjectBrowserLocks['of']>,
  ): Promise<GatewayResponse> {
    const state = lock.state();
    const by =
      state.holder === null
        ? 'free'
        : state.holder.kind === 'owner'
          ? 'owner'
          : state.holder.agentName;
    let pageInfo = '';
    try {
      const session = await this.#sessions.get(slug);
      const status = await session.status();
      pageInfo = ` URL: ${status.url}. Tabs: ${status.tabCount}. Dialog open: ${status.dialogOpen}.`;
    } catch {
      pageInfo = ' The project browser is not reachable right now.';
    }
    return { ok: true, content: `Controlled by: ${by}.${pageInfo}` };
  }

  // One dispatch table over the fixed tool list is clearer here than splitting it across N
  // tiny wrapper functions that all do the same "pull args, call the matching session
  // method" shape.
  async #runTool(
    request: GatewayRequest,
    session: Awaited<ReturnType<SessionProvider['get']>>,
    slug: string,
  ): Promise<string> {
    const args = request.args;
    switch (request.tool) {
      case 'browser_navigate': {
        const url = str(args, 'url');
        if (!url) throw new Error('url is required.');
        return session.navigate(url);
      }
      case 'browser_back':
        return session.back();
      case 'browser_reload':
        return session.reload();
      case 'browser_snapshot':
        return session.snapshot();
      case 'browser_click':
        return session.click(
          this.#requireRef(args),
          str(args, 'button') as 'left' | 'right' | 'middle' | undefined,
        );
      case 'browser_type': {
        const text = str(args, 'text');
        if (text === undefined) throw new Error('text is required.');
        return session.type(this.#requireRef(args), text, bool(args, 'submit'));
      }
      case 'browser_select': {
        const values = args?.values;
        if (!Array.isArray(values)) throw new Error('values is required.');
        return session.select(this.#requireRef(args), values as string[]);
      }
      case 'browser_hover':
        return session.hover(this.#requireRef(args));
      case 'browser_drag': {
        const fromRef = str(args, 'fromRef');
        const toRef = str(args, 'toRef');
        if (!fromRef || !toRef) throw new Error('fromRef and toRef are required.');
        return session.drag(fromRef, toRef);
      }
      case 'browser_press': {
        const key = str(args, 'key');
        if (!key) throw new Error('key is required.');
        return session.press(key);
      }
      case 'browser_scroll': {
        const direction = str(args, 'direction') as 'up' | 'down' | 'left' | 'right' | undefined;
        if (!direction) throw new Error('direction is required.');
        return session.scroll(direction, num(args, 'amount') ?? 3, str(args, 'ref'));
      }
      case 'browser_screenshot':
        return session.screenshot(str(args, 'ref'));
      case 'browser_tabs': {
        const action = str(args, 'action') as 'list' | 'open' | 'focus' | 'close' | undefined;
        if (!action) throw new Error('action is required.');
        return session.tabs(action, str(args, 'url'), str(args, 'tabId'));
      }
      case 'browser_dialog': {
        const action = str(args, 'action') as 'accept' | 'dismiss' | undefined;
        if (!action) throw new Error('action is required.');
        return session.dialogAction(action, str(args, 'promptText'));
      }
      case 'browser_upload': {
        const path = str(args, 'path');
        if (!path) throw new Error('path is required.');
        return session.upload(this.#requireRef(args), path);
      }
      case 'browser_downloads':
        return session.downloads();
      case 'browser_console':
        return session.console(num(args, 'limit') ?? 50);
      case 'browser_network':
        return session.network(num(args, 'limit') ?? 50);
      case 'browser_login':
        return this.#login(request, session, slug);
      case 'browser_login_code':
        return this.#loginCode(request, session);
      default:
        throw new Error(`Tool not implemented: ${request.tool}`);
    }
  }

  #requireRef(args: Record<string, unknown> | undefined): string {
    const ref = str(args, 'ref');
    if (!ref) throw new Error('ref is required — call browser_snapshot first.');
    return ref;
  }

  async #login(
    request: GatewayRequest,
    session: Awaited<ReturnType<SessionProvider['get']>>,
    slug: string,
  ): Promise<string> {
    const args = request.args;
    const usernameRef = str(args, 'usernameRef');
    const passwordRef = str(args, 'passwordRef');
    if (!usernameRef || !passwordRef) throw new Error('usernameRef and passwordRef are required.');
    const status = await session.status();
    const frameOrigin = new URL(status.url).origin;
    const result = await this.#planClient.login(
      request.agentKey,
      slug,
      frameOrigin,
      num(args, 'credentialId'),
      { runId: request.runId, messageId: request.messageId },
    );
    if (result.status === 'none') return 'No granted login matches this page.';
    if (result.status === 'choose') {
      const list = result.candidates.map((c) => `#${c.id} ${c.label} (${c.username})`).join(', ');
      return `Several logins match — call browser_login again with credentialId: ${list}`;
    }
    session.guard.track(result.login.password);
    await session.fillLogin(usernameRef, passwordRef, result.login.username, result.login.password);
    return `Filled ${result.login.label} (${result.login.username}).${result.login.has2fa ? ' This login has 2FA — use browser_login_code next.' : ''}`;
  }

  async #loginCode(
    request: GatewayRequest,
    session: Awaited<ReturnType<SessionProvider['get']>>,
  ): Promise<string> {
    const args = request.args;
    const ref = this.#requireRef(args);
    const credentialId = num(args, 'credentialId');
    if (credentialId === undefined) throw new Error('credentialId is required.');
    const result = await this.#planClient.loginCode(request.agentKey, credentialId, {
      runId: request.runId,
      messageId: request.messageId,
    });
    session.guard.track(result.code);
    await session.fillCode(ref, result.code);
    return `Filled the current code (valid ${result.secondsRemaining}s more).`;
  }
}
