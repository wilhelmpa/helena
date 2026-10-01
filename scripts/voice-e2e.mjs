// End-to-end check of voice in the chat (docs/helena-decisions/voice.md), in a headless Chrome
// whose microphone plays a WAV file (Chrome's fake media stream). No npm dependencies: Chrome's
// DevTools protocol over the WebSocket Node ships.
//
//   node scripts/voice-e2e.mjs --base http://kingston-server.local --path /project/VOL/chat \
//     --wav voice-e2e-de.wav --chrome "<Chrome for Testing binary>" \
//     [--map "kingston-server.local 192.168.2.58"] [--cookie-file f --cookie-url <api origin>] \
//     [--expect "hallo,? home"] [--steps insecure,dictation,conversation] [--shots dir]
//
// Steps:
//   insecure      the page as plain http (no flag): the microphone button explains the Chrome
//                 flag instead of doing nothing.
//   dictation     with `--unsafely-treat-insecure-origin-as-secure` for the base origin (what the
//                 owner sets in chrome://flags): dictate, stop, the text lands in the composer.
//   conversation  start the conversation mode: the utterance is sent, the answer streams and is
//                 read aloud, then it listens again; the phases seen are printed.
//   bargein       (on its own, with a WAV holding a second sentence ~7 s after the first, and an
//                 agent that answers within that time) the second sentence interrupts the reading.
//   timing        (hub/voice-2) runs --turns conversation turns (Chrome loops the WAV, so the
//                 sentence comes again) and prints where each turn's time went: the pause, the
//                 transcription, the answer's first words, the first sound — read from the
//                 conversation line's `data-voice-timings`. `--max-total <ms>` fails the step
//                 when the median turn is slower.
//
// The WAV should hold a short sentence after ~1.5 s of silence and then long silence (Chrome
// loops the file): e.g. `say -v Anna "Hallo Home, wie spät ist es?"` padded. Exit code 0 when
// every step passed.
import { summarizeVoiceTimings } from './voice-e2e-timing.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]]);
    return pairs;
  }, []),
);
const BASE = args.base ?? 'http://kingston-server.local';
const PATH = args.path ?? '/chat';
const WAV = resolve(args.wav ?? 'voice-e2e-de.wav');
const CHROME = args.chrome ?? process.env.CHROME_BIN;
// What the recording says, as a case-insensitive pattern (Whisper may punctuate differently).
const EXPECT = args.expect ?? 'hallo,? home';
const STEPS = (args.steps ?? 'insecure,dictation,conversation').split(',');
if (STEPS.includes('bargein') && STEPS.includes('conversation'))
  throw new Error('run bargein on its own (its WAV has two sentences)');
const SHOTS = args.shots ?? null;
if (!CHROME) throw new Error('--chrome <binary> or CHROME_BIN is required');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const origin = new URL(BASE).origin;

async function launch({ secure }) {
  const profile = mkdtempSync(join(args.profile ?? tmpdir(), 'helena-voice-e2e-'));
  const port = 9600 + Math.floor(Math.random() * 300);
  const flags = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--lang=de-DE',
    `--window-size=${args.window ?? '1280,900'}`,
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${WAV}`,
    '--autoplay-policy=no-user-gesture-required',
    ...(args.map ? [`--host-resolver-rules=MAP ${args.map}`] : []),
    ...(secure ? [`--unsafely-treat-insecure-origin-as-secure=${origin}`] : []),
    'about:blank',
  ];
  const chrome = spawn(CHROME, flags, { stdio: 'ignore' });
  let target;
  for (let tries = 0; tries < 60 && !target; tries += 1) {
    await sleep(200);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((entry) => entry.type === 'page');
    } catch {
      // not up yet
    }
  }
  if (!target) throw new Error('Chrome did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done) => ws.addEventListener('open', done));
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve: ok, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else ok(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      errors.push(`[exception] ${(details.exception?.description ?? details.text).slice(0, 300)}`);
    }
    // Content-security-policy refusals and failed loads arrive here, not on the console API.
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      errors.push(
        `[log.error] ${message.params.entry.text.slice(0, 300)} ${message.params.entry.url ?? ''}`,
      );
    }
    if (message.method === 'Runtime.consoleAPICalled' && args.verbose) {
      console.log(
        `  [console.${message.params.type}]`,
        message.params.args
          .map((arg) => arg.value ?? arg.description ?? '')
          .join(' ')
          .slice(0, 300),
      );
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(
        `[console.error] ${message.params.args
          .map((arg) => arg.value ?? arg.description ?? '')
          .join(' ')
          .slice(0, 300)}`,
      );
    }
  });
  const send = (method, params = {}) =>
    new Promise((ok, reject) => {
      const id = (seq += 1);
      pending.set(id, { resolve: ok, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Log.enable');
  if (args['cookie-file']) {
    const cookies = readFileSync(args['cookie-file'], 'utf8').trim().split(/;\s*/);
    for (const pair of cookies) {
      const at = pair.indexOf('=');
      await send('Network.setCookie', {
        name: pair.slice(0, at),
        value: pair.slice(at + 1),
        url: args['cookie-url'] ?? origin,
      });
    }
  }
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression, timeoutMs, label) => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const value = await evaluate(expression).catch(() => null);
      if (value) return value;
      await sleep(250);
    }
    throw new Error(`timed out waiting for ${label}`);
  };
  const shot = async (name) => {
    if (!SHOTS) return;
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
  };
  // Clicks the first button whose accessible name matches.
  const clickButton = (pattern) =>
    evaluate(`(() => {
      const re = new RegExp(${JSON.stringify(pattern)}, 'i');
      const button = [...document.querySelectorAll('button')].find((b) => re.test(b.getAttribute('aria-label') ?? '') || re.test(b.textContent ?? ''));
      if (!button) return false;
      button.click();
      return true;
    })()`);
  const close = () => {
    ws.close();
    chrome.kill('SIGKILL');
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
  };
  const open = async () => {
    await send('Page.navigate', { url: `${BASE}${PATH}` });
    await waitFor(`!!document.querySelector('textarea')`, 45_000, 'the composer');
    await sleep(1500);
  };
  return { evaluate, waitFor, shot, clickButton, close, open, errors };
}

const composerValue = `document.querySelector('textarea')?.value ?? ''`;
const statusText = `[...document.querySelectorAll('[role=status]')].map((node) => node.textContent).join(' | ')`;

const results = [];
async function step(name, run) {
  const started = Date.now();
  try {
    const detail = await run();
    results.push({ name, ok: true, ms: Date.now() - started, detail });
    console.log(`PASS ${name} (${Date.now() - started} ms)`, detail ?? '');
  } catch (error) {
    results.push({ name, ok: false, error: String(error) });
    console.log(`FAIL ${name}: ${error}`);
  }
}

if (STEPS.includes('insecure')) {
  await step('insecure page explains the Chrome flag', async () => {
    const page = await launch({ secure: false });
    try {
      await page.open();
      const secure = await page.evaluate('window.isSecureContext');
      if (secure) return 'skipped: the page is a secure context already';
      if (!(await page.clickButton('Diktieren|Dictate'))) throw new Error('no dictation button');
      const toast = await page.waitFor(
        `[...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent).join(' ') || ''`,
        5_000,
        'a toast',
      );
      await sleep(1_000);
      await page.shot('insecure');
      if (!toast.includes('chrome://flags/#unsafely-treat-insecure-origin-as-secure'))
        throw new Error(`the toast does not name the flag: ${toast.slice(0, 200)}`);
      return toast.slice(0, 120);
    } finally {
      if (page.errors.length) console.log(page.errors.join('\n'));
      page.close();
    }
  });
}

if (['dictation', 'conversation', 'bargein', 'timing'].some((name) => STEPS.includes(name))) {
  const page = await launch({ secure: true });
  try {
    await page.open();
    if (STEPS.includes('dictation')) {
      await step('dictation writes the sentence into the composer', async () => {
        if (!(await page.clickButton('Diktieren|Dictate'))) throw new Error('no dictation button');
        await sleep(5_500);
        await page.shot('dictation-recording');
        if (!(await page.clickButton('Diktat beenden|Stop dictation')))
          throw new Error('no stop button');
        const value = await page.waitFor(
          `new RegExp(${JSON.stringify(EXPECT)}, 'i').test(${composerValue}) && (${composerValue})`,
          45_000,
          `/${EXPECT}/ in the composer`,
        );
        await page.shot('dictation-done');
        // Empty the composer again (React listens to the native input event).
        await page.evaluate(`(() => {
          const area = document.querySelector('textarea');
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(area, '');
          area.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
        return value;
      });
    }
    if (STEPS.includes('conversation')) {
      await step('a conversation turn runs end to end', async () => {
        const count = (align) =>
          page.evaluate(
            `document.querySelectorAll('[data-slot=message][data-align=${align}]').length`,
          );
        const users = await count('end');
        const answers = await count('start');
        if (!(await page.clickButton('Gespräch starten|Start a conversation')))
          throw new Error('no conversation button');
        const phases = [];
        const until = Date.now() + 150_000;
        let heard = '';
        let answered = false;
        while (Date.now() < until) {
          const status = await page.evaluate(statusText).catch(() => '');
          const phase = status.split('|')[0]?.trim().slice(0, 70) ?? '';
          if (phase && phases.at(-1) !== phase) phases.push(phase);
          if (!heard && (await count('end')) > users) {
            heard = await page.evaluate(
              `[...document.querySelectorAll('[data-slot=message][data-align=end]')].at(-1)?.innerText ?? ''`,
            );
          }
          const streaming = await page.evaluate(`!!document.querySelector('[aria-busy=true]')`);
          answered ||= (await count('start')) > answers && !streaming;
          if (answered && /Ich höre zu|Listening/.test(phase)) break;
          await sleep(300);
        }
        await page.shot('conversation');
        await page.clickButton('Gespräch beenden|End the conversation');
        if (!heard) throw new Error(`nothing was sent; phases: ${phases.join(' → ')}`);
        if (!new RegExp(EXPECT, 'i').test(heard)) throw new Error(`sent "${heard}"`);
        if (!answered) throw new Error(`no answer arrived; phases: ${phases.join(' → ')}`);
        return `sent "${heard.trim()}"; phases: ${phases.join(' → ')}`;
      });
    }
    if (STEPS.includes('bargein')) {
      // Needs a WAV with a second sentence a few seconds after the first (while the answer is
      // read) and an agent that answers within them: the dev stack's fake runner.
      await step('speaking interrupts the reading', async () => {
        const count = (align) =>
          page.evaluate(
            `document.querySelectorAll('[data-slot=message][data-align=${align}]').length`,
          );
        const users = await count('end');
        if (!(await page.clickButton('Gespräch starten|Start a conversation')))
          throw new Error('no conversation button');
        const timeline = [];
        const until = Date.now() + 90_000;
        let interrupted = false;
        while (Date.now() < until) {
          const status = await page.evaluate(statusText).catch(() => '');
          const phase = status.split('|')[0]?.trim().slice(0, 40) ?? '';
          const sent = (await count('end')) - users;
          const last = timeline.at(-1);
          if (!last || last.phase !== phase || last.sent !== sent) timeline.push({ phase, sent });
          const spoke = timeline.findIndex(
            (entry) => entry.sent === 1 && /spricht|speaking/i.test(entry.phase),
          );
          if (
            spoke >= 0 &&
            timeline.slice(spoke).some((entry) => /höre dich|Hearing you/i.test(entry.phase))
          )
            interrupted = true;
          if (interrupted && sent >= 2 && /Ich höre zu|Listening/.test(phase)) break;
          await sleep(200);
        }
        await page.shot('bargein');
        await page.clickButton('Gespräch beenden|End the conversation');
        const story = timeline.map((entry) => `${entry.sent}:${entry.phase}`).join(' → ');
        if (!interrupted) throw new Error(`the reading was not interrupted: ${story}`);
        return story;
      });
    }
    if (STEPS.includes('timing')) {
      await step('conversation turns are timed', async () => {
        const turns = Number(args.turns ?? 3);
        const maxTotal = args['max-total'] ? Number(args['max-total']) : null;
        if (!(await page.clickButton('Gespräch starten|Start a conversation')))
          throw new Error('no conversation button');
        const seen = [];
        let last = '';
        const until = Date.now() + Number(args['timing-ms'] ?? 120_000);
        while (Date.now() < until && seen.length < turns) {
          const value = await page
            .evaluate(`document.querySelector('[data-voice-timings]')?.dataset.voiceTimings ?? ''`)
            .catch(() => '');
          if (value && value !== last) {
            last = value;
            seen.push(JSON.parse(value));
            console.log('  turn', seen.length, value);
          }
          await sleep(100);
        }
        await page.shot('timing');
        await page.clickButton('Gespräch beenden|End the conversation');
        const summary = summarizeVoiceTimings(seen, turns, maxTotal);
        return `${seen.length} turns, median ${JSON.stringify(summary)}`;
      });
    }
  } finally {
    if (page.errors.length) console.log(page.errors.join('\n'));
    page.close();
  }
}

const failed = results.filter((result) => !result.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length }));
process.exit(failed.length ? 1 : 0);
