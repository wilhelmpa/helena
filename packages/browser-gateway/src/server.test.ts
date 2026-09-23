import { describe, expect, it, mock } from 'bun:test';
import { GatewayDispatcher } from './server';
import { ProjectBrowserLocks } from './lock';
import { SecretGuard } from './redact';
import type { GatewaySession, SessionProvider } from './session-types';
import type { PlanClient } from './plan-client';
import { PlanApiError } from './plan-client';

const DEFAULT_SETTINGS = {
  domainBlocklist: [],
  domainAllowlist: [],
  humanInput: true,
  lockTimeoutSec: 120,
};

function fakePlanClient(overrides: Partial<PlanClient> = {}): PlanClient {
  return {
    resolve: mock(async (_agentKey: string, _slug: string) => ({
      agentId: 1,
      agentName: 'Writer',
      teamId: 1,
      projectId: 1,
      browserGatewayEnabled: true,
      settings: DEFAULT_SETTINGS,
    })),
    login: mock(async () => ({ status: 'none' as const })),
    loginCode: mock(async () => ({ code: '000000', secondsRemaining: 30 })),
    audit: mock(async () => {}),
    policy: mock(async () => ({})),
    ...overrides,
  } as unknown as PlanClient;
}

function fakeSession(overrides: Partial<GatewaySession> = {}): GatewaySession {
  return {
    guard: new SecretGuard(),
    applyDomainPolicy: mock(async () => {}),
    status: mock(async () => ({ url: 'https://example.com/', tabCount: 1, dialogOpen: false })),
    navigate: mock(async (url: string) => `Navigated to ${url}`),
    back: mock(async () => 'Back'),
    reload: mock(async () => 'Reloaded'),
    snapshot: mock(async () => '[e1] button "Login"'),
    click: mock(async (ref: string) => `Clicked ${ref}`),
    type: mock(async (ref: string) => `Typed into ${ref}`),
    select: mock(async () => 'Selected'),
    hover: mock(async () => 'Hovered'),
    drag: mock(async () => 'Dragged'),
    press: mock(async () => 'Pressed'),
    scroll: mock(async () => 'Scrolled'),
    screenshot: mock(async () => 'data:image/png;base64,AAAA'),
    tabs: mock(async () => 'Tabs: [1]'),
    dialogAction: mock(async () => 'Dialog handled'),
    upload: mock(async () => 'Uploaded'),
    downloads: mock(async () => 'Downloads: []'),
    console: mock(async () => 'Console: []'),
    network: mock(async () => 'Network: []'),
    fillLogin: mock(async () => undefined),
    fillCode: mock(async () => undefined),
    ...overrides,
  } as unknown as GatewaySession;
}

function fakeSessions(session: GatewaySession = fakeSession()): SessionProvider {
  return { get: mock(async (_slug: string) => session) };
}

function dispatcher(
  options: {
    ownSlug?: string;
    planClient?: PlanClient;
    sessions?: SessionProvider;
    locks?: ProjectBrowserLocks;
    notify?: (slug: string, holder: unknown) => void;
  } = {},
) {
  return new GatewayDispatcher({
    ownSlug: options.ownSlug ?? 'mkt',
    planClient: options.planClient ?? fakePlanClient(),
    locks: options.locks ?? new ProjectBrowserLocks(120_000),
    sessions: options.sessions ?? fakeSessions(),
    notify: options.notify,
  });
}

describe('GatewayDispatcher: tool validation', () => {
  it('refuses an unknown tool before touching Plan or the session', async () => {
    const planClient = fakePlanClient();
    const gateway = dispatcher({ planClient });
    const result = await gateway.handle({ tool: 'browser_evaluate', agentKey: 'k' });
    expect(result).toEqual({ ok: false, error: 'Unknown tool: browser_evaluate' });
    expect(planClient.resolve).not.toHaveBeenCalled();
  });
});

describe('GatewayDispatcher: project scoping', () => {
  it('acts on its own slug when no project is named', async () => {
    const planClient = fakePlanClient();
    const gateway = dispatcher({ ownSlug: 'mkt', planClient });
    await gateway.handle({ tool: 'browser_status', agentKey: 'k' });
    expect((planClient.resolve as ReturnType<typeof mock>).mock.calls[0]).toEqual(['k', 'mkt']);
  });

  it('refuses a project override from a non-Home socket', async () => {
    const planClient = fakePlanClient();
    const gateway = dispatcher({ ownSlug: 'mkt', planClient });
    const result = await gateway.handle({
      tool: 'browser_status',
      agentKey: 'k',
      args: { project: 'OPS' },
    });
    expect(result.ok).toBe(false);
    expect(planClient.resolve).not.toHaveBeenCalled();
  });

  it('lets the Home socket act on a named project, slugified', async () => {
    const planClient = fakePlanClient();
    const gateway = dispatcher({ ownSlug: 'home', planClient });
    await gateway.handle({ tool: 'browser_status', agentKey: 'k', args: { project: 'VERV' } });
    expect((planClient.resolve as ReturnType<typeof mock>).mock.calls[0]).toEqual(['k', 'verve']);
  });

  it('refuses when the agent does not have Projekt-Browser enabled', async () => {
    const planClient = fakePlanClient({
      resolve: mock(async () => ({
        agentId: 1,
        agentName: 'Writer',
        teamId: 1,
        projectId: 1,
        browserGatewayEnabled: false,
        settings: DEFAULT_SETTINGS,
      })),
    });
    const gateway = dispatcher({ planClient });
    const result = await gateway.handle({
      tool: 'browser_navigate',
      agentKey: 'k',
      args: { url: 'https://x.test' },
    });
    expect(result.ok).toBe(false);
  });

  it('surfaces a Plan API error message instead of throwing', async () => {
    const planClient = fakePlanClient({
      resolve: mock(async () => {
        throw new PlanApiError(403, 'Agent does not work in this project');
      }),
    });
    const gateway = dispatcher({ planClient });
    const result = await gateway.handle({ tool: 'browser_status', agentKey: 'k' });
    expect(result).toEqual({ ok: false, error: 'Agent does not work in this project' });
  });
});

describe('GatewayDispatcher: control lock', () => {
  it('refuses a page-touching tool before the lock is acquired', async () => {
    const gateway = dispatcher();
    const result = await gateway.handle({
      tool: 'browser_navigate',
      agentKey: 'k',
      args: { url: 'https://x.test' },
    });
    expect(result).toEqual({
      ok: false,
      error: 'Control is not held. Call browser_acquire first.',
    });
  });

  it('acquires, then allows a page-touching tool, then release refuses further ones', async () => {
    const gateway = dispatcher();
    expect((await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' })).ok).toBe(true);
    const clicked = await gateway.handle({
      tool: 'browser_click',
      agentKey: 'k',
      args: { ref: 'e1' },
    });
    expect(clicked).toEqual({ ok: true, content: 'Clicked e1' });
    expect((await gateway.handle({ tool: 'browser_release', agentKey: 'k' })).ok).toBe(true);
    const after = await gateway.handle({
      tool: 'browser_click',
      agentKey: 'k',
      args: { ref: 'e1' },
    });
    expect(after.ok).toBe(false);
  });

  it('browser_status and browser_acquire never require the lock themselves', async () => {
    const gateway = dispatcher();
    expect((await gateway.handle({ tool: 'browser_status', agentKey: 'k' })).ok).toBe(true);
  });

  it('a second agent is refused immediately when acquire is called with timeoutSec 0', async () => {
    const locks = new ProjectBrowserLocks(120_000);
    let resolveCall = 0;
    const planClient = fakePlanClient({
      resolve: mock(async () => {
        resolveCall++;
        return {
          agentId: resolveCall,
          agentName: resolveCall === 1 ? 'Writer' : 'Coder',
          teamId: 1,
          projectId: 1,
          browserGatewayEnabled: true,
          settings: DEFAULT_SETTINGS,
        };
      }),
    });
    const gateway = dispatcher({ locks, planClient });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'writer-key' });
    const second = await gateway.handle({
      tool: 'browser_acquire',
      agentKey: 'coder-key',
      args: { timeoutSec: 0 },
    });
    expect(second).toEqual({ ok: false, error: 'Still controlled by Writer.' });
  });

  it('notifies the control-change callback on acquire and release', async () => {
    const notify = mock((_slug: string, _holder: unknown) => {});
    const gateway = dispatcher({ notify });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    await gateway.handle({ tool: 'browser_release', agentKey: 'k' });
    expect(notify.mock.calls.length).toBe(2);
    expect(notify.mock.calls[0][1]).toEqual({ kind: 'agent', agentId: 1, agentName: 'Writer' });
    expect(notify.mock.calls[1][1]).toBeNull();
  });
});

describe('GatewayDispatcher: login / 2FA', () => {
  it('fills a login and never returns the password in the tool result', async () => {
    const session = fakeSession();
    const planClient = fakePlanClient({
      login: mock(async () => ({
        status: 'filled' as const,
        login: {
          id: 5,
          label: 'GitHub',
          username: 'bot@example.com',
          password: 'fake-password-4711',
          has2fa: false,
        },
      })),
    });
    const gateway = dispatcher({ planClient, sessions: fakeSessions(session) });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    const result = await gateway.handle({
      tool: 'browser_login',
      agentKey: 'k',
      args: { usernameRef: 'e1', passwordRef: 'e2' },
    });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain('fake-password-4711');
    expect(session.fillLogin).toHaveBeenCalledWith(
      'e1',
      'e2',
      'bot@example.com',
      'fake-password-4711',
    );
  });

  it('tracks the password in the session guard so a later tool call redacts it too', async () => {
    const session = fakeSession({
      snapshot: mock(async () => 'value="fake-password-4711"'),
    });
    const planClient = fakePlanClient({
      login: mock(async () => ({
        status: 'filled' as const,
        login: {
          id: 5,
          label: 'GitHub',
          username: 'bot@example.com',
          password: 'fake-password-4711',
          has2fa: false,
        },
      })),
    });
    const gateway = dispatcher({ planClient, sessions: fakeSessions(session) });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    await gateway.handle({
      tool: 'browser_login',
      agentKey: 'k',
      args: { usernameRef: 'e1', passwordRef: 'e2' },
    });
    const later = await gateway.handle({ tool: 'browser_snapshot', agentKey: 'k' });
    expect(later).toEqual({ ok: true, content: 'value="[REDACTED]"' });
  });

  it('offers a choice without leaking any password when several logins match', async () => {
    const planClient = fakePlanClient({
      login: mock(async () => ({
        status: 'choose' as const,
        candidates: [
          { id: 1, label: 'Primary', username: 'a@example.com' },
          { id: 2, label: 'Backup', username: 'b@example.com' },
        ],
      })),
    });
    const gateway = dispatcher({ planClient });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    const result = await gateway.handle({
      tool: 'browser_login',
      agentKey: 'k',
      args: { usernameRef: 'e1', passwordRef: 'e2' },
    });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result).toLowerCase()).not.toContain('password');
  });

  it('fills the current 2FA code and redacts it from a later response too', async () => {
    const session = fakeSession({ snapshot: mock(async () => 'value="123456"') });
    const planClient = fakePlanClient({
      loginCode: mock(async () => ({ code: '123456', secondsRemaining: 20 })),
    });
    const gateway = dispatcher({ planClient, sessions: fakeSessions(session) });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    const filled = await gateway.handle({
      tool: 'browser_login_code',
      agentKey: 'k',
      args: { ref: 'e3', credentialId: 5 },
    });
    expect(filled.ok).toBe(true);
    expect(JSON.stringify(filled)).not.toContain('123456');
    const later = await gateway.handle({ tool: 'browser_snapshot', agentKey: 'k' });
    expect(later).toEqual({ ok: true, content: 'value="[REDACTED]"' });
  });

  it('does not send a Plan audit call for credential tools (Plan already audited the delivery itself)', async () => {
    const planClient = fakePlanClient({
      login: mock(async () => ({
        status: 'filled' as const,
        login: { id: 5, label: 'GitHub', username: 'u', password: 'p', has2fa: false },
      })),
    });
    const gateway = dispatcher({ planClient });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    await gateway.handle({
      tool: 'browser_login',
      agentKey: 'k',
      args: { usernameRef: 'e1', passwordRef: 'e2' },
    });
    expect(planClient.audit).not.toHaveBeenCalled();
  });
});

describe('GatewayDispatcher: redaction on error paths', () => {
  it('redacts a tracked secret even out of a thrown error message', async () => {
    const session = fakeSession({
      click: mock(async () => {
        throw new Error('failed near value fake-password-4711');
      }),
    });
    session.guard.track('fake-password-4711');
    const gateway = dispatcher({ sessions: fakeSessions(session) });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    const result = await gateway.handle({
      tool: 'browser_click',
      agentKey: 'k',
      args: { ref: 'e1' },
    });
    expect(result).toEqual({ ok: false, error: 'failed near value [REDACTED]' });
  });
});

describe('GatewayDispatcher: audit for non-credential tools', () => {
  it('sends an audit call naming the tool and a short target label, not tool output', async () => {
    const planClient = fakePlanClient();
    const gateway = dispatcher({ planClient, ownSlug: 'mkt' });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    await gateway.handle({
      tool: 'browser_navigate',
      agentKey: 'k',
      args: { url: 'https://example.com/page' },
    });
    await new Promise((r) => setTimeout(r, 0)); // audit is fire-and-forget
    expect(planClient.audit).toHaveBeenCalledWith({
      agentKey: 'k',
      projectSlug: 'mkt',
      actor: 'agent',
      tool: 'browser_navigate',
      target: 'https://example.com/page',
    });
  });
});

describe('GatewayDispatcher: domain policy (design §8)', () => {
  it('refuses browser_navigate to a blocked domain before it ever reaches the session', async () => {
    const session = fakeSession();
    const planClient = fakePlanClient({
      resolve: mock(async () => ({
        agentId: 1,
        agentName: 'Writer',
        teamId: 1,
        projectId: 1,
        browserGatewayEnabled: true,
        settings: { ...DEFAULT_SETTINGS, domainBlocklist: ['bank.example'] },
      })),
    });
    const gateway = dispatcher({ planClient, sessions: fakeSessions(session) });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    const result = await gateway.handle({
      tool: 'browser_navigate',
      agentKey: 'k',
      args: { url: 'https://bank.example/login' },
    });
    expect(result.ok).toBe(false);
    expect(session.navigate).not.toHaveBeenCalled();
  });

  it('allows browser_navigate to a domain the blocklist does not name', async () => {
    const session = fakeSession();
    const planClient = fakePlanClient({
      resolve: mock(async () => ({
        agentId: 1,
        agentName: 'Writer',
        teamId: 1,
        projectId: 1,
        browserGatewayEnabled: true,
        settings: { ...DEFAULT_SETTINGS, domainBlocklist: ['bank.example'] },
      })),
    });
    const gateway = dispatcher({ planClient, sessions: fakeSessions(session) });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    const result = await gateway.handle({
      tool: 'browser_navigate',
      agentKey: 'k',
      args: { url: 'https://example.com/' },
    });
    expect(result.ok).toBe(true);
    expect(session.navigate).toHaveBeenCalledWith('https://example.com/');
  });

  it('applies the current domain policy to the session before every page-touching tool, not only navigate', async () => {
    const session = fakeSession();
    const gateway = dispatcher({ sessions: fakeSessions(session) });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    await gateway.handle({ tool: 'browser_click', agentKey: 'k', args: { ref: 'e1' } });
    expect(session.applyDomainPolicy).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });
});
