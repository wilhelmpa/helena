// Supplementary negative control: proves the bindings-check fires when a CDP client plants a
// global binding the way Puppeteer/Playwright's exposeBinding does (Runtime.addBinding).
const cdpPort = Number(process.argv[2] || 19566);
const pageUrl = process.argv[3] || 'http://127.0.0.1:18566/';

async function main() {
  const listResp = await fetch(`http://127.0.0.1:${cdpPort}/json`);
  const targets = await listResp.json();
  const target = targets.find((t) => t.type === 'page');
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
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Runtime.addBinding', { name: '__playwright_binding__probe' });
  await send('Page.navigate', { url: pageUrl });
  await new Promise((r) => setTimeout(r, 800));
  const evalResp = await send('Runtime.evaluate', {
    expression: `Object.getOwnPropertyNames(window).filter(n => /^__pw|^__playwright|^__puppeteer|^cdc_/i.test(n))`,
    returnByValue: true,
  });
  console.log(
    'bindings found on window after Runtime.addBinding:',
    JSON.stringify(evalResp.result.result.value),
  );
  ws.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
