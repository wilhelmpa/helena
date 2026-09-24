// Positive test: connects to the already-running, headed system Chromium the same way the
// Browser Gateway will (connectOverCDP to a loopback CDP endpoint of a Chromium the gateway did
// NOT launch itself), then drives the leak-test page through patchright-core's normal locator
// API (not a raw evaluate escape hatch) and runs the same leak checks *through patchright's own
// evaluate mechanism* (isolated world) rather than calling a main-world global — this is the
// direct, honest test of whether patchright's own evaluate avoids the leaks, since it turned out
// patchright's page.evaluate() runs in an isolated world and cannot see main-world globals
// defined by the page's own inline <script> (window.runLeakChecks) — which is itself a first,
// useful spike finding (patchright does NOT share a JS realm with the page's own script, unlike
// classic Puppeteer/Playwright's default main-world evaluate).
import { chromium } from 'patchright-core';

const cdpPort = Number(process.argv[2] || 19566);
const pageUrl = process.argv[3] || 'http://127.0.0.1:18566/';

// pageChecks() and listSuspiciousGlobals() below are never called in this Node process —
// they are handed to patchright's page.evaluate() and run inside the browser page, where
// navigator/window/document/screen are real globals. This file's own eslint config only
// knows Node's globals, hence the directive.
/* global window, document, screen */
function pageChecks() {
  function checkWebdriver() {
    return {
      name: 'webdriver',
      leak: navigator.webdriver === true,
      detail: String(navigator.webdriver),
    };
  }
  function checkConsoleGetterTrick() {
    let hits = 0;
    const obj = {};
    Object.defineProperty(obj, 'probe', {
      get() {
        hits++;
        return 1;
      },
      enumerable: true,
    });
    console.log(obj);
    return { name: 'console-getter-trick', leak: hits > 0, detail: 'getter invocations: ' + hits };
  }
  function checkErrorStackTrick() {
    let accessed = false;
    const e = new Error('probe');
    Object.defineProperty(e, 'stack', {
      get() {
        accessed = true;
        return 'redacted';
      },
      configurable: true,
    });
    console.log(e);
    return {
      name: 'error-stack-getter-trick',
      leak: accessed,
      detail: 'stack getter invoked: ' + accessed,
    };
  }
  function checkSourceURLTrace() {
    // Only the stack trace is a meaningful signal — a CDP init script never materializes as a
    // document.scripts entry, so scanning script tag text/src is not a real signal and, worse,
    // self-matches this very function's own source (it contains these pattern strings).
    const stack = new Error('probe').stack || '';
    const patterns = [
      '__playwright_evaluation_script__',
      '__puppeteer_evaluation_script__',
      'pptr:internal',
      'playwright-core',
      'puppeteer-core',
      '__pw_',
    ];
    const stackHits = patterns.filter((p) => stack.includes(p));
    const externalScriptSrcHits = [];
    for (const s of document.scripts) {
      const src = s.src || '';
      if (!src) continue;
      for (const p of patterns) {
        if (src.includes(p)) externalScriptSrcHits.push(p);
      }
    }
    return {
      name: 'sourceURL-trace',
      leak: stackHits.length > 0,
      detail: JSON.stringify({ stack, stackHits, externalScriptSrcHits }),
    };
  }
  function checkBindings() {
    const names = Object.getOwnPropertyNames(window);
    const patterns = [
      /^__playwright/i,
      /^__pw_?/i,
      /^__puppeteer/i,
      /^__pptr/i,
      /^cdc_/i,
      /exposeBinding/i,
    ];
    const hits = names.filter((n) => patterns.some((p) => p.test(n)));
    return { name: 'bindings', leak: hits.length > 0, detail: JSON.stringify(hits) };
  }
  function collectUaConsistency() {
    let uaPlatform = null;
    try {
      uaPlatform = navigator.userAgentData ? navigator.userAgentData.platform : null;
    } catch (e) {
      uaPlatform = 'error:' + e.message;
    }
    return {
      name: 'ua-consistency',
      leak: false,
      detail: JSON.stringify({
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        uaDataPlatform: uaPlatform,
        languages: navigator.languages,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        hardwareConcurrency: navigator.hardwareConcurrency,
        pluginsLength: navigator.plugins ? navigator.plugins.length : null,
        screen: { w: screen.width, h: screen.height },
        inner: { w: window.innerWidth, h: window.innerHeight },
        hasChrome: typeof window.chrome !== 'undefined',
      }),
    };
  }
  return [
    checkWebdriver(),
    checkConsoleGetterTrick(),
    checkErrorStackTrick(),
    checkSourceURLTrace(),
    checkBindings(),
    collectUaConsistency(),
  ];
}

function listSuspiciousGlobals() {
  return Object.getOwnPropertyNames(window).filter((n) =>
    /^__pw|^__playwright|^__puppeteer|^cdc_/i.test(n),
  );
}

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.newPage());

  await page.goto(pageUrl, { waitUntil: 'load' });

  // Exercise the real interaction surface the gateway tools will use: locator-based fill/click
  // with patchright's human-like actionability waits, not page.evaluate for the interaction
  // itself.
  await page.locator('#user').click();
  await page.locator('#user').fill('spike-user');
  await page.locator('#pass').click();
  await page.locator('#pass').fill('not-a-real-secret');

  const bindingsBefore = await page.evaluate(listSuspiciousGlobals);
  const results = await page.evaluate(pageChecks);
  const bindingsAfter = await page.evaluate(listSuspiciousGlobals);

  await page.locator('#submitBtn').click();
  const statusAfterSubmit = await page.locator('#status').textContent();

  console.log(
    JSON.stringify(
      {
        leakResults: results,
        bindingsBefore,
        bindingsAfter,
        statusAfterSubmit,
      },
      null,
      2,
    ),
  );

  await browser.close();
}

main().catch((err) => {
  console.error('patchright check failed:', err);
  process.exit(1);
});
