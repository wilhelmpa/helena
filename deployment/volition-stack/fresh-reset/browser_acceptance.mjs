#!/usr/bin/env node
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire('/home/pw/services/volition-stack/integration/package.json');
const WebSocket = require('ws');
const CDP = 'http://127.0.0.1:9223';
const NOVNC = 'ws://127.0.0.1:6081/websockify';

function now() { return new Date().toISOString(); }
async function json(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`CDP HTTP ${response.status}`);
  return response.json();
}
async function command(ws, method, params = {}) {
  const id = command.next++;
  return new Promise((resolve, reject) => {
    const onMessage = (raw) => {
      const value = JSON.parse(raw.toString());
      if (value.id !== id) return;
      ws.off('message', onMessage);
      if (value.error) reject(new Error(`${method} failed`));
      else resolve(value.result ?? {});
    };
    ws.on('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
command.next = 1;
async function withPage(fn) {
  const target = await json(`${CDP}/json/new?about%3Ablank`, { method: 'PUT' });
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  try { return await fn(ws); }
  finally {
    ws.close();
    await fetch(`${CDP}/json/close/${encodeURIComponent(target.id)}`).catch(() => {});
  }
}
async function noVnc() {
  const ws = new WebSocket(NOVNC, ['binary']);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('noVNC websocket timeout')), 5000);
    ws.once('open', () => { clearTimeout(timer); resolve(); });
    ws.once('error', reject);
  });
  ws.close();
}

const mode = process.argv[2];
const cookieName = 'volition_fresh_acceptance';
if (mode === 'seed') {
  const value = crypto.randomBytes(24).toString('hex');
  await withPage(async (ws) => {
    await command(ws, 'Network.enable');
    const set = await command(ws, 'Network.setCookie', {
      name: cookieName,
      value,
      url: 'http://fresh-acceptance.local/',
      expires: Math.floor(Date.now() / 1000) + 3600,
      httpOnly: true,
      sameSite: 'Strict',
    });
    if (set.success !== true) throw new Error('CDP cookie seed failed');
    await command(ws, 'Page.navigate', { url: 'data:text/html,Volition%20fresh%20browser%20acceptance' });
  });
  process.stdout.write(JSON.stringify({ cookieValue: value, seededAt: now() }));
} else if (mode === 'verify') {
  const expected = process.env.VOLITION_ACCEPTANCE_COOKIE;
  if (!expected) throw new Error('acceptance cookie is unavailable');
  await withPage(async (ws) => {
    await command(ws, 'Network.enable');
    const result = await command(ws, 'Network.getAllCookies');
    const found = result.cookies?.some((cookie) => cookie.name === cookieName && cookie.value === expected);
    if (!found) throw new Error('browser profile did not persist across restart');
    await command(ws, 'Network.deleteCookies', { name: cookieName, url: 'http://fresh-acceptance.local/' });
  });
  await noVnc();
  process.stdout.write(JSON.stringify({ verifiedAt: now(), noVncVerifiedAt: now() }));
} else {
  throw new Error('usage: browser_acceptance.mjs seed|verify');
}
