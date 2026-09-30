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

  it('wants one bar and no second toolbar row', () => {
    assert.deepEqual(rules.edgeFindings(at(edges({ headers: 1, stray: 0 }))), []);
    assert.equal(rules.edgeFindings(at(edges({ headers: 2 }))).length, 1);
    assert.equal(rules.edgeFindings(at(edges({ stray: 1 }))).length, 1);
  });

  it('leaves a split or canvas page its own edge, and wants a split list on the sidebar edge', () => {
    assert.deepEqual(rules.edgeFindings(at(edges({ variant: 'bleed', content: 0, gap: 0 }))), []);
    assert.deepEqual(rules.edgeFindings(at(edges({ variant: 'split', content: 0, gap: 0 }))), []);
    const found = rules.edgeFindings(at(edges({ variant: 'split', content: 32, gap: 24 })));
    assert.equal(found.length, 1);
    assert.match(found[0], /Split-Liste/);
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

// The content of a page (owner 30.09., docs/ui-framework.md §19): the ground, the box, the distances
// between boxes and sections, the empty state and the titles.
describe('content rules', () => {
  const box = (over: Record<string, unknown> = {}) => ({
    at: 'div.ds-card',
    kind: 'card',
    radius: '12px',
    bg: '--surface-1',
    shadow: true,
    pad: [16, 16, 16, 16],
    padVariant: false,
    ...over,
  });
  const content = (over: Record<string, unknown> = {}) => ({
    variant: 'default',
    ground: { ok: true, color: 'rgb(246, 245, 248)' },
    boxes: [box()],
    rogue: [],
    gaps: [{ a: 'a', b: 'b', gap: 16 }],
    sectionGaps: [{ a: 'a', b: 'b', gap: 32 }],
    empty: [{ icon: true, fill: true, height: 540, expected: 540 }],
    heads: [
      { kind: 'section', text: 'Titel', size: 15, weight: 520 },
      { kind: 'label', text: 'LABEL', size: 10 },
      { kind: 'group', text: 'GRUPPE', height: 32 },
    ],
    ...over,
  });
  const at = (c: unknown, route = '/x') => [{ route, theme: 'light', width: 1440, content: c }];

  it('accepts a page built from the boxes', () => {
    assert.deepEqual(rules.contentFindings(at(content())), []);
  });

  it('finds another ground, another radius, no shadow and another padding', () => {
    assert.match(
      rules.contentFindings(at(content({ ground: { ok: false, color: 'rgb(0, 0, 0)' } })))[0],
      /Seitengrund/,
    );
    const found = rules.contentFindings(
      at(content({ boxes: [box({ radius: '8px', shadow: false, pad: [20, 20, 20, 20] })] })),
    );
    assert.equal(found.length, 3);
    assert.ok(found.some((line) => /Radius 8px statt 12px/.test(line)));
    assert.ok(found.some((line) => /Kartenschatten/.test(line)));
    assert.ok(found.some((line) => /Innenabstand 20\/20\/20\/20 px statt 16 px/.test(line)));
  });

  it('lets a card say its own padding and an inset be an inset', () => {
    assert.deepEqual(
      rules.contentFindings(at(content({ boxes: [box({ pad: [0, 0, 0, 0], padVariant: true })] }))),
      [],
    );
    assert.deepEqual(
      rules.contentFindings(
        at(
          content({
            boxes: [box({ kind: 'inset', radius: '8px', bg: '--surface-2', shadow: false })],
          }),
        ),
      ),
      [],
    );
    assert.equal(
      rules.contentFindings(
        at(content({ boxes: [box({ kind: 'inset', radius: '12px', bg: '--surface-2' })] })),
      ).length,
      1,
    );
  });

  it('lets a chosen inset lie one step up, and nothing else off surface-2', () => {
    const inset = (extra: object) =>
      rules.contentFindings(
        at(
          content({
            boxes: [box({ kind: 'inset', radius: '8px', shadow: false, ...extra })],
          }),
        ),
      );
    assert.deepEqual(inset({ bg: '--surface-3', selected: true }), []);
    assert.equal(inset({ bg: '--surface-3', selected: false }).length, 1);
    assert.equal(inset({ bg: '--surface-1', selected: true }).length, 1);
  });

  it('finds a hand-drawn box and boxes that stand 12px apart', () => {
    const found = rules.contentFindings(
      at(content({ rogue: ['div.rounded-md.border'], gaps: [{ a: 'a', b: 'b', gap: 12 }] })),
    );
    assert.ok(found.some((line) => /eigene Box div\.rounded-md\.border/.test(line)));
    assert.ok(found.some((line) => /12 px auseinander statt 16 px/.test(line)));
  });

  it('finds sections that stand 24px apart', () => {
    const found = rules.contentFindings(
      at(content({ sectionGaps: [{ a: 'a', b: 'b', gap: 24 }] })),
    );
    assert.equal(found.length, 1);
    assert.match(found[0], /24 px auseinander statt 32 px/);
  });

  it('finds an empty state without a symbol or one that is not the page block', () => {
    assert.match(
      rules.contentFindings(
        at(content({ empty: [{ icon: false, fill: false, height: 100, expected: 540 }] })),
      )[0],
      /Leerzustand ohne Symbol/,
    );
    // Taller than the block (a long text) is fine, shorter is not.
    assert.deepEqual(
      rules.contentFindings(
        at(content({ empty: [{ icon: true, fill: true, height: 600, expected: 540 }] })),
      ),
      [],
    );
    const found = rules.contentFindings(
      at(content({ empty: [{ icon: true, fill: true, height: 310, expected: 540 }] })),
    );
    assert.equal(found.length, 1);
    assert.match(found[0], /Leerzustand ist 310 px hoch statt 540 px/);
  });

  it('finds a title that is not the section title and a heading without a building block', () => {
    const found = rules.contentFindings(
      at(
        content({
          heads: [
            { kind: 'section', text: 'Alt', size: 14, weight: 500 },
            { kind: 'label', text: 'LABEL', size: 12 },
            { kind: 'group', text: 'GRUPPE', height: 28 },
            { kind: 'stray', text: 'Eigen', at: 'h2.text-md' },
          ],
        }),
      ),
    );
    assert.equal(found.length, 4);
  });
});

describe('ui audit: the orb covers nothing', () => {
  const at = (orb: unknown, route = '/tasks') => [{ route, theme: 'light', width: 1440, orb }];

  it('accepts a page whose end is clear of the orb, and a page without one', () => {
    assert.deepEqual(rules.orbFindings(at({ hits: [] })), []);
    assert.deepEqual(rules.orbFindings(at({ none: true })), []);
  });

  it('names what lies under the orb', () => {
    const found = rules.orbFindings(
      at({ hits: ['Aktion button "Chat öffnen"', 'Text span "vor 1 Monat"'] }),
    );
    assert.equal(found.length, 2);
    assert.match(found[0], /light\/1440 \/tasks: der Orb verdeckt Aktion button "Chat öffnen"/);
  });
});
