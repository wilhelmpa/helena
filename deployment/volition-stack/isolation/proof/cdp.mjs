// Sets or reads a cookie of a Chromium over its DevTools protocol, for the browser proof:
//   node cdp.mjs <port> set <name> <value>   |   node cdp.mjs <port> get <name>
const [port, action, name, value] = process.argv.slice(2);
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
let id = 0;
const pending = new Map();
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
};
const call = (method, params = {}) =>
  new Promise((resolve) => {
    id += 1;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
if (action === 'set') {
  const answer = await call('Storage.setCookies', {
    cookies: [
      {
        name,
        value,
        domain: 'example.com',
        path: '/',
        secure: true,
        httpOnly: true,
        expires: Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
      },
    ],
  });
  console.log(JSON.stringify({ ok: !answer.error, error: answer.error ?? null }));
} else {
  const answer = await call('Storage.getCookies');
  const cookie = (answer.result?.cookies ?? []).find((entry) => entry.name === name);
  console.log(JSON.stringify({ ok: Boolean(cookie), value: cookie?.value ?? null }));
}
socket.close();
process.exit(0);
