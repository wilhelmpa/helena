import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// The rules of the UI audit (scripts/ui-audit-rules.mjs) are pure functions over measurements: a
// deviation of more than one pixel in a left edge, a head, a control or the room a pinned overlay
// takes is a finding (owner 30.09., O92, O102, O103, O104).
const rules = await import('../../scripts/ui-audit-rules.mjs');

const edges = (over: Record<string, unknown> = {}) => ({
  variant: 'default',
  phone: false,
  crumb: 32,
  bar: null,
  content: 32,
  gap: 24,
  headerHeight: 56,
  pad: { x: 32, top: 24, header: 56 },
  ...over,
});
const at = (edge: unknown) => [{ route: '/x', theme: 'light', width: 1440, edges: edge }];

describe('edge rules', () => {
  it('accepts a page on the header edge, the padding and the header height', () => {
    assert.deepEqual(rules.edgeFindings(at(edges())), []);
    // Half a pixel is no deviation.
    assert.deepEqual(rules.edgeFindings(at(edges({ content: 32.6 }))), []);
  });

  it('finds content that starts 12px off the header (the board column of O91)', () => {
    const found = rules.edgeFindings(at(edges({ content: 44 })));
    assert.equal(found.length, 1);
    assert.match(found[0], /Inhalt beginnt bei 44 px, Kopfzeile bei 32 px/);
  });

  it('finds another gap under the header and another header height', () => {
    assert.equal(rules.edgeFindings(at(edges({ gap: 38 }))).length, 1);
    assert.equal(rules.edgeFindings(at(edges({ headerHeight: 48 }))).length, 1);
  });

  it('finds a toolbar row that starts elsewhere on a phone', () => {
    const phone = edges({ phone: true, headerHeight: null, pad: { x: 16, top: 16, header: 56 } });
    assert.deepEqual(
      rules.edgeFindings(at({ ...phone, crumb: 16, bar: 16, content: 16, gap: 16 })),
      [],
    );
    const found = rules.edgeFindings(at({ ...phone, crumb: 16, bar: 28, content: 16, gap: 16 }));
    assert.equal(found.length, 1);
    assert.match(found[0], /Werkzeugzeile/);
  });

  it('leaves a split or canvas page its own edge', () => {
    assert.deepEqual(rules.edgeFindings(at(edges({ variant: 'bleed', content: 0, gap: 0 }))), []);
  });
});

const scene = (over: Record<string, unknown> = {}) => ({
  kind: 'panel',
  box: { x: 948, y: 12, w: 480, h: 876 },
  viewport: 1440,
  radius: '16px',
  bg: 'rgb(255, 255, 255)',
  head: { x: 948, y: 12, w: 480, h: 56, padL: 12, padR: 10 },
  tab: { x: 963, y: 26.5, w: 56, h: 26 },
  controls: [
    { c: 'pin', w: 32, h: 32, icon: 16 },
    { c: 'full', w: 32, h: 32, icon: 16 },
    { c: 'close', w: 32, h: 32, icon: 16 },
  ],
  padded: true,
  bodyPad: '24px 24px 24px 24px',
  rightGap: 12,
  topGap: 12,
  expected: { headHeight: 56, bodyPad: '24px 24px 24px 24px', radius: '16px' },
  ...over,
});
const context = { theme: 'light', width: 1440 };

describe('overlay rules', () => {
  it('accepts overlays that have the same head, controls and distances', () => {
    assert.deepEqual(rules.overlayFindings({ chat: scene(), task: scene() }, context), []);
  });

  it('finds a head of another height, a wrong order and another inner distance', () => {
    const found = rules.overlayFindings(
      {
        chat: scene(),
        task: scene({
          head: { x: 948, y: 12, w: 480, h: 44, padL: 12, padR: 10 },
          controls: [
            { c: 'close', w: 32, h: 32, icon: 16 },
            { c: 'pin', w: 32, h: 32, icon: 16 },
          ],
          bodyPad: '12px 12px 16px 12px',
        }),
      },
      context,
    );
    assert.ok(found.some((line) => /Kopf 44 px hoch statt 56 px/.test(line)));
    assert.ok(found.some((line) => /Reihenfolge/.test(line)));
    assert.ok(found.some((line) => /Innenabstand/.test(line)));
  });

  it('finds a button of another size and an icon of another size', () => {
    const found = rules.overlayFindings(
      { chat: scene({ controls: [{ c: 'close', w: 36, h: 36, icon: 15 }] }) },
      context,
    );
    assert.ok(found.some((line) => /36×36/.test(line)));
    assert.ok(found.some((line) => /15 px statt 16/.test(line)));
  });

  it('wants no pin below 1024px and a full-width sheet', () => {
    const found = rules.overlayFindings(
      { chat: scene({ box: { x: 24, y: 12, w: 300, h: 800 }, viewport: 390 }) },
      { theme: 'dark', width: 390 },
    );
    assert.ok(found.some((line) => /kein Anheften/.test(line)));
    assert.ok(found.some((line) => /Vollbild-Sheet/.test(line)));
  });

  it('checks Esc and the room a pinned overlay takes', () => {
    const dock = {
      mainBefore: { right: 1440, width: 1192 },
      mainAfter: { right: 948, width: 700 },
      headerAfter: { right: 948 },
      overlayLeft: 948,
      overlayWidth: 480,
      stillOpenOnOtherPage: true,
      mainReleased: { right: 1440, width: 1192 },
    };
    const esc = { fullAfterEsc: false, openAfterFirst: true, openAfterSecond: false };
    assert.deepEqual(
      rules.overlayFindings({ chat: scene(), task: scene({ dock, esc }) }, context),
      [],
    );
    const wrong = rules.overlayFindings(
      {
        chat: scene(),
        task: scene({
          dock: { ...dock, mainAfter: { right: 1440, width: 1192 }, headerAfter: { right: 1440 } },
          esc: { fullAfterEsc: true, openAfterFirst: true, openAfterSecond: true },
        }),
      },
      context,
    );
    assert.ok(wrong.some((line) => /unter dem Overlay/.test(line)));
    assert.ok(wrong.some((line) => /Kopfzeile reicht/.test(line)));
    assert.ok(wrong.some((line) => /Vollbild nicht zuerst/.test(line)));
    assert.ok(wrong.some((line) => /zweite Esc/.test(line)));
  });
});
