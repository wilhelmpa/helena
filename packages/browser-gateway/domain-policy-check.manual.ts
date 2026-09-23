// Manual live check for design §8's domain block/allowlist enforcement (session.ts's
// applyDomainPolicy) — NOT part of `bun test` (needs a real, already-running headed
// Chromium reachable at <cdpUrl>, plus real internet access for the example.com checks; see
// bot-leak-test/README.md for how to stand one up). Run:
//   bun run domain-policy-check.manual.ts <cdpUrl>
import { PatchrightGatewaySession } from '@repo/browser-gateway';

const CDP_URL = process.argv[2] || 'http://127.0.0.1:19599';

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const session = await PatchrightGatewaySession.connect(CDP_URL, {
    vaultInbox: '/tmp',
    humanInput: false,
  });

  // Start from a known page so a blocked attempt's failure mode is unambiguous.
  await session.navigate('http://127.0.0.1:18599/');
  await sleep(300);

  // Block example.com outright.
  await session.applyDomainPolicy({ domainBlocklist: ['example.com'], domainAllowlist: [] });
  let blockedThrew = false;
  let blockedError = '';
  try {
    await session.navigate('http://example.com/');
  } catch (error) {
    blockedThrew = true;
    blockedError = error instanceof Error ? error.message : String(error);
  }
  await sleep(500); // let Chromium fully settle after the aborted navigation before the next one
  const afterBlocked = await session.status();
  check(
    'navigation to a blocked domain throws and does not end up on that page',
    blockedThrew && !afterBlocked.url.includes('example.com'),
    blockedThrew ? blockedError.split('\n')[0] : JSON.stringify(afterBlocked),
  );

  // A domain not on any list is unaffected.
  await session.navigate('http://127.0.0.1:18599/');
  await sleep(300);
  const afterAllowed = await session.status();
  check(
    'an unlisted domain still navigates normally',
    afterAllowed.url.includes('127.0.0.1:18599'),
    afterAllowed.url,
  );

  // Now an allowlist that does NOT include example.com — same result as a blocklist hit.
  await session.applyDomainPolicy({ domainBlocklist: [], domainAllowlist: ['127.0.0.1'] });
  let allowlistThrew = false;
  try {
    await session.navigate('http://example.com/');
  } catch {
    allowlistThrew = true;
  }
  await sleep(500);
  const afterAllowlist = await session.status();
  check(
    'an exclusive allowlist blocks a domain not on it',
    allowlistThrew && !afterAllowlist.url.includes('example.com'),
    JSON.stringify(afterAllowlist),
  );

  // The allowed one still works.
  await session.navigate('http://127.0.0.1:18599/');
  await sleep(300);
  const stillAllowed = await session.status();
  check(
    'the allowlisted domain still works',
    stillAllowed.url.includes('127.0.0.1:18599'),
    stillAllowed.url,
  );

  // Re-applying the identical policy is a no-op (no throw, no behavior change) — proves the
  // idempotency the dispatcher relies on to call this before every tool cheaply.
  await session.applyDomainPolicy({ domainBlocklist: [], domainAllowlist: ['127.0.0.1'] });
  check('re-applying the same policy does not throw', true);

  await session.close();
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('domain policy check crashed:', error);
  process.exit(1);
});
