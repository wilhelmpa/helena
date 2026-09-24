import type { Holder } from './lock.ts';
import { ProjectBrowserLocks } from './lock.ts';
import { CREDENTIAL_TOOLS, requiresLock, toolByName } from './tools.ts';
import { HOME_SLUG, projectSlug } from './project-slug.ts';
import { hostAllowed } from './domain.ts';
import type { PlanClient, ResolveResult } from './plan-client.ts';
import { PlanApiError } from './plan-client.ts';
import type { GatewaySession, SessionProvider, ToolOutput } from './session-types.ts';

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
  // browser_upload only: the file the shim read inside the agent's sandbox.
  upload?: { name: string; mimeType?: string; data: string };
}

export type GatewayResponse =
  | { ok: true; content: string; image?: { data: string; mimeType: string } }
  | { ok: false; error: string };

// What the live view shows while an agent waits for the owner (design §4 browser_handover,
// §7 CAPTCHA): the reason, who asks, since when.
export interface HandoverNotice {
  reason: string;
  agentName: string;
  since: number;
}

// Tool calls on one project browser run one after another, whoever sends them (an agent's
// parallel tool calls, the Home-Master and a project agent): two actions interleaving on
// one page would each act on a page the other just changed.
export class SlugQueue {
  #tails = new Map<string, Promise<unknown>>();

  run<T>(slug: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(slug) ?? Promise.resolve();
    const next = previous.then(work, work);
    const tail = next.catch(() => {});
    this.#tails.set(slug, tail);
    void tail.then(() => {
      if (this.#tails.get(slug) === tail) this.#tails.delete(slug);
    });
    return next;
  }
}

export interface DispatcherOptions {
  ownSlug: string; // which project-browser socket this dispatcher instance serves
  planClient: PlanClient;
  locks: ProjectBrowserLocks;
  sessions: SessionProvider;
  queue?: SlugQueue;
  // Shows or clears the handover card in the project browser's live view.
  onHandover?: (slug: string, notice: HandoverNotice | null) => void;
  // Remembers which agent acts on a browser (for the downloads that browser makes) and the
  // project's settings (the page size an agent works at).
  onActor?: (slug: string, agentKey: string, settings: ResolveResult['settings']) => void;
}

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

function str(args: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = args?.[key];
  return typeof value === 'string' ? value : undefined;
}

function num(args: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = args?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function bool(args: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = args?.[key];
  return typeof value === 'boolean' ? value : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.hostname : null;
  } catch {
    return null;
  }
}

export class GatewayDispatcher {
  #ownSlug: string;
  #planClient: PlanClient;
  #locks: ProjectBrowserLocks;
  #sessions: SessionProvider;
  #queue: SlugQueue;
  #onHandover: NonNullable<DispatcherOptions['onHandover']>;
  #onActor: NonNullable<DispatcherOptions['onActor']>;

  constructor(options: DispatcherOptions) {
    this.#ownSlug = options.ownSlug;
    this.#planClient = options.planClient;
    this.#locks = options.locks;
    this.#sessions = options.sessions;
    this.#queue = options.queue ?? new SlugQueue();
    this.#onHandover = options.onHandover ?? (() => {});
    this.#onActor = options.onActor ?? (() => {});
  }

  // Resolves which project browser a request targets. Only the connection accepted on the
  // Home socket may name another project at all (design §5: "Der Home-Master bekommt das
  // Gateway mit Recht auf alle Projekte") — every other connection's own socket already IS
  // its one project, by construction (the isolation launcher binds only that one), and a
  // `project` in its args is refused rather than silently ignored. Plan checks the same
  // again (the socket the call came through is sent along as `via`).
  #targetSlug(args: Record<string, unknown> | undefined): { slug: string } | { error: string } {
    const projectKey = str(args, 'project');
    if (projectKey === undefined || projectKey === '') return { slug: this.#ownSlug };
    if (this.#ownSlug !== HOME_SLUG) {
      return { error: 'Only the Home-Master may act on another project.' };
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(projectKey)) {
      return { error: `Invalid project: ${projectKey.slice(0, 40)}` };
    }
    return { slug: projectKey.toLowerCase() === HOME_SLUG ? HOME_SLUG : projectSlug(projectKey) };
  }

  async handle(request: GatewayRequest): Promise<GatewayResponse> {
    const tool = toolByName(request.tool);
    if (!tool) return { ok: false, error: `Unknown tool: ${request.tool}` };

    const target = this.#targetSlug(request.args);
    if ('error' in target) return { ok: false, error: target.error };
    const slug = target.slug;

    let resolved: ResolveResult;
    try {
      resolved = await this.#planClient.resolve(request.agentKey, slug, this.#ownSlug);
    } catch (error) {
      if (error instanceof PlanApiError) return { ok: false, error: error.message };
      return { ok: false, error: 'Could not reach Helena.' };
    }
    if (!resolved.browserGatewayEnabled) {
      return { ok: false, error: 'The Projekt-Browser tool is not enabled for this agent.' };
    }
    this.#onActor(slug, request.agentKey, resolved.settings);

    const holder: Holder = {
      kind: 'agent',
      agentId: resolved.agentId,
      agentName: resolved.agentName,
    };
    const lock = this.#locks.of(slug, resolved.settings.lockTimeoutSec * 1000);

    if (request.tool === 'browser_status') return this.#status(slug, holder);
    if (request.tool === 'browser_acquire') {
      const timeoutSec = clamp(num(request.args, 'timeoutSec') ?? 30, 0, 600);
      const result = await lock.acquire(holder, timeoutSec);
      if (!result.acquired) {
        const blockedBy = result.blockedBy;
        const name = blockedBy?.kind === 'agent' ? blockedBy.agentName : 'the owner';
        return {
          ok: false,
          error: `Still controlled by ${name}. Try browser_acquire again later, or browser_handover if you need the owner.`,
        };
      }
      return { ok: true, content: 'Control acquired. Call browser_snapshot to see the page.' };
    }
    if (request.tool === 'browser_release') {
      if (!lock.release(holder)) {
        return { ok: false, error: 'This agent does not hold control.' };
      }
      await this.#queue.run(slug, async () => {
        const session = await this.#sessions.get(slug).catch(() => null);
        await session?.closeTabsOf(resolved.agentId).catch(() => {});
      });
      return { ok: true, content: 'Control released.' };
    }
    if (request.tool === 'browser_handover') return this.#handover(request, slug, resolved);

    if (requiresLock(request.tool) && !lock.touch(holder)) {
      const current = lock.state().holder;
      const by =
        current === null
          ? ''
          : current.kind === 'owner'
            ? ' The owner controls it.'
            : ` ${current.agentName} controls it.`;
      return { ok: false, error: `Control is not held. Call browser_acquire first.${by}` };
    }

    if (
      request.tool === 'browser_navigate' ||
      (request.tool === 'browser_tabs' && str(request.args, 'action') === 'open')
    ) {
      const url = str(request.args, 'url');
      const host = url ? hostOf(url) : null;
      if (!host || !hostAllowed(resolved.settings, host)) {
        return {
          ok: false,
          error: `Navigation to ${url?.slice(0, 200) ?? '(no url)'} is blocked by this project's browser settings or is not an http(s) address.`,
        };
      }
    }

    return this.#queue.run(slug, async () => {
      let session: GatewaySession;
      try {
        session = await this.#sessions.get(slug);
      } catch {
        return { ok: false as const, error: 'The project browser is not reachable.' };
      }
      session.setHumanInput(resolved.settings.humanInput);
      // Design §8: keeps the network guard in sync with the project's current settings
      // before anything else runs — a no-op when nothing changed.
      try {
        await session.applyDomainPolicy(resolved.settings);
      } catch {
        return {
          ok: false as const,
          error: "The project's domain rules could not be applied, so nothing was done.",
        };
      }
      try {
        const output = await this.#runTool(request, session, slug, resolved);
        if (!CREDENTIAL_TOOLS.has(request.tool)) {
          void this.#planClient
            .audit({
              agentKey: request.agentKey,
              projectSlug: slug,
              via: this.#ownSlug,
              actor: 'agent',
              tool: request.tool,
              target: this.#targetLabel(request),
            })
            .catch(() => {});
        }
        return {
          ok: true as const,
          content: session.guard.redact(output.text),
          ...(output.image && { image: output.image }),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Playwright's messages carry a call log; the first line says what went wrong.
        const first = message.split('\n')[0]!.slice(0, 500);
        return { ok: false as const, error: session.guard.redact(first) };
      }
    });
  }

  // A short, non-secret label for the audit: an address without its query, a ref, a tab.
  #targetLabel(request: GatewayRequest): string | undefined {
    const url = str(request.args, 'url');
    if (url) {
      try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname}`.slice(0, 300);
      } catch {
        return undefined;
      }
    }
    const ref = str(request.args, 'ref');
    if (ref) return `ref ${ref}`;
    const tab = str(request.args, 'tabId');
    if (tab) return `tab ${tab}`;
    if (request.upload) return request.upload.name.slice(0, 200);
    return undefined;
  }

  async #status(slug: string, caller: Holder): Promise<GatewayResponse> {
    const state = this.#locks.of(slug).state();
    const holder = state.holder;
    const by =
      holder === null
        ? 'nobody (free)'
        : holder.kind === 'owner'
          ? 'the owner'
          : holder.kind === 'agent' && caller.kind === 'agent' && holder.agentId === caller.agentId
            ? 'you'
            : holder.agentName;
    let pageInfo: string;
    try {
      const session = await this.#sessions.get(slug);
      const status = await session.status();
      pageInfo =
        ` Active tab: ${status.url}${status.title ? ` — "${status.title.slice(0, 120)}"` : ''}.` +
        ` Tabs: ${status.tabCount}. Dialog open: ${status.dialogOpen ? 'yes' : 'no'}.`;
      pageInfo = session.guard.redact(pageInfo);
    } catch {
      pageInfo = ' The project browser is not reachable right now.';
    }
    return { ok: true, content: `Controlled by: ${by}.${pageInfo}` };
  }

  // Waits until the owner has taken over (Übernehmen) and given control back
  // (Zurückgeben), or the time is up.
  #waitForOwner(slug: string, timeoutMs: number): Promise<'done' | 'timeout'> {
    return new Promise((resolve) => {
      let ownerSeen = this.#locks.of(slug).state().holder?.kind === 'owner';
      let finished = false;
      const finish = (outcome: 'done' | 'timeout') => {
        if (finished) return;
        finished = true;
        off();
        clearTimeout(timer);
        resolve(outcome);
      };
      const off = this.#locks.onChange((changed, state) => {
        if (changed !== slug) return;
        if (state.holder?.kind === 'owner') ownerSeen = true;
        else if (ownerSeen) finish('done');
      });
      const timer = setTimeout(() => finish('timeout'), timeoutMs);
    });
  }

  async #handover(
    request: GatewayRequest,
    slug: string,
    resolved: ResolveResult,
  ): Promise<GatewayResponse> {
    const reason = (str(request.args, 'reason') ?? '').trim().slice(0, 500);
    if (!reason) return { ok: false, error: 'reason is required: say what the owner should do.' };
    const timeoutSec = clamp(num(request.args, 'timeoutSec') ?? 300, 30, 1800);
    const card = await this.#planClient
      .handover({
        agentKey: request.agentKey,
        projectSlug: slug,
        via: this.#ownSlug,
        reason,
        runId: request.runId,
        messageId: request.messageId,
      })
      .catch(() => null);
    this.#onHandover(slug, { reason, agentName: resolved.agentName, since: Date.now() });
    void this.#planClient
      .audit({
        agentKey: request.agentKey,
        projectSlug: slug,
        via: this.#ownSlug,
        actor: 'agent',
        tool: 'browser_handover',
        target: reason.slice(0, 200),
      })
      .catch(() => {});
    let outcome: 'done' | 'timeout';
    try {
      outcome = await this.#waitForOwner(slug, timeoutSec * 1000);
    } finally {
      this.#onHandover(slug, null);
    }
    if (card?.approvalId) {
      await this.#planClient
        .handoverDone({ approvalId: card.approvalId, finished: outcome === 'done' })
        .catch(() => {});
    }
    return outcome === 'done'
      ? {
          ok: true,
          content:
            'The owner took over and gave control back. Call browser_acquire, then ' +
            'browser_snapshot to see what changed.',
        }
      : {
          ok: true,
          content:
            `The owner did not take over within ${timeoutSec} s. ` +
            (card?.approvalId
              ? 'The request stays open in Helena (Freigaben); when the owner has done it, you are told in a new run. Stop here for now.'
              : 'Try again later or stop here.'),
        };
  }

  // One dispatch table over the fixed tool list.
  async #runTool(
    request: GatewayRequest,
    session: GatewaySession,
    slug: string,
    resolved: ResolveResult,
  ): Promise<ToolOutput> {
    const args = request.args;
    const text = (value: string): ToolOutput => ({ text: value });
    switch (request.tool) {
      case 'browser_navigate': {
        const url = str(args, 'url');
        if (!url) throw new Error('url is required.');
        return text(await session.navigate(url));
      }
      case 'browser_back':
        return text(await session.back());
      case 'browser_reload':
        return text(await session.reload());
      case 'browser_snapshot':
        return text(await session.snapshot());
      case 'browser_click':
        return text(
          await session.click(
            this.#requireRef(args),
            str(args, 'button') as 'left' | 'right' | 'middle' | undefined,
          ),
        );
      case 'browser_type': {
        const value = str(args, 'text');
        if (value === undefined) throw new Error('text is required.');
        return text(await session.type(this.#requireRef(args), value, bool(args, 'submit')));
      }
      case 'browser_select': {
        const values = args?.values;
        if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
          throw new Error('values is required: a list of option values or labels.');
        }
        return text(await session.select(this.#requireRef(args), values as string[]));
      }
      case 'browser_hover':
        return text(await session.hover(this.#requireRef(args)));
      case 'browser_drag': {
        const fromRef = str(args, 'fromRef');
        const toRef = str(args, 'toRef');
        if (!fromRef || !toRef) throw new Error('fromRef and toRef are required.');
        return text(await session.drag(fromRef, toRef));
      }
      case 'browser_press': {
        const key = str(args, 'key');
        if (!key) throw new Error('key is required.');
        return text(await session.press(key));
      }
      case 'browser_scroll': {
        const direction = str(args, 'direction') as 'up' | 'down' | 'left' | 'right' | undefined;
        if (!direction || !['up', 'down', 'left', 'right'].includes(direction)) {
          throw new Error('direction is required: up, down, left or right.');
        }
        return text(await session.scroll(direction, num(args, 'amount') ?? 3, str(args, 'ref')));
      }
      case 'browser_screenshot':
        return session.screenshot(str(args, 'ref'));
      case 'browser_tabs': {
        const action = str(args, 'action') as 'list' | 'open' | 'focus' | 'close' | undefined;
        if (!action || !['list', 'open', 'focus', 'close'].includes(action)) {
          throw new Error('action is required: list, open, focus or close.');
        }
        return text(
          await session.tabs(action, {
            url: str(args, 'url'),
            tabId: str(args, 'tabId'),
            agentId: resolved.agentId,
          }),
        );
      }
      case 'browser_dialog': {
        const action = str(args, 'action') as 'accept' | 'dismiss' | undefined;
        if (action !== 'accept' && action !== 'dismiss') {
          throw new Error('action is required: accept or dismiss.');
        }
        return text(await session.dialogAction(action, str(args, 'promptText')));
      }
      case 'browser_upload': {
        const upload = request.upload;
        if (!upload || typeof upload.data !== 'string' || typeof upload.name !== 'string') {
          throw new Error(
            'No file arrived. Give `path`, a file in your workspace or your project folder.',
          );
        }
        const buffer = Buffer.from(upload.data, 'base64');
        if (buffer.length > MAX_UPLOAD_BYTES) throw new Error('The file is larger than 50 MB.');
        const name = upload.name.split(/[\\/]/).pop()!.slice(0, 180) || 'upload';
        return text(
          await session.upload(this.#requireRef(args), {
            name,
            mimeType: upload.mimeType || 'application/octet-stream',
            buffer,
          }),
        );
      }
      case 'browser_downloads':
        return text(await session.downloads());
      case 'browser_console':
        return text(await session.console(num(args, 'limit') ?? 50));
      case 'browser_network':
        return text(await session.network(num(args, 'limit') ?? 50));
      case 'browser_login':
        return text(await this.#login(request, session, slug));
      case 'browser_login_code':
        return text(await this.#loginCode(request, session));
      default:
        throw new Error(`Tool not implemented: ${request.tool}`);
    }
  }

  #requireRef(args: Record<string, unknown> | undefined): string {
    const ref = str(args, 'ref');
    if (!ref) throw new Error('ref is required — call browser_snapshot first.');
    return ref;
  }

  async #login(request: GatewayRequest, session: GatewaySession, slug: string): Promise<string> {
    const args = request.args;
    const usernameRef = str(args, 'usernameRef');
    const passwordRef = str(args, 'passwordRef');
    if (!usernameRef || !passwordRef) throw new Error('usernameRef and passwordRef are required.');
    // Design §6: the login is chosen for the origin of the frame the password field is in
    // (a login form in an iframe of another site gets that site's login, not the tab's).
    const frameOrigin = await session.frameOrigin(passwordRef);
    const result = await this.#planClient.login(
      request.agentKey,
      slug,
      this.#ownSlug,
      frameOrigin,
      num(args, 'credentialId'),
      { runId: request.runId, messageId: request.messageId },
    );
    if (result.status === 'none') {
      return `No login granted to you matches ${frameOrigin}. Ask the owner to grant one in Zugänge, or use browser_handover.`;
    }
    if (result.status === 'choose') {
      const list = result.candidates.map((c) => `#${c.id} ${c.label} (${c.username})`).join(', ');
      return `Several logins match ${frameOrigin} — call browser_login again with credentialId: ${list}`;
    }
    session.guard.track(result.login.password);
    await session.fillLogin(
      usernameRef,
      passwordRef,
      result.login.username,
      result.login.password,
      frameOrigin,
    );
    return `Filled ${result.login.label} (${result.login.username}) on ${frameOrigin}.${result.login.has2fa ? ` This login has 2FA — when the code field shows, use browser_login_code with credentialId ${result.login.id}.` : ''}`;
  }

  async #loginCode(request: GatewayRequest, session: GatewaySession): Promise<string> {
    const args = request.args;
    const ref = this.#requireRef(args);
    const credentialId = num(args, 'credentialId');
    if (credentialId === undefined) throw new Error('credentialId is required.');
    const result = await this.#planClient.loginCode(
      request.agentKey,
      credentialId,
      await session.frameOrigin(ref),
      { runId: request.runId, messageId: request.messageId },
    );
    session.guard.track(result.code);
    await session.fillCode(ref, result.code);
    return `Filled the current code (valid ${result.secondsRemaining}s more).`;
  }
}
