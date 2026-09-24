import { describe, expect, it, mock } from 'bun:test';
import { GatewayDispatcher, SlugQueue, type HandoverNotice } from './server';
import { ProjectBrowserLocks } from './lock';
import { SecretGuard } from './redact';
import type { GatewaySession, SessionProvider } from './session-types';
import type { HelenaClient, ResolveResult } from './helena-client';
import { HelenaApiError } from './helena-client';

const DEFAULT_SETTINGS = {
  domainBlocklist: [] as string[],
  domainAllowlist: [] as string[],
  humanInput: true,
  lockTimeoutSec: 120,
};

function resolved(overrides: Partial<ResolveResult> = {}): ResolveResult {
  return {
    agentId: 1,
    agentName: 'Writer',
    teamId: 1,
    projectId: 1,
    projectKey: 'MKT',
    browserGatewayEnabled: true,
    settings: DEFAULT_SETTINGS,
    ...overrides,
  };
}

function fakeHelenaClient(
  overrides: Partial<Record<keyof HelenaClient, unknown>> = {},
): HelenaClient {
  return {
    resolve: mock(async () => resolved()),
    login: mock(async () => ({ status: 'none' as const })),
    loginCode: mock(async () => ({ code: '000000', secondsRemaining: 30 })),
    audit: mock(async () => {}),
    handover: mock(async () => ({ approvalId: 77 })),
    handoverDone: mock(async () => {}),
    download: mock(async () => ({ path: 'Projects/MKT/Inbox/x' })),
    policy: mock(async () => ({})),
    ...overrides,
  } as unknown as HelenaClient;
}

function fakeSession(
  overrides: Partial<Record<keyof GatewaySession, unknown>> = {},
): GatewaySession {
  return {
    guard: new SecretGuard(),
    isConnected: () => true,
    setHumanInput: mock(() => {}),
    applyDomainPolicy: mock(async () => {}),
    status: mock(async () => ({
      url: 'https://example.com/',
      title: 'Example',
      tabCount: 1,
      dialogOpen: false,
    })),
    navigate: mock(async (url: string) => `Navigated to ${url}`),
    back: mock(async () => 'Back'),
    reload: mock(async () => 'Reloaded'),
    snapshot: mock(async () => '- button "Login" [ref=e1]'),
    click: mock(async (ref: string) => `Clicked ${ref}`),
    type: mock(async (ref: string) => `Typed into ${ref}`),
    select: mock(async () => 'Selected'),
    hover: mock(async () => 'Hovered'),
    drag: mock(async () => 'Dragged'),
    press: mock(async () => 'Pressed'),
    scroll: mock(async () => 'Scrolled'),
    screenshot: mock(async () => ({
      text: 'Screenshot of the viewport',
      image: { data: 'AAAA', mimeType: 'image/png' },
    })),
    tabs: mock(async () => '[t1] https://example.com/ (active)'),
    closeTabsOf: mock(async () => {}),
    dialogAction: mock(async () => 'Dialog handled'),
    upload: mock(async () => 'Uploaded'),
    downloads: mock(async () => '(no downloads)'),
    console: mock(async () => '(no console messages)'),
    network: mock(async () => '(no network requests)'),
    frameOrigin: mock(async () => 'https://login.example.com'),
    fillLogin: mock(async () => 'Login filled.'),
    fillCode: mock(async () => 'Code filled.'),
    ...overrides,
  } as unknown as GatewaySession;
}

function fakeSessions(session: GatewaySession = fakeSession()): SessionProvider {
  return { get: mock(async (_slug: string) => session) };
}

function dispatcher(
  options: {
    ownSlug?: string;
    helena?: HelenaClient;
    sessions?: SessionProvider;
    locks?: ProjectBrowserLocks;
    onHandover?: (slug: string, notice: HandoverNotice | null) => void;
    queue?: SlugQueue;
  } = {},
) {
  return new GatewayDispatcher({
    ownSlug: options.ownSlug ?? 'mkt',
    helena: options.helena ?? fakeHelenaClient(),
    locks: options.locks ?? new ProjectBrowserLocks(120_000),
    sessions: options.sessions ?? fakeSessions(),
    onHandover: options.onHandover,
    queue: options.queue,
  });
}

const calls = (fn: unknown) => (fn as ReturnType<typeof mock>).mock.calls;

describe('GatewayDispatcher: tool validation', () => {
  it('refuses an unknown tool before touching Helena or the session', async () => {
    const helena = fakeHelenaClient();
    const gateway = dispatcher({ helena });
    const result = await gateway.handle({ tool: 'browser_evaluate', agentKey: 'k' });
    expect(result).toEqual({ ok: false, error: 'Unknown tool: browser_evaluate' });
    expect(helena.resolve).not.toHaveBeenCalled();
  });
});

describe('GatewayDispatcher: project scoping', () => {
  it('acts on its own slug and tells Helena the socket it came through', async () => {
    const helena = fakeHelenaClient();
    const gateway = dispatcher({ ownSlug: 'mkt', helena });
    await gateway.handle({ tool: 'browser_status', agentKey: 'k' });
    expect(calls(helena.resolve)[0]).toEqual(['k', 'mkt', 'mkt']);
  });

  it('refuses a project override from a project socket', async () => {
    const helena = fakeHelenaClient();
    const gateway = dispatcher({ ownSlug: 'mkt', helena });
    const result = await gateway.handle({
      tool: 'browser_status',
      agentKey: 'k',
      args: { project: 'OPS' },
    });
    expect(result.ok).toBe(false);
    expect(helena.resolve).not.toHaveBeenCalled();
  });

  it('lets the Home socket act on a named project (slugified) and on Home itself', async () => {
    const helena = fakeHelenaClient();
    const gateway = dispatcher({ ownSlug: 'home', helena });
    await gateway.handle({ tool: 'browser_status', agentKey: 'k', args: { project: 'VERV' } });
    await gateway.handle({ tool: 'browser_status', agentKey: 'k', args: { project: 'home' } });
    await gateway.handle({ tool: 'browser_status', agentKey: 'k' });
    expect(calls(helena.resolve)).toEqual([
      ['k', 'verve', 'home'],
      ['k', 'home', 'home'],
      ['k', 'home', 'home'],
    ]);
  });

  it('refuses a project name that could be anything but a key', async () => {
    const helena = fakeHelenaClient();
    const gateway = dispatcher({ ownSlug: 'home', helena });
    const result = await gateway.handle({
      tool: 'browser_status',
      agentKey: 'k',
      args: { project: '../mkt' },
    });
    expect(result.ok).toBe(false);
    expect(helena.resolve).not.toHaveBeenCalled();
  });

  it('refuses when the agent does not have Projekt-Browser enabled', async () => {
    const helena = fakeHelenaClient({
      resolve: mock(async () => resolved({ browserGatewayEnabled: false })),
    });
    const gateway = dispatcher({ helena });
    const result = await gateway.handle({
      tool: 'browser_navigate',
      agentKey: 'k',
      args: { url: 'https://x.test' },
    });
    expect(result.ok).toBe(false);
  });

  it("surfaces Helena's refusal instead of throwing", async () => {
    const helena = fakeHelenaClient({
      resolve: mock(async () => {
        throw new HelenaApiError(403, 'Agent does not work in this project');
      }),
    });
    const gateway = dispatcher({ helena });
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

  it('acquires, acts, releases (closing its tabs), then is refused again', async () => {
    const session = fakeSession();
    const gateway = dispatcher({ sessions: fakeSessions(session) });
    expect((await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' })).ok).toBe(true);
    const clicked = await gateway.handle({
      tool: 'browser_click',
      agentKey: 'k',
      args: { ref: 'e1' },
    });
    expect(clicked).toEqual({ ok: true, content: 'Clicked e1' });
    expect((await gateway.handle({ tool: 'browser_release', agentKey: 'k' })).ok).toBe(true);
    expect(calls(session.closeTabsOf)).toEqual([[1]]);
    const after = await gateway.handle({
      tool: 'browser_click',
      agentKey: 'k',
      args: { ref: 'e1' },
    });
    expect(after.ok).toBe(false);
  });

  it('names who holds the lock when a tool is refused', async () => {
    const locks = new ProjectBrowserLocks(120_000);
    locks.of('mkt').takeover();
    const gateway = dispatcher({ locks });
    const result = await gateway.handle({ tool: 'browser_snapshot', agentKey: 'k' });
    expect(result).toEqual({
      ok: false,
      error: 'Control is not held. Call browser_acquire first. The owner controls it.',
    });
  });

  it('browser_status needs no lock and says who holds it', async () => {
    const gateway = dispatcher();
    const free = await gateway.handle({ tool: 'browser_status', agentKey: 'k' });
    expect(free.ok && free.content).toContain('Controlled by: nobody (free).');
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    const mine = await gateway.handle({ tool: 'browser_status', agentKey: 'k' });
    expect(mine.ok && mine.content).toContain('Controlled by: you.');
  });

  it('a second agent is refused at once with timeoutSec 0, naming the holder', async () => {
    const locks = new ProjectBrowserLocks(120_000);
    let resolveCall = 0;
    const helena = fakeHelenaClient({
      resolve: mock(async () => {
        resolveCall++;
        return resolved({
          agentId: resolveCall,
          agentName: resolveCall === 1 ? 'Writer' : 'Coder',
        });
      }),
    });
    const gateway = dispatcher({ locks, helena });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'writer-key' });
    const second = await gateway.handle({
      tool: 'browser_acquire',
      agentKey: 'coder-key',
      args: { timeoutSec: 0 },
    });
    expect(second.ok).toBe(false);
    expect(!second.ok && second.error).toStartWith('Still controlled by Writer.');
  });

  it('every lock change reaches the lock registry listeners', async () => {
    const locks = new ProjectBrowserLocks(120_000);
    const seen: (string | null)[] = [];
    locks.onChange((slug, state) =>
      seen.push(`${slug}:${state.holder ? state.holder.kind : 'free'}`),
    );
    const gateway = dispatcher({ locks });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    await gateway.handle({ tool: 'browser_release', agentKey: 'k' });
    expect(seen).toEqual(['mkt:agent', 'mkt:free']);
  });

  it("applies the project's human-input setting to the session before each tool", async () => {
    const session = fakeSession();
    const helena = fakeHelenaClient({
      resolve: mock(async () => resolved({ settings: { ...DEFAULT_SETTINGS, humanInput: false } })),
    });
    const gateway = dispatcher({ helena, sessions: fakeSessions(session) });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    await gateway.handle({ tool: 'browser_click', agentKey: 'k', args: { ref: 'e1' } });
    expect(calls(session.setHumanInput)).toEqual([[false]]);
  });

  it('runs the tool calls on one browser one after another', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const session = fakeSession({
      click: mock(async (ref: string) => {
        order.push(`start ${ref}`);
        if (ref === 'e1') await gate;
        order.push(`end ${ref}`);
        return `Clicked ${ref}`;
      }),
    });
    const gateway = dispatcher({ sessions: fakeSessions(session) });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    const first = gateway.handle({ tool: 'browser_click', agentKey: 'k', args: { ref: 'e1' } });
    const second = gateway.handle({ tool: 'browser_click', agentKey: 'k', args: { ref: 'e2' } });
    await new Promise((r) => setTimeout(r, 20));
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['start e1', 'end e1', 'start e2', 'end e2']);
  });
});

describe('GatewayDispatcher: login / 2FA', () => {
  const filled = {
    status: 'filled' as const,
    login: {
      id: 5,
      label: 'GitHub',
      username: 'bot@example.com',
      password: 'fake-password-4711',
      has2fa: true,
    },
  };

  it("chooses the login for the password field's frame and never returns the password", async () => {
    const session = fakeSession();
    const helena = fakeHelenaClient({ login: mock(async () => filled) });
    const gateway = dispatcher({ helena, sessions: fakeSessions(session) });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    const result = await gateway.handle({
      tool: 'browser_login',
      agentKey: 'k',
      runId: 9,
      args: { usernameRef: 'e1', passwordRef: 'f1e2' },
    });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain('fake-password-4711');
    expect(calls(session.frameOrigin)).toEqual([['f1e2']]);
    expect(calls(helena.login)[0]).toEqual([
      'k',
      'mkt',
      'mkt',
      'https://login.example.com',
      undefined,
      { runId: 9, messageId: undefined },
    ]);
    expect(calls(session.fillLogin)[0]).toEqual([
      'e1',
      'f1e2',
      'bot@example.com',
      'fake-password-4711',
      'https://login.example.com',
    ]);
    expect(result.ok && result.content).toContain('credentialId 5');
  });

  it('redacts the password from every later answer, whatever returns it', async () => {
    const session = fakeSession({
      snapshot: mock(async () => '- textbox "Password": fake-password-4711'),
    });
    const helena = fakeHelenaClient({ login: mock(async () => filled) });
    const gateway = dispatcher({ helena, sessions: fakeSessions(session) });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    await gateway.handle({
      tool: 'browser_login',
      agentKey: 'k',
      args: { usernameRef: 'e1', passwordRef: 'e2' },
    });
    const later = await gateway.handle({ tool: 'browser_snapshot', agentKey: 'k' });
    expect(later).toEqual({ ok: true, content: '- textbox "Password": [REDACTED]' });
  });

  it('offers a choice without any password when several logins match', async () => {
    const helena = fakeHelenaClient({
      login: mock(async () => ({
        status: 'choose' as const,
        candidates: [
          { id: 1, label: 'Primary', username: 'a@example.com' },
          { id: 2, label: 'Backup', username: 'b@example.com' },
        ],
      })),
    });
    const gateway = dispatcher({ helena });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    const result = await gateway.handle({
      tool: 'browser_login',
      agentKey: 'k',
      args: { usernameRef: 'e1', passwordRef: 'e2' },
    });
    expect(result.ok && result.content).toContain('#1 Primary (a@example.com)');
  });

  it("fills the 2FA code for the code field's frame and redacts it later", async () => {
    const session = fakeSession({ snapshot: mock(async () => 'value="123456"') });
    const helena = fakeHelenaClient({
      loginCode: mock(async () => ({ code: '123456', secondsRemaining: 20 })),
    });
    const gateway = dispatcher({ helena, sessions: fakeSessions(session) });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    const done = await gateway.handle({
      tool: 'browser_login_code',
      agentKey: 'k',
      args: { ref: 'e3', credentialId: 5 },
    });
    expect(done.ok).toBe(true);
    expect(JSON.stringify(done)).not.toContain('123456');
    expect(calls(helena.loginCode)[0]!.slice(0, 3)).toEqual(['k', 5, 'https://login.example.com']);
    const later = await gateway.handle({ tool: 'browser_snapshot', agentKey: 'k' });
    expect(later).toEqual({ ok: true, content: 'value="[REDACTED]"' });
  });

  it('leaves the audit of logins to Helena (it records the delivery itself)', async () => {
    const helena = fakeHelenaClient({ login: mock(async () => filled) });
    const gateway = dispatcher({ helena });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    await gateway.handle({
      tool: 'browser_login',
      agentKey: 'k',
      args: { usernameRef: 'e1', passwordRef: 'e2' },
    });
    expect(helena.audit).not.toHaveBeenCalled();
  });
});

describe('GatewayDispatcher: files and pictures', () => {
  it('passes the uploaded bytes to the session, never a path', async () => {
    const session = fakeSession();
    const gateway = dispatcher({ sessions: fakeSessions(session) });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    const result = await gateway.handle({
      tool: 'browser_upload',
      agentKey: 'k',
      args: { ref: 'e4' },
      upload: { name: '../../etc/report.pdf', mimeType: 'application/pdf', data: 'aGVsbG8=' },
    });
    expect(result.ok).toBe(true);
    const [ref, file] = calls(session.upload)[0] as [string, { name: string; buffer: Buffer }];
    expect(ref).toBe('e4');
    expect(file.name).toBe('report.pdf');
    expect(file.buffer.toString()).toBe('hello');
  });

  it('refuses an upload without a file', async () => {
    const gateway = dispatcher();
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    const result = await gateway.handle({
      tool: 'browser_upload',
      agentKey: 'k',
      args: { ref: 'e4', path: '/etc/passwd' },
    });
    expect(result.ok).toBe(false);
  });

  it('hands a screenshot back as an image next to its text', async () => {
    const gateway = dispatcher();
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    const result = await gateway.handle({ tool: 'browser_screenshot', agentKey: 'k' });
    expect(result).toEqual({
      ok: true,
      content: 'Screenshot of the viewport',
      image: { data: 'AAAA', mimeType: 'image/png' },
    });
  });
});

describe('GatewayDispatcher: handover', () => {
  it('shows the card, waits for the owner to take over and give back, then closes it', async () => {
    const locks = new ProjectBrowserLocks(120_000);
    const helena = fakeHelenaClient();
    const notices: (HandoverNotice | null)[] = [];
    const gateway = dispatcher({
      locks,
      helena,
      onHandover: (_slug, notice) => notices.push(notice),
    });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    const waiting = gateway.handle({
      tool: 'browser_handover',
      agentKey: 'k',
      runId: 3,
      args: { reason: 'Please solve the CAPTCHA' },
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(notices[0]).toMatchObject({ reason: 'Please solve the CAPTCHA', agentName: 'Writer' });
    locks.of('mkt').takeover();
    locks.of('mkt').release({ kind: 'owner' });
    const result = await waiting;
    expect(result.ok && result.content).toContain('The owner took over and gave control back');
    expect(notices.at(-1)).toBeNull();
    expect(calls(helena.handover)[0]![0]).toMatchObject({
      projectSlug: 'mkt',
      via: 'mkt',
      reason: 'Please solve the CAPTCHA',
      runId: 3,
    });
    expect(calls(helena.handoverDone)[0]).toEqual([{ approvalId: 77, finished: true }]);
  });

  it('gives up after its time, leaving the card open in Helena', async () => {
    const helena = fakeHelenaClient();
    const notices: (HandoverNotice | null)[] = [];
    const gateway = dispatcher({ helena, onHandover: (_slug, notice) => notices.push(notice) });
    const original = globalThis.setTimeout;
    // Time runs out at once for this test.
    globalThis.setTimeout = ((fn: () => void) => original(fn, 0)) as typeof setTimeout;
    let result;
    try {
      result = await gateway.handle({
        tool: 'browser_handover',
        agentKey: 'k',
        args: { reason: 'Unknown question', timeoutSec: 30 },
      });
    } finally {
      globalThis.setTimeout = original;
    }
    expect(result.ok && result.content).toContain('did not take over within 30 s');
    expect(notices.at(-1)).toBeNull();
    expect(calls(helena.handoverDone)[0]).toEqual([{ approvalId: 77, finished: false }]);
  });

  it('needs a reason', async () => {
    const gateway = dispatcher();
    const result = await gateway.handle({ tool: 'browser_handover', agentKey: 'k', args: {} });
    expect(result.ok).toBe(false);
  });
});

describe('GatewayDispatcher: redaction on error paths', () => {
  it('redacts a tracked secret even out of a thrown error message, first line only', async () => {
    const session = fakeSession({
      click: mock(async () => {
        throw new Error('failed near value fake-password-4711\nCall log:\n  - waiting');
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

describe('GatewayDispatcher: audit', () => {
  it('records the tool and an address without its query, never output', async () => {
    const helena = fakeHelenaClient();
    const gateway = dispatcher({ helena, ownSlug: 'mkt' });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    await gateway.handle({
      tool: 'browser_navigate',
      agentKey: 'k',
      args: { url: 'https://example.com/page?token=secret' },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(helena.audit).toHaveBeenCalledWith({
      agentKey: 'k',
      projectSlug: 'mkt',
      via: 'mkt',
      actor: 'agent',
      tool: 'browser_navigate',
      target: 'https://example.com/page',
    });
  });
});

describe('GatewayDispatcher: domain policy (design §8)', () => {
  const blocking = () =>
    fakeHelenaClient({
      resolve: mock(async () =>
        resolved({ settings: { ...DEFAULT_SETTINGS, domainBlocklist: ['bank.example'] } }),
      ),
    });

  it('refuses browser_navigate and a new tab to a blocked domain before the session', async () => {
    const session = fakeSession();
    const gateway = dispatcher({ helena: blocking(), sessions: fakeSessions(session) });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    const navigate = await gateway.handle({
      tool: 'browser_navigate',
      agentKey: 'k',
      args: { url: 'https://www.bank.example/login' },
    });
    const tab = await gateway.handle({
      tool: 'browser_tabs',
      agentKey: 'k',
      args: { action: 'open', url: 'https://bank.example/' },
    });
    expect(navigate.ok).toBe(false);
    expect(tab.ok).toBe(false);
    expect(session.navigate).not.toHaveBeenCalled();
    expect(session.tabs).not.toHaveBeenCalled();
  });

  it('refuses an address that is not http(s)', async () => {
    const gateway = dispatcher();
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'chrome://settings']) {
      const result = await gateway.handle({
        tool: 'browser_navigate',
        agentKey: 'k',
        args: { url },
      });
      expect(result.ok).toBe(false);
    }
  });

  it('allows a domain the list does not name, and applies the policy before every tool', async () => {
    const session = fakeSession();
    const gateway = dispatcher({ helena: blocking(), sessions: fakeSessions(session) });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    const result = await gateway.handle({
      tool: 'browser_navigate',
      agentKey: 'k',
      args: { url: 'https://example.com/' },
    });
    expect(result.ok).toBe(true);
    await gateway.handle({ tool: 'browser_click', agentKey: 'k', args: { ref: 'e1' } });
    expect(calls(session.applyDomainPolicy).length).toBe(2);
  });

  it('does nothing when the policy cannot be applied', async () => {
    const session = fakeSession({
      applyDomainPolicy: mock(async () => {
        throw new Error('route failed');
      }),
    });
    const gateway = dispatcher({ sessions: fakeSessions(session) });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
    const result = await gateway.handle({
      tool: 'browser_click',
      agentKey: 'k',
      args: { ref: 'e1' },
    });
    expect(result.ok).toBe(false);
    expect(session.click).not.toHaveBeenCalled();
  });
});
