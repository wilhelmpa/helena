import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'patchright-core';
import { PatchrightGatewaySession } from '../session';
import type { TaskPage } from './loop';
import { OBSERVE, PAGE_KEY, GUARD } from './page-script';
import { matchesSuccess } from './success';

// Opt-in: an already installed binary, a private disposable profile and no remote site/model.
const executablePath = process.env.HELENA_BROWSER_TEST_EXECUTABLE;
describe.skipIf(!executablePath)('native browser observation and execution guards', () => {
  let directory: string;
  let child: ChildProcess;
  let browser: Browser;
  let page: Page;
  let task: TaskPage;
  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'helena-native-browser-test-'));
    child = spawn(
      executablePath!,
      [
        '--headless=new',
        `--user-data-dir=${directory}`,
        '--remote-debugging-port=0',
        '--remote-debugging-address=127.0.0.1',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync',
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    let port: string | undefined;
    for (let i = 0; i < 100; i++) {
      port = await readFile(path.join(directory, 'DevToolsActivePort'), 'utf8')
        .then((text) => text.split('\n')[0])
        .catch(() => undefined);
      if (port) break;
      await Bun.sleep(100);
    }
    if (!port) throw new Error('Private test Chromium did not start');
    const url = `http://127.0.0.1:${port}`;
    browser = await chromium.connectOverCDP(url);
    page = browser.contexts()[0]!.pages()[0]!;
    const session = await PatchrightGatewaySession.connect(url, { humanInput: false });
    task = session.taskPage();
  }, 15_000);
  afterAll(async () => {
    await browser?.close().catch(() => {});
    child?.kill('SIGKILL');
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('compares original target semantics and surrounding context, not just existence', async () => {
    await page.setContent(
      '<form><p id="context">Invoice A</p><button aria-label="Send">Send</button></form>',
    );
    const observation = await task.observe();
    const element = observation.elements[0]!;
    expect(await task.fresh(observation, element)).toBe(true);
    await page.locator('#context').evaluate((e) => (e.textContent = 'Invoice B'));
    expect(await task.fresh(observation, element)).toBe(false);
    await expect(task.act({ observation, operation: 'CLICK', element })).rejects.toThrow();
  });

  it('never verifies a truncated or normalized field value as an exact match', async () => {
    await page.setContent('<label>Name<input value=""></label>');
    const success = (value: string) => ({ fields: [{ label: 'Name', value }] });
    expect(matchesSuccess(await task.observe(), success(''))).toBe(true);
    await page.locator('input').fill('Ada');
    expect(matchesSuccess(await task.observe(), success('Ada'))).toBe(true);
    await page.locator('input').fill('x'.repeat(61));
    expect(matchesSuccess(await task.observe(), success('x'.repeat(60)))).toBe(false);
    await page.locator('input').fill('Ada  Lovelace');
    expect(matchesSuccess(await task.observe(), success('Ada Lovelace'))).toBe(false);
  });

  it('rejects changed labels, replaced nodes and navigation after inference', async () => {
    await page.setContent('<button aria-label="Safe">Go</button>');
    let observation = await task.observe();
    await page.locator('button').evaluate((e) => e.setAttribute('aria-label', 'Delete'));
    expect(await task.fresh(observation, observation.elements[0]!)).toBe(false);
    observation = await task.observe();
    await page.locator('button').evaluate((e) => e.replaceWith(e.cloneNode(true)));
    expect(await task.fresh(observation, observation.elements[0]!)).toBe(false);
    observation = await task.observe();
    await page.goto('about:blank#changed');
    expect(await task.fresh(observation, observation.elements[0]!)).toBe(false);
  });

  it('rejects a field type or form destination changed after observation', async () => {
    await page.setContent(
      '<form action="https://example.test/safe"><label>Name<input></label><button>Send</button></form>',
    );
    const observation = await task.observe();
    const field = observation.elements.find((e) => e.editable)!;
    const button = observation.elements.find((e) => e.tag === 'button')!;
    await page.locator('input').evaluate((e) => e.setAttribute('type', 'file'));
    expect(await task.fresh(observation, field)).toBe(false);
    await page.locator('form').evaluate((e) => e.setAttribute('action', 'https://other.test/send'));
    expect(await task.fresh(observation, button)).toBe(false);
  });

  it('recomputes form keys including newly inserted shadow DOM fields', async () => {
    await page.setContent('<div id="host"></div>');
    await page.locator('#host').evaluate((e) => {
      e.attachShadow({ mode: 'open' }).innerHTML = '<label>Name<input value="Ada"></label>';
    });
    const observed = await page.evaluate(OBSERVE, {
      textLimit: 2500,
      maxElements: 400,
      main: true,
    });
    expect(observed?.elements.some((e) => e.label === 'Name')).toBe(true);
    await page.locator('#host').evaluate((e) => {
      e.shadowRoot!.innerHTML += '<input value="new">';
    });
    expect(await page.evaluate(PAGE_KEY)).not.toBe(observed!.key);
  });

  it('excludes hidden success text and detects a terminal page height change', async () => {
    await page.setContent(
      '<p>Visible status</p><p style="visibility:hidden">Secret success</p><p aria-hidden="true">Hidden success</p><div style="opacity:0"><p>Transparent success</p></div>',
    );
    const observation = await task.observe();
    expect(observation.text).toContain('Visible status');
    expect(observation.text).not.toContain('success');
    expect(await task.fresh(observation, null)).toBe(true);
    await page.locator('body').evaluate((e) => (e.style.height = '3000px'));
    expect(await task.fresh(observation, null)).toBe(false);
  });

  it('selects duplicate values by observed index and consumes the decision once', async () => {
    await page.setContent(
      '<label>Plan<select onchange="document.body.dataset.changes = String(Number(document.body.dataset.changes || 0) + 1)"><option>Choose</option><optgroup disabled><option>Disabled group</option></optgroup><option value="same">First</option><option value="same">Second</option></select></label>',
    );
    const observation = await task.observe();
    const element = observation.elements.find((e) => e.selectable)!;
    expect(element.options).toEqual(['Choose', 'First', 'Second']);
    expect(element.optionIndices).toEqual([0, 2, 3]);
    await task.act({ observation, operation: 'SELECT', element, option: 'Second', optionIndex: 3 });
    expect(
      await page.locator('select').evaluate((e) => (e as HTMLSelectElement).selectedIndex),
    ).toBe(3);
    await expect(
      task.act({ observation, operation: 'SELECT', element, option: 'Second', optionIndex: 3 }),
    ).rejects.toThrow();
    expect(await page.locator('body').getAttribute('data-changes')).toBe('1');
  }, 15_000);

  it('refuses covered selects and options changed since observation', async () => {
    await page.setContent(
      '<select aria-label="Plan"><option>A</option><option>B</option></select>',
    );
    let observation = await task.observe();
    let element = observation.elements[0]!;
    await page.locator('body').evaluate((e) => {
      const cover = document.createElement('div');
      cover.style.cssText = 'position:fixed;inset:0;background:white;z-index:9999';
      e.append(cover);
    });
    await expect(
      task.act({ observation, operation: 'SELECT', element, option: 'B', optionIndex: 1 }),
    ).rejects.toThrow();
    expect(
      await page.locator('select').evaluate((e) => (e as HTMLSelectElement).selectedIndex),
    ).toBe(0);
    await page.locator('body > div').evaluate((e) => e.remove());
    observation = await task.observe();
    element = observation.elements[0]!;
    await page
      .locator('option')
      .last()
      .evaluate((e) => e.setAttribute('disabled', ''));
    expect(await task.fresh(observation, element)).toBe(false);
  });

  it('keeps observed guard data private and omits credential values', async () => {
    await page.setContent(
      '<input type="password" value="synthetic-password"><button>Continue</button>',
    );
    const observation = await task.observe();
    expect(JSON.stringify(observation)).not.toContain('synthetic-password');
    expect(Object.keys(observation)).not.toContain('guards');
    const raw = await page.evaluate(OBSERVE, { textLimit: 2500, maxElements: 400, main: true });
    const credential = raw!.elements.find((e) => e.credential)!;
    expect(await page.evaluate(GUARD, credential.id)).not.toContain('synthetic-password');
  });

  it('preserves caller-supplied typing without submitting the form', async () => {
    await page.setContent(
      '<form onsubmit="document.body.dataset.submitted=\'yes\'; return false"><label>Name<input></label><button>Submit</button></form>',
    );
    const observation = await task.observe();
    const element = observation.elements.find((e) => e.editable)!;
    await task.act({ observation, operation: 'TYPE_TEXT', element, text: 'Ada' });
    expect(await page.locator('input').inputValue()).toBe('Ada');
    expect(await page.locator('body').getAttribute('data-submitted')).toBeNull();
    expect(observation.elements.find((e) => e.tag === 'button')?.submits).toBe(true);
  }, 15_000);
});
