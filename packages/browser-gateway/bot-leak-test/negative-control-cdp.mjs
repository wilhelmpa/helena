// Negative control: proves the leak-test page's checks actually fire when a classic
// Puppeteer/Playwright-style CDP client (Runtime.enable'd, Runtime.evaluate with a synthetic
// sourceURL) drives the page. Uses only raw CDP over the platform WebSocket client (Node 22+
// has a global WebSocket) — no extra npm package.
const cdpPort = Number(process.argv[2] || 19399);
const pageUrl = process.argv[3] || 'http://127.0.0.1:18779/';

async function main() {
  const listResp = await fetch(`http://127.0.0.1:${cdpPort}/json`);
  const targets = await listResp.json();
  const target = targets.find((t) => t.type === 'page');
  if (!target) throw new Error('no page target found on cdp port ' + cdpPort);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id).resolve(msg);
      pending.delete(msg.id);
    }
  });

  function send(method, params = {}) {
    const thisId = ++id;
    const p = new Promise((resolve) => pending.set(thisId, { resolve }));
    ws.send(JSON.stringify({ id: thisId, method, params }));
    return p;
  }

  // Classic Puppeteer/Playwright (pre-patchright) pattern: enable Runtime, then evaluate with a
  // synthetic sourceURL — this is exactly the pattern patchright avoids and the leak-test page
  // detects.
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: pageUrl });
  await new Promise((r) => setTimeout(r, 800));

  const evalResp = await send('Runtime.evaluate', {
    expression: `window.runLeakChecks()\n//# sourceURL=__puppeteer_evaluation_script__12345`,
    returnByValue: true,
    awaitPromise: false,
  });

  console.log(JSON.stringify(evalResp.result.result.value, null, 2));
  ws.close();
}

main().catch((err) => {
  console.error('negative control failed:', err);
  process.exit(1);
});
