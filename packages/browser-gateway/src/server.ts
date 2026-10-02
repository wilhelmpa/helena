import type { Holder } from './lock.ts';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import { ProjectBrowserLocks } from './lock.ts';
import {
  BROWSER_TOOLS,
  CREDENTIAL_TOOLS,
  TASK_TOOLS,
  categoryOf,
  normalizeArgs,
  requiresLock,
  toolByName,
  type ToolDef,
} from './tools.ts';
import { runCheckTool, runChooseTool, runTaskTool, type TaskContext } from './task/run.ts';
import type { ActionCategory } from './agent-tool.ts';
import { contractActionCategory } from './contract-action.ts';
import { HOME_SLUG, projectSlug } from './project-slug.ts';
import { originAllowed, previewOriginAllowed, resolvesLocally, type HostLookup } from './domain.ts';
import type { HelenaClient, ResolveResult } from './helena-client.ts';
import { HelenaApiError } from './helena-client.ts';
import {
  checkPreviewNavigation,
  matchingPreview,
  navigationError,
  previewFailure,
  previewFailureMessage,
  type NavigationState,
} from './preview-navigation.ts';
import type {
  ConsoleLevel,
  FormField,
  GatewaySession,
  SessionProvider,
  ToolOutput,
} from './session-types.ts';

// The gateway's tool dispatcher (design §3/§4): one instance per project-browser socket
// (see browser-gateway-server.mjs), wired to that socket's own slug. Everything here is
// plain logic over injected dependencies (HelenaClient, a SessionProvider, the shared lock
// registry) so it is fully unit-testable without patchright or a live Plan API — session.ts
// (the real, patchright-backed SessionProvider) and the deployment glue are the only pieces
// that need a real browser or a real Plan.

export interface GatewayRequest {
  tool: string;
  args?: Record<string, unknown>;
  agentKey: string;
  runId?: number;
  messageId?: number;
  // browser_file_upload only: the files the shim read inside the agent's sandbox (the paths
  // an agent names never reach the gateway).
  uploads?: { name: string; mimeType?: string; data: string }[];
}

export type GatewayResponse =
  | { ok: true; content: string; image?: { data: string; mimeType: string } }
  | { ok: false; error: string; state?: NavigationState };

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
  helena: HelenaClient;
  locks: ProjectBrowserLocks;
  sessions: SessionProvider;
  queue?: SlugQueue;
  // Shows or clears the handover card in the project browser's live view.
  onHandover?: (slug: string, notice: HandoverNotice | null) => void;
  // Remembers which agent acts on a browser (for the downloads that browser makes) and the
  // project's settings (the page size an agent works at).
  onActor?: (slug: string, agentKey: string, settings: ResolveResult['settings']) => void;
  onNavigationState?: (slug: string, state: NavigationState | null) => void;
  checkPreview?: (slug: string, url: string) => ReturnType<typeof checkPreviewNavigation>;
  // How a host an agent navigates to is resolved (tests pass their own).
  lookupHost?: HostLookup;
}

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_UPLOAD_FILES = 10;
const inputValidator = new AjvJsonSchemaValidator();
const toolValidators = new Map(
  BROWSER_TOOLS.map((tool) => [tool.name, inputValidator.getValidator(tool.inputSchema)]),
);

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

// An address as the audit and the policy see it: origin and path, never the query.
function safeLabel(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`.slice(0, 300);
  } catch {
    return null;
  }
}

// The tools whose call may submit a form, and so be a 'send' rather than a 'write'.
const FORM_TOOLS = new Set(['browser_click', 'browser_type', 'browser_press_key']);

const FIELD_TYPES = new Set(['textbox', 'checkbox', 'radio', 'combobox', 'slider']);

function formFields(value: unknown): FormField[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('fields is required: a list of {target, name, type, value}.');
  }
  if (value.length > 50) throw new Error('At most 50 fields at once.');
  return value.map((field, index) => {
    const entry = (field ?? {}) as Record<string, unknown>;
    const target = str(entry, 'target');
    const type = str(entry, 'type');
    const fieldValue = entry.value;
    if (!target) throw new Error(`fields[${index}].target is required.`);
    if (!type || !FIELD_TYPES.has(type)) {
      throw new Error(
        `fields[${index}].type must be textbox, checkbox, radio, combobox or slider.`,
      );
    }
    if (typeof fieldValue !== 'string' && typeof fieldValue !== 'boolean') {
      throw new Error(`fields[${index}].value is required.`);
    }
    return {
      target,
      name: str(entry, 'name') ?? target,
      type: type as FormField['type'],
      value: String(fieldValue),
    };
  });
}

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.hostname : null;
  } catch {
    return null;
  }
}

// What an agent is told when its project browser cannot be used: a project browser that runs
// on demand and did not start says so (the router's BrowserUnavailableError, code
// BROWSER_UNAVAILABLE); anything else is the plain "not reachable".
function unreachable(error: unknown, fallback = 'The project browser is not reachable.'): string {
  const failure = error as { code?: unknown; message?: unknown } | null;
  return failure?.code === 'BROWSER_UNAVAILABLE' && typeof failure.message === 'string'
    ? failure.message
    : fallback;
}

class PreviewNavigationError extends Error {
  state: Extract<NavigationState, { type: 'preview-unreachable' }>;
  constructor(state: Extract<NavigationState, { type: 'preview-unreachable' }>) {
    super(previewFailureMessage(state));
    this.state = state;
  }
}

export class GatewayDispatcher {
  #ownSlug: string;
  #helena: HelenaClient;
  #locks: ProjectBrowserLocks;
  #sessions: SessionProvider;
  #queue: SlugQueue;
  #onHandover: NonNullable<DispatcherOptions['onHandover']>;
  #onActor: NonNullable<DispatcherOptions['onActor']>;
  #lookupHost: HostLookup | undefined;
  #onNavigationState: NonNullable<DispatcherOptions['onNavigationState']>;
  #checkPreview: NonNullable<DispatcherOptions['checkPreview']>;

  constructor(options: DispatcherOptions) {
    this.#ownSlug = options.ownSlug;
    this.#helena = options.helena;
    this.#locks = options.locks;
    this.#sessions = options.sessions;
    this.#queue = options.queue ?? new SlugQueue();
    this.#onHandover = options.onHandover ?? (() => {});
    this.#onActor = options.onActor ?? (() => {});
    this.#lookupHost = options.lookupHost;
    this.#onNavigationState = options.onNavigationState ?? (() => {});
    this.#checkPreview =
      options.checkPreview ??
      ((slug, url) => checkPreviewNavigation(url, () => this.#helena.previews(slug)));
  }

  // Resolves which project browser a request targets. Only the connection accepted on the
  // Home socket may name another project at all (design §5: "Der Home-Master bekommt das
  // Gateway mit Recht auf alle Projekte") — every other connection's own socket already IS
  // its one project, by construction (the isolation launcher binds only that one), and a
  // `project` in its args is refused rather than silently ignored. Helena checks the same
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

  async handle(incoming: GatewayRequest): Promise<GatewayResponse> {
    const tool = toolByName(incoming.tool);
    if (!tool) return { ok: false, error: `Unknown tool: ${incoming.tool}` };
    const request = { ...incoming, args: normalizeArgs(incoming.args) };
    const validation = toolValidators.get(tool.name)!(request.args);
    if (!validation.valid)
      return { ok: false, error: `Invalid ${tool.name} arguments: ${validation.errorMessage}` };

    const target = this.#targetSlug(request.args);
    if ('error' in target) return { ok: false, error: target.error };
    const slug = target.slug;

    let resolved: ResolveResult;
    try {
      resolved = await this.#helena.resolve(request.agentKey, slug, this.#ownSlug);
    } catch (error) {
      if (error instanceof HelenaApiError) return { ok: false, error: error.message };
      return { ok: false, error: 'Could not reach the application.' };
    }
    if (!resolved.browserGatewayEnabled) {
      return { ok: false, error: 'The Projekt-Browser tool is not enabled for this agent.' };
    }
    this.#onActor(slug, request.agentKey, resolved.settings);
    if (TASK_TOOLS.has(request.tool) && !resolved.browserTask?.enabled) {
      return {
        ok: false,
        error:
          "This project's browser has no decision model (Projekt → Einstellungen → Browser: " +
          'Browser-Steuerung "Standard"). Use the step tools (browser_snapshot, browser_click, …).',
      };
    }

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

    // A page action takes control by itself when nobody holds it (agents that know
    // Playwright MCP just navigate); while someone else works, it says who and how to wait.
    if (
      requiresLock(request.tool) &&
      !lock.touch(holder) &&
      !(lock.state().holder === null && (await lock.acquire(holder, 0)).acquired)
    ) {
      const current = lock.state().holder;
      const by =
        current === null
          ? ''
          : current.kind === 'owner'
            ? ' The owner controls it.'
            : ` ${current.agentName} controls it.`;
      return {
        ok: false,
        error: `Someone else works in this browser.${by} Call browser_acquire to wait for it, or browser_handover if you need the owner.`,
      };
    }

    if (
      request.tool === 'browser_navigate' ||
      (request.tool === 'browser_task' && str(request.args, 'startUrl')) ||
      (request.tool === 'browser_tabs' &&
        str(request.args, 'action') === 'new' &&
        str(request.args, 'url'))
    ) {
      const url = str(request.args, 'url') ?? str(request.args, 'startUrl');
      const host = url ? hostOf(url) : null;
      const preview =
        url && host === '127.0.0.1'
          ? await this.#checkPreview(slug, url)
          : { managed: false, state: null };
      if (preview.state) {
        this.#onNavigationState(slug, preview.state);
        return {
          ok: false,
          error: previewFailureMessage(preview.state),
          state: preview.state,
        };
      }
      const managedAllowed =
        preview.managed && !resolved.settings.domainBlocklist.includes('127.0.0.1');
      if (
        host &&
        !resolved.settings.allowLocalAddresses &&
        !previewOriginAllowed(resolved.settings, url ?? '') &&
        !managedAllowed &&
        (await resolvesLocally(host, this.#lookupHost))
      ) {
        return {
          ok: false,
          error:
            `${host} is a local or private address, which this project's browser settings keep closed to agents. ` +
            'For a project dev server, use preview_start and preview_url, then call browser_navigate with the exact returned managed URL. This refusal applies only to the requested address.',
        };
      }
      if (!host || (!originAllowed(resolved.settings, url ?? '') && !managedAllowed)) {
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
      } catch (error) {
        return { ok: false as const, error: unreachable(error) };
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
      // browser_task decides each of its actions itself, like the step tool it stands for.
      const decided = TASK_TOOLS.has(request.tool)
        ? { category: tool.category }
        : await this.#decide(request, tool, session, slug);
      if ('refusal' in decided) return decided.refusal;
      try {
        const output = TASK_TOOLS.has(request.tool)
          ? await this.#runTaskTool(request, session, slug, resolved, holder, lock)
          : await this.#runTool(request, session, slug, resolved);
        if (!CREDENTIAL_TOOLS.has(request.tool)) {
          void this.#helena
            .audit({
              agentKey: request.agentKey,
              projectSlug: slug,
              via: this.#ownSlug,
              actor: 'agent',
              tool: request.tool,
              category: decided.category,
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
        if (error instanceof PreviewNavigationError) {
          return { ok: false as const, error: error.message, state: error.state };
        }
        const url = str(request.args, 'url') ?? str(request.args, 'startUrl') ?? '';
        const state = navigationError(url, error);
        if (
          state &&
          hostOf(url) === '127.0.0.1' &&
          /^(ERR_CONNECTION_|ERR_EMPTY_RESPONSE|ERR_TIMED_OUT)/.test(state.code)
        ) {
          const preview = matchingPreview(url, await this.#helena.previews(slug).catch(() => []));
          if (preview) {
            const failure = previewFailure(preview, url);
            this.#onNavigationState(slug, failure);
            return {
              ok: false as const,
              error: session.guard.redact(previewFailureMessage(failure, state.code)),
              state: failure,
            };
          }
        }
        if (state) this.#onNavigationState(slug, state);
        const message = error instanceof Error ? error.message : String(error);
        // Playwright's messages carry a call log; the first line says what went wrong.
        const first = message.split('\n')[0]!.slice(0, 500);
        return {
          ok: false as const,
          error: session.guard.redact(state?.message ?? first),
          ...(state && { state }),
        };
      }
    });
  }

  // browser_task/check/choose (task/run.ts): the loop on this project's browser, holding the
  // agent's lock for its whole run — every step touches it, and the owner's "Übernehmen" ends
  // the task before its next action.
  async #runTaskTool(
    request: GatewayRequest,
    session: GatewaySession,
    slug: string,
    resolved: ResolveResult,
    holder: Holder,
    lock: ReturnType<ProjectBrowserLocks['of']>,
  ) {
    const ctx: TaskContext = {
      request: {
        tool: request.tool,
        args: request.args ?? {},
        agentKey: request.agentKey,
        runId: request.runId,
        messageId: request.messageId,
      },
      slug,
      via: this.#ownSlug,
      session,
      helena: this.#helena,
      resolved,
      holdsControl: () => lock.touch(holder),
      navigate: async (url: string) => {
        const navigate = toolByName('browser_navigate')!;
        const decided = await this.#decide(
          { ...request, tool: 'browser_navigate', args: { url } },
          navigate,
          session,
          slug,
        );
        if ('refusal' in decided) {
          throw new Error(decided.refusal.ok ? 'Not done.' : decided.refusal.error);
        }
        await this.#navigate(session, slug, url);
      },
    };
    if (request.tool === 'browser_check') return runCheckTool(ctx);
    if (request.tool === 'browser_choose') return runChooseTool(ctx);
    return runTaskTool(ctx);
  }

  // The tools this agent is offered on this socket (the shim's tools/list): every tool, except
  // the fast path's where the project's "Browser-Steuerung" is Standard. Without an answer from
  // Helena, the step tools only.
  async listTools(agentKey: string): Promise<string[]> {
    const steps = BROWSER_TOOLS.filter((tool) => !TASK_TOOLS.has(tool.name)).map(
      (tool) => tool.name,
    );
    try {
      const resolved = await this.#helena.resolve(agentKey, this.#ownSlug, this.#ownSlug);
      if (!resolved.browserTask?.enabled) return steps;
      return BROWSER_TOOLS.map((tool) => tool.name);
    } catch {
      return steps;
    }
  }

  // Helena's policy for this one call (docs/volition-helena-oss.md §3a "Richtlinien"): the
  // call's action category — a click that submits a form is 'send', not 'write' — and what
  // it acts on. Reading needs no answer; anything else is asked, and without an answer
  // nothing is done.
  async #decide(
    request: GatewayRequest,
    tool: ToolDef,
    session: GatewaySession,
    slug: string,
  ): Promise<{ category: ActionCategory } | { refusal: GatewayResponse }> {
    let category = tool.category;
    let formAction: string | null = null;
    let groundedElement: string | null = null;
    if (FORM_TOOLS.has(tool.name)) {
      const form = await session.submitsForm({
        tool: tool.name,
        target: str(request.args, 'target'),
        key: str(request.args, 'key'),
        submit: bool(request.args, 'submit'),
      });
      category = categoryOf(tool, form.submits);
      formAction = form.formAction;
      groundedElement = form.groundedElement ?? null;
      if (tool.name === 'browser_click')
        category = contractActionCategory(groundedElement) ?? category;
    }
    if (category === 'read') return { category };
    let answer;
    try {
      answer = await this.#helena.decide({
        agentKey: request.agentKey,
        projectSlug: slug,
        via: this.#ownSlug,
        tool: tool.name,
        category,
        context: {
          origin: session.pageOrigin(),
          target: this.#targetLabel(request) ?? null,
          element: this.#elementLabel(request),
          formAction: formAction ? safeLabel(formAction) : null,
          groundedElement,
          pagePath: session.pagePath?.() ?? null,
        },
        runId: request.runId,
        messageId: request.messageId,
      });
    } catch (error) {
      const message =
        error instanceof HelenaApiError ? error.message : 'The application did not answer';
      return { refusal: { ok: false, error: `Not done: ${message}.` } };
    }
    if (answer.effect === 'allow') return { category };
    if (answer.effect === 'needs-approval') {
      return {
        refusal: {
          ok: false,
          error:
            `This ${category} action needs the owner's approval first` +
            `${answer.reason ? ` (${answer.reason})` : ''}` +
            `${answer.approvalId ? `, Freigaben #${answer.approvalId}` : ''}. ` +
            'Stop here; once it is decided, a new run tells you.',
        },
      };
    }
    return {
      refusal: {
        ok: false,
        error: `Not allowed for you here: ${answer.reason ?? `${category} actions`}.`,
      },
    };
  }

  // A short, non-secret label for the audit: an address without its query, a ref and the
  // element's description, a tab, the names of uploaded files.
  #targetLabel(request: GatewayRequest): string | undefined {
    const url = str(request.args, 'url');
    if (url) return safeLabel(url) ?? undefined;
    const target = str(request.args, 'target') ?? str(request.args, 'startTarget');
    if (request.uploads?.length) {
      return request.uploads
        .map((file) => file.name)
        .join(', ')
        .slice(0, 200);
    }
    const element = this.#elementLabel(request);
    if (target) return `ref ${target}${element ? ` "${element}"` : ''}`.slice(0, 300);
    const index = num(request.args, 'index');
    if (index !== undefined) return `tab ${index}`;
    return undefined;
  }

  // The element's description the agent gave (Playwright MCP's `element`, "used to obtain
  // permission"): what the policy and an approval card show.
  #elementLabel(request: GatewayRequest): string | null {
    const element = str(request.args, 'element') ?? str(request.args, 'startElement');
    return element ? element.replace(/\s+/g, ' ').trim().slice(0, 120) || null : null;
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
    } catch (error) {
      pageInfo = ` ${unreachable(error, 'The project browser is not reachable right now.')}`;
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
    const card = await this.#helena
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
    void this.#helena
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
      await this.#helena
        .handoverDone({ approvalId: card.approvalId, finished: outcome === 'done' })
        .catch(() => {});
    }
    return outcome === 'done'
      ? {
          ok: true,
          content:
            'The owner took over and gave control back. Call browser_snapshot to see what ' +
            'changed.',
        }
      : {
          ok: true,
          content:
            `The owner did not take over within ${timeoutSec} s. ` +
            (card?.approvalId
              ? `The request stays open in ${resolved.displayName ?? 'Ava'} (Freigaben); when the owner has done it, you are told in a new run. Stop here for now.`
              : 'Try again later or stop here.'),
        };
  }

  // One dispatch table over the fixed tool list.
  async #navigate(session: GatewaySession, slug: string, url: string): Promise<string> {
    const checked = await this.#checkPreview(slug, url);
    if (checked.state) {
      this.#onNavigationState(slug, checked.state);
      throw new PreviewNavigationError(checked.state);
    }
    const result = await session.navigate(url);
    this.#onNavigationState(slug, null);
    return result;
  }

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
        return text(await this.#navigate(session, slug, url));
      }
      case 'browser_navigate_back':
        return text(await session.back());
      case 'browser_reload':
        return text(await session.reload());
      case 'browser_snapshot':
        return text(
          await session.snapshot({ target: str(args, 'target'), depth: num(args, 'depth') }),
        );
      case 'browser_find': {
        const needle = str(args, 'text');
        if (!needle) throw new Error('text is required.');
        return text(await session.find(needle));
      }
      case 'browser_click': {
        const modifiers = Array.isArray(args?.modifiers)
          ? (args.modifiers as unknown[]).filter(
              (key): key is 'Alt' | 'Control' | 'ControlOrMeta' | 'Meta' | 'Shift' =>
                typeof key === 'string' &&
                ['Alt', 'Control', 'ControlOrMeta', 'Meta', 'Shift'].includes(key),
            )
          : undefined;
        const button = str(args, 'button');
        return text(
          await session.click(this.#requireTarget(args), {
            button:
              button === 'right' || button === 'middle' || button === 'left' ? button : undefined,
            doubleClick: bool(args, 'doubleClick'),
            modifiers,
          }),
        );
      }
      case 'browser_type': {
        const value = str(args, 'text');
        if (value === undefined) throw new Error('text is required.');
        return text(await session.type(this.#requireTarget(args), value, bool(args, 'submit')));
      }
      case 'browser_fill_form':
        return text(await session.fillForm(formFields(args?.fields)));
      case 'browser_select_option': {
        const values = args?.values;
        if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
          throw new Error('values is required: a list of option values or labels.');
        }
        return text(await session.select(this.#requireTarget(args), values as string[]));
      }
      case 'browser_hover':
        return text(await session.hover(this.#requireTarget(args)));
      case 'browser_drag': {
        const startTarget = str(args, 'startTarget');
        const endTarget = str(args, 'endTarget');
        if (!startTarget || !endTarget) throw new Error('startTarget and endTarget are required.');
        return text(await session.drag(startTarget, endTarget));
      }
      case 'browser_press_key': {
        const key = str(args, 'key');
        if (!key) throw new Error('key is required.');
        return text(await session.press(key));
      }
      case 'browser_scroll': {
        const direction = str(args, 'direction') as 'up' | 'down' | 'left' | 'right' | undefined;
        if (!direction || !['up', 'down', 'left', 'right'].includes(direction)) {
          throw new Error('direction is required: up, down, left or right.');
        }
        return text(await session.scroll(direction, num(args, 'amount') ?? 3, str(args, 'target')));
      }
      case 'browser_wait_for':
        return text(
          await session.waitFor({
            time: num(args, 'time'),
            text: str(args, 'text'),
            textGone: str(args, 'textGone'),
          }),
        );
      case 'browser_take_screenshot':
        return session.screenshot({
          target: str(args, 'target'),
          fullPage: bool(args, 'fullPage'),
        });
      case 'browser_tabs': {
        const action = str(args, 'action') as 'list' | 'new' | 'close' | 'select' | undefined;
        if (!action || !['list', 'new', 'close', 'select'].includes(action)) {
          throw new Error('action is required: list, new, close or select.');
        }
        const newUrl = str(args, 'url');
        if (action === 'new' && newUrl) {
          const checked = await this.#checkPreview(slug, newUrl);
          if (checked.state) {
            this.#onNavigationState(slug, checked.state);
            throw new PreviewNavigationError(checked.state);
          }
        }
        return text(
          await session.tabs(action, {
            url: str(args, 'url'),
            index: num(args, 'index'),
            agentId: resolved.agentId,
          }),
        );
      }
      case 'browser_handle_dialog': {
        const accept = bool(args, 'accept');
        if (accept === undefined) throw new Error('accept is required: true or false.');
        return text(await session.dialogAction(accept, str(args, 'promptText')));
      }
      case 'browser_file_upload': {
        const uploads = request.uploads ?? [];
        if (uploads.length > MAX_UPLOAD_FILES) {
          throw new Error(`At most ${MAX_UPLOAD_FILES} files at once.`);
        }
        const files = uploads.map((upload) => {
          if (!upload || typeof upload.data !== 'string' || typeof upload.name !== 'string') {
            throw new Error('A file did not arrive whole.');
          }
          return {
            name: upload.name.split(/[\\/]/).pop()!.slice(0, 180) || 'upload',
            mimeType: upload.mimeType || 'application/octet-stream',
            buffer: Buffer.from(upload.data, 'base64'),
          };
        });
        if (files.reduce((sum, file) => sum + file.buffer.length, 0) > MAX_UPLOAD_BYTES) {
          throw new Error('The files are larger than 50 MB together.');
        }
        return text(await session.upload(files, str(args, 'target')));
      }
      case 'browser_downloads':
        return text(await session.downloads());
      case 'browser_console_messages': {
        const level = str(args, 'level') ?? 'info';
        if (!['error', 'warning', 'info', 'debug'].includes(level)) {
          throw new Error('level must be error, warning, info or debug.');
        }
        return text(await session.console(level as ConsoleLevel));
      }
      case 'browser_network_requests':
        return text(
          await session.network({
            includeStatic: bool(args, 'static') ?? false,
            filter: str(args, 'filter')?.slice(0, 200),
          }),
        );
      case 'browser_login':
        return text(await this.#login(request, session, slug));
      case 'browser_login_code':
        return text(await this.#loginCode(request, session, slug));
      default:
        throw new Error(`Tool not implemented: ${request.tool}`);
    }
  }

  #requireTarget(args: Record<string, unknown> | undefined): string {
    const target = str(args, 'target');
    if (!target) throw new Error('target is required: a ref from browser_snapshot.');
    return target;
  }

  async #login(request: GatewayRequest, session: GatewaySession, slug: string): Promise<string> {
    const args = request.args;
    const usernameTarget = str(args, 'usernameTarget');
    const passwordTarget = str(args, 'passwordTarget');
    if (!usernameTarget || !passwordTarget) {
      throw new Error('usernameTarget and passwordTarget are required.');
    }
    // Design §6: the login is chosen for the origin of the frame the password field is in
    // (a login form in an iframe of another site gets that site's login, not the tab's).
    const frameOrigin = await session.frameOrigin(passwordTarget);
    const result = await this.#helena.login(
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
      usernameTarget,
      passwordTarget,
      result.login.username,
      result.login.password,
      frameOrigin,
    );
    return `Filled ${result.login.label} (${result.login.username}) on ${frameOrigin}.${result.login.has2fa ? ` This login has 2FA — when the code field shows, use browser_login_code with credentialId ${result.login.id}.` : ''}`;
  }

  async #loginCode(
    request: GatewayRequest,
    session: GatewaySession,
    slug: string,
  ): Promise<string> {
    const args = request.args;
    const target = this.#requireTarget(args);
    const credentialId = num(args, 'credentialId');
    if (credentialId === undefined) throw new Error('credentialId is required.');
    const result = await this.#helena.loginCode(
      request.agentKey,
      credentialId,
      await session.frameOrigin(target),
      { runId: request.runId, messageId: request.messageId },
      { projectSlug: slug, via: this.#ownSlug },
    );
    session.guard.track(result.code);
    await session.fillCode(target, result.code);
    return `Filled the current code (valid ${result.secondsRemaining}s more).`;
  }
}
