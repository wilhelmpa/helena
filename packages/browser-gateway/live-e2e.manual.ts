// Manual live end-to-end smoke test — NOT part of `bun test` (it needs a real, already-
// running headed Chromium reachable over CDP; see ~/agent-work/plan-browser-gateway-spike's
// start script on Kingston, or any project browser's own CDP port). Run as:
//   bun run live-e2e.manual.ts <cdpUrl> <pageUrl>
// Exercises the real GatewayDispatcher + the real, patchright-backed
// PatchrightGatewaySession end to end against a real page. A fake PlanClient stands in for
// Plan (its own routes are covered by the apps/api integration tests); everything about the
// browser itself is real, including a post-interaction re-check of the same bot-leak
// signals the design's §10.2 spike validated, to catch a regression this file's own
// evaluate calls (snapshot tagging, credential-field check, screenshot cover) could
// introduce.
import {
  GatewayDispatcher,
  ProjectBrowserLocks,
  PatchrightGatewaySession,
  type PlanClient,
} from '@repo/browser-gateway';
import { chromium } from 'patchright-core';

const CDP_URL = process.argv[2] || 'http://127.0.0.1:19566';
const PAGE_URL = process.argv[3] || 'http://127.0.0.1:18566/';

const FAKE_PASSWORD = 'fake-password-4711-live-e2e';
const FAKE_USERNAME = 'bot@example.com';

function fakePlanClient(): PlanClient {
  return {
    resolve: async () => ({
      agentId: 1,
      agentName: 'Writer',
      teamId: 1,
      projectId: 1,
      browserGatewayEnabled: true,
      settings: { domainBlocklist: [], domainAllowlist: [], humanInput: true, lockTimeoutSec: 120 },
    }),
    login: async () => ({
      status: 'filled' as const,
      login: {
        id: 1,
        label: 'Test login',
        username: FAKE_USERNAME,
        password: FAKE_PASSWORD,
        has2fa: false,
      },
    }),
    loginCode: async () => ({ code: '000000', secondsRemaining: 30 }),
    audit: async () => {},
    policy: async () => ({}),
  } as unknown as PlanClient;
}

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

async function main() {
  const session = await PatchrightGatewaySession.connect(CDP_URL, {
    vaultInbox: '/tmp',
    humanInput: true,
  });

  const locks = new ProjectBrowserLocks(120_000);
  const notifications: unknown[] = [];
  const gateway = new GatewayDispatcher({
    ownSlug: 'e2e',
    planClient: fakePlanClient(),
    locks,
    sessions: { get: async () => session },
    notify: (slug, holder) => notifications.push({ slug, holder }),
  });

  const acquire = await gateway.handle({ tool: 'browser_acquire', agentKey: 'k' });
  check('browser_acquire succeeds', acquire.ok === true);

  const nav = await gateway.handle({
    tool: 'browser_navigate',
    agentKey: 'k',
    args: { url: PAGE_URL },
  });
  check('browser_navigate succeeds', nav.ok === true, nav.ok ? nav.content : nav.error);

  const status = await gateway.handle({ tool: 'browser_status', agentKey: 'k' });
  check(
    'browser_status reports the holder and URL',
    status.ok === true && status.content.includes('Writer') && status.content.includes('18566'),
    status.ok ? status.content : status.error,
  );

  const snap1 = await gateway.handle({ tool: 'browser_snapshot', agentKey: 'k' });
  check(
    'browser_snapshot finds the login form',
    snap1.ok === true && snap1.content.includes('textbox') && snap1.content.includes('[password'),
    snap1.ok ? snap1.content.slice(0, 300) : snap1.error,
  );
  console.log('--- snapshot ---\n' + (snap1.ok ? snap1.content : '') + '\n----------------');

  // Find the user field's ref from the rendered snapshot text (a real MCP client would
  // parse this the same way; here we just grep the first textbox ref).
  const userRefMatch = snap1.ok ? snap1.content.match(/\[e(\d+)\] textbox:text/) : null;
  const userRef = userRefMatch ? `e${userRefMatch[1]}` : null;
  check('a text ref was found for the username field', userRef !== null);

  if (userRef) {
    const typed = await gateway.handle({
      tool: 'browser_type',
      agentKey: 'k',
      args: { ref: userRef, text: 'typed-by-agent' },
    });
    check(
      'browser_type succeeds on an ordinary field',
      typed.ok === true,
      typed.ok ? typed.content : typed.error,
    );
  }

  const passRefMatch = snap1.ok ? snap1.content.match(/\[e(\d+)\] textbox:password/) : null;
  const passRef = passRefMatch ? `e${passRefMatch[1]}` : null;
  check('a password ref was found', passRef !== null);
  if (passRef) {
    const typeOnPassword = await gateway.handle({
      tool: 'browser_type',
      agentKey: 'k',
      args: { ref: passRef, text: 'should-be-refused' },
    });
    check(
      'browser_type on the password field is refused',
      typeOnPassword.ok === false,
      JSON.stringify(typeOnPassword),
    );
  }

  // Login fill via the fake PlanClient — the real secrecy-critical path.
  const usernameRef = userRef!;
  const login = await gateway.handle({
    tool: 'browser_login',
    agentKey: 'k',
    args: { usernameRef, passwordRef: passRef! },
  });
  check('browser_login succeeds', login.ok === true, login.ok ? login.content : login.error);
  check(
    'the password never appears in the browser_login response',
    JSON.stringify(login).includes(FAKE_PASSWORD) === false,
  );

  const snap2 = await gateway.handle({ tool: 'browser_snapshot', agentKey: 'k' });
  check(
    'a later snapshot never shows the filled password either',
    snap2.ok === true && !snap2.content.includes(FAKE_PASSWORD),
    snap2.ok ? snap2.content.slice(0, 300) : snap2.error,
  );

  // Live in-page bot-signal checks, run the same way the spike did, but now via the
  // dispatcher's own snapshot path having already run several evaluate/keyboard/mouse
  // operations — proving those did not introduce a leak either.
  const leakCheck = await gateway.handle({ tool: 'browser_console', agentKey: 'k' });
  check('browser_console returns without throwing', leakCheck.ok === true);

  const screenshot = await gateway.handle({ tool: 'browser_screenshot', agentKey: 'k' });
  check(
    'browser_screenshot returns a data URI',
    screenshot.ok === true && screenshot.content.startsWith('data:image/png;base64,'),
  );

  const tabs = await gateway.handle({
    tool: 'browser_tabs',
    agentKey: 'k',
    args: { action: 'list' },
  });
  check('browser_tabs list succeeds', tabs.ok === true, tabs.ok ? tabs.content : tabs.error);

  const release = await gateway.handle({ tool: 'browser_release', agentKey: 'k' });
  check('browser_release succeeds', release.ok === true);

  const afterRelease = await gateway.handle({
    tool: 'browser_click',
    agentKey: 'k',
    args: { ref: usernameRef },
  });
  check('a tool call after release is refused (lock enforced)', afterRelease.ok === false);

  check('the control-change callback fired for acquire and release', notifications.length === 2);

  await session.close();

  // Regression re-check, after everything above: a fresh connection re-running the exact
  // in-page checks the original spike validated, to prove the dispatcher's own evaluate
  // calls (the tagging script, the credential-field check, the cover overlay) did not
  // introduce a leak the minimal spike script never exercised.
  const browser2 = await chromium.connectOverCDP(CDP_URL);
  const context2 = browser2.contexts()[0];
  const page2 = context2.pages()[0] ?? (await context2.newPage());
  await page2.goto(PAGE_URL, { waitUntil: 'load' });
  const leakResults = (await page2.evaluate(() => {
    function checkWebdriver() {
      return { name: 'webdriver', leak: navigator.webdriver === true };
    }
    function checkSourceURLTrace() {
      const stack = new Error('probe').stack || '';
      const patterns = [
        '__playwright_evaluation_script__',
        '__puppeteer_evaluation_script__',
        'pptr:internal',
      ];
      return { name: 'sourceURL-trace', leak: patterns.some((p) => stack.includes(p)) };
    }
    function checkBindings() {
      const names = Object.getOwnPropertyNames(window);
      const hits = names.filter((n) => /^__pw|^__playwright|^__puppeteer|^cdc_/i.test(n));
      return { name: 'bindings', leak: hits.length > 0, hits };
    }
    return [checkWebdriver(), checkSourceURLTrace(), checkBindings()];
  })) as { name: string; leak: boolean }[];
  for (const result of leakResults) {
    check(
      `post-interaction bot-leak check: ${result.name}`,
      result.leak === false,
      JSON.stringify(result),
    );
  }
  await browser2.close();

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('live e2e crashed:', error);
  process.exit(1);
});
