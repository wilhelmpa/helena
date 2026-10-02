import { mock } from 'bun:test';
import { SecretGuard } from '../../redact';
import type { GatewaySession, SessionProvider } from '../../session-types';
import type { HelenaClient, ResolveResult } from '../../helena-client';

const DEFAULT_SETTINGS = {
  domainBlocklist: [] as string[],
  domainAllowlist: [] as string[],
  humanInput: true,
  lockTimeoutSec: 120,
};

export function resolved(overrides: Partial<ResolveResult> = {}): ResolveResult {
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

export function fakeHelenaClient(
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
    decide: mock(async () => ({ effect: 'allow' as const })),
    policy: mock(async () => ({})),
    previews: mock(async () => []),
    ...overrides,
  } as unknown as HelenaClient;
}

export function fakeSession(
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
    find: mock(async () => 'Found'),
    click: mock(async (target: string) => `Clicked ${target}`),
    type: mock(async (target: string) => `Typed into ${target}`),
    fillForm: mock(async () => 'Filled'),
    waitFor: mock(async () => 'Waited'),
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
    submitsForm: mock(async () => ({ submits: false, formAction: null })),
    pageOrigin: () => 'https://example.com',
    fillLogin: mock(async () => 'Login filled.'),
    fillCode: mock(async () => 'Code filled.'),
    ...overrides,
  } as unknown as GatewaySession;
}

export function fakeSessions(session: GatewaySession = fakeSession()): SessionProvider {
  return { get: mock(async (_slug: string) => session) };
}
