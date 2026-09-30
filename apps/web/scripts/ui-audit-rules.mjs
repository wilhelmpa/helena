// The rules of the UI audit (owner 30.09., O92, O102, O103, O104, O107): pure functions over what
// ui-audit.mjs measured in a real browser, so the rules themselves are tested without one
// (src/app/uiAudit.test.ts). A deviation of more than one pixel is a finding.

export const TOLERANCE = 1;
export const GAP_TOLERANCE = 8;
const differs = (a, b) => Math.abs(a - b) > TOLERANCE;

// Pages whose content deliberately does not start at the padded edge: a split page (list and
// detail up to the window's edge), a canvas.
const EDGE_EXEMPT = new Set(['bleed', 'split']);

// The header, the toolbar row (a phone) and the first content of every page stand on one left
// edge and start at the same distance below the header (O92, O104, O107).
// `edge` = { variant, crumb, bar, content, gap, pad: { x, top }, phone }, offsets from the main
// area's left edge / the header's bottom.
export function edgeFindings(results) {
  const out = [];
  for (const r of results) {
    const e = r.edges;
    if (!e || e.none) continue;
    const tag = `${r.theme}/${r.width} ${r.route}`;
    // One bar per page, no second toolbar row (O104).
    if (e.headers != null && e.headers !== 1)
      out.push(`${tag}: ${e.headers} Kopfleisten statt einer`);
    if (e.stray) out.push(`${tag}: eine zweite Werkzeugzeile unter der Kopfleiste`);
    // The header itself: its first thing starts on the page's padding.
    if (differs(e.crumb, e.pad.x))
      out.push(`${tag}: Kopfzeile beginnt bei ${e.crumb} px statt ${e.pad.x} px`);
    if (e.headerHeight != null && !e.phone && differs(e.headerHeight, e.pad.header))
      out.push(`${tag}: Kopfzeile ${e.headerHeight} px hoch statt ${e.pad.header} px`);
    // On a phone the controls fold under the breadcrumb: the same left edge.
    if (e.bar != null && differs(e.bar, e.crumb))
      out.push(`${tag}: Werkzeugzeile beginnt bei ${e.bar} px, Kopfzeile bei ${e.crumb} px`);
    // A split page (list and detail) starts at the sidebar's edge: no padding in front of it.
    if (e.variant === 'split' && e.content != null && e.content > TOLERANCE)
      out.push(
        `${tag}: Split-Liste beginnt bei ${e.content} px statt an der Kante der Seitenleiste`,
      );
    if (EDGE_EXEMPT.has(e.variant) || e.content == null) continue;
    if (differs(e.content, e.crumb))
      out.push(
        `${tag}: Inhalt beginnt bei ${e.content} px, Kopfzeile bei ${e.crumb} px${e.contentAt ? ` (${e.contentAt})` : ''}`,
      );
    // A line of text or a small symbol sits a few pixels inside its box: the gap has a wider
    // tolerance than the edges (a page that starts 7px low is still found).
    if (e.gap != null && Math.abs(e.gap - e.pad.top) > GAP_TOLERANCE)
      out.push(`${tag}: Abstand Kopfzeile zum Inhalt ${e.gap} px statt ${e.pad.top} px`);
  }
  return out;
}

// What every overlay has in common (O102): the head's height, its controls, their order and size,
// the distance to the window's edges, the inner distance; pinned it takes its room from the page
// (O103). `scenes` = { name: measurement | { error } }.
export function overlayFindings(scenes, { theme, width }) {
  const out = [];
  const phone = width < 1024;
  const names = Object.keys(scenes);
  const reference = scenes.chat && !scenes.chat.error ? scenes.chat : null;
  for (const name of names) {
    const s = scenes[name];
    const tag = `${theme}/${width} Overlay ${name}`;
    if (!s) continue;
    if (s.error) {
      out.push(`${tag}: nicht messbar (${s.error})`);
      continue;
    }
    if (s.head.h !== s.expected.headHeight)
      out.push(`${tag}: Kopf ${s.head.h} px hoch statt ${s.expected.headHeight} px`);
    const order = s.controls.map((c) => c.c);
    const allowed = ['open', 'pin', 'full', 'close'];
    const ranks = order.map((c) => allowed.indexOf(c));
    if (ranks.includes(-1) || ranks.some((rank, i) => i > 0 && rank < ranks[i - 1]))
      out.push(`${tag}: Knöpfe in der Reihenfolge ${order.join(' · ')}`);
    if (order.at(-1) !== 'close') out.push(`${tag}: „Schließen“ steht nicht am Ende`);
    for (const c of s.controls) {
      const size = s.expected.control ?? 32;
      if (differs(c.w, size) || differs(c.h, size))
        out.push(`${tag}: Knopf ${c.c} ist ${c.w}×${c.h} px statt ${size}×${size} px`);
      if (c.icon != null && Math.abs(c.icon - 16) > 0.5)
        out.push(`${tag}: Symbol von ${c.c} ist ${c.icon} px statt 16 px`);
    }
    if (phone && order.includes('pin'))
      out.push(`${tag}: unter 1024 px darf es kein Anheften geben`);
    if (!phone && s.kind === 'panel') {
      if (differs(s.rightGap, 12) || differs(s.topGap, 12))
        out.push(`${tag}: Abstand zum Fensterrand ${s.rightGap}/${s.topGap} px statt 12/12 px`);
    }
    if (phone && s.kind === 'panel' && (differs(s.box.x, 0) || differs(s.box.w, s.viewport)))
      out.push(`${tag}: auf dem Handy kein Vollbild-Sheet (${s.box.x} / ${s.box.w} px)`);
    if (s.bodyPad != null && s.padded && s.bodyPad !== s.expected.bodyPad)
      out.push(`${tag}: Innenabstand ${s.bodyPad} statt ${s.expected.bodyPad}`);
    if (s.radius !== s.expected.radius && !phone)
      out.push(`${tag}: Radius ${s.radius} statt ${s.expected.radius}`);
    if (reference && s !== reference) {
      if (differs(s.head.padL, reference.head.padL) || differs(s.head.padR, reference.head.padR))
        out.push(`${tag}: Kopf-Innenabstand anders als beim Chat`);
      if (s.tab && reference.tab && differs(s.tab.y - s.box.y, reference.tab.y - reference.box.y))
        out.push(`${tag}: Reiter sitzt anders als beim Chat`);
      if (s.bg !== reference.bg) out.push(`${tag}: Hintergrund ${s.bg} statt ${reference.bg}`);
    }
    if (s.esc) {
      if (s.esc.fullAfterEsc) out.push(`${tag}: Esc verlässt das Vollbild nicht zuerst`);
      if (!s.esc.openAfterFirst) out.push(`${tag}: Esc schließt schon aus dem Vollbild`);
      if (s.esc.openAfterSecond) out.push(`${tag}: das zweite Esc schließt nicht`);
    }
    if (s.dock) {
      const d = s.dock;
      if (differs(d.mainAfter.right, d.overlayLeft) && d.mainAfter.right > d.overlayLeft)
        out.push(`${tag}: angeheftet liegt die Seite noch unter dem Overlay`);
      if (differs(d.mainBefore.width - d.mainAfter.width, d.overlayWidth + 12))
        out.push(
          `${tag}: Hauptbereich schmaler um ${d.mainBefore.width - d.mainAfter.width} px statt ${d.overlayWidth + 12} px`,
        );
      if (d.headerAfter.right > d.overlayLeft + TOLERANCE)
        out.push(`${tag}: die Kopfzeile reicht angeheftet unter das Overlay`);
      if (!d.stillOpenOnOtherPage) out.push(`${tag}: angeheftet, aber nach Seitenwechsel weg`);
      if (differs(d.mainReleased.width, d.mainBefore.width))
        out.push(`${tag}: nach dem Lösen ist die Breite nicht zurück`);
    }
  }
  return out;
}

// The content of every page (owner 30.09.: "gleiche Abstände, gleiche Hintergründe, gleiche
// Boxen"): the page ground is the ground token; every box is THE box (radius 12, surface-1, the
// card shadow, 16px inside) or an inset (radius 8, surface-2); boxes and sections stand the same
// distance apart; a page's own empty state has its symbol in the same place; section titles have one
// size. `content` = what measureContent() found in the browser:
//   { ground: { ok, token }, boxes: [{ at, kind, radius, bg, shadow, pad }], rogue: [at],
//     gaps: [{ a, b, gap }], sectionGaps: [{ gap }], empty: [{ icon, fill, height, expected }], heads: [...] }
export const BOX = { radius: '12px', pad: 16, gap: 16, sectionGap: 32, inset: '8px' };

export function contentFindings(results) {
  const out = [];
  for (const r of results) {
    const c = r.content;
    if (!c || c.none) continue;
    const tag = `${r.theme}/${r.width} ${r.route}`;
    if (c.ground && !c.ground.ok)
      out.push(`${tag}: Seitengrund ${c.ground.color} ist nicht das Grund-Token`);
    for (const box of c.boxes) {
      const label = `${box.at}`;
      if (box.kind === 'inset') {
        if (box.radius !== BOX.inset)
          out.push(`${tag}: Einschub ${label} hat Radius ${box.radius} statt ${BOX.inset}`);
        if (box.bg !== '--surface-2')
          out.push(`${tag}: Einschub ${label} liegt auf ${box.bg} statt --surface-2`);
        continue;
      }
      if (box.radius !== BOX.radius)
        out.push(`${tag}: Box ${label} hat Radius ${box.radius} statt ${BOX.radius}`);
      if (box.bg !== '--surface-1' && box.bg !== '--surface-2' && box.bg !== '--surface-3')
        out.push(`${tag}: Box ${label} hat den Hintergrund ${box.bg}, kein Flächen-Token`);
      if (box.kind === 'card' && box.bg === '--surface-1' && !box.shadow)
        out.push(`${tag}: Box ${label} hat keinen Kartenschatten`);
      if (
        box.kind === 'card' &&
        box.pad != null &&
        box.pad.some((v) => differs(v, BOX.pad)) &&
        !box.padVariant
      )
        out.push(
          `${tag}: Karte ${label} hat Innenabstand ${box.pad.join('/')} px statt ${BOX.pad} px`,
        );
    }
    for (const at of c.rogue) out.push(`${tag}: eigene Box ${at} statt Card/ListBox`);
    for (const g of c.gaps)
      if (differs(g.gap, BOX.gap))
        out.push(
          `${tag}: Boxen ${g.a} / ${g.b} stehen ${g.gap} px auseinander statt ${BOX.gap} px`,
        );
    for (const g of c.sectionGaps)
      if (differs(g.gap, BOX.sectionGap))
        out.push(
          `${tag}: Abschnitte ${g.a} / ${g.b} stehen ${g.gap} px auseinander statt ${BOX.sectionGap} px`,
        );
    for (const e of c.empty) {
      if (!e.icon) out.push(`${tag}: Leerzustand ohne Symbol`);
      if (e.fill && e.height < e.expected - 2)
        out.push(`${tag}: Leerzustand ist ${e.height} px hoch statt ${e.expected} px`);
    }
    for (const h of c.heads) {
      if (h.kind === 'section' && (h.size !== 15 || h.weight !== 520))
        out.push(`${tag}: Abschnittstitel "${h.text}" ist ${h.size}/${h.weight} statt 15/520`);
      if (h.kind === 'label' && h.size !== 10)
        out.push(`${tag}: Kleinbeschriftung "${h.text}" ist ${h.size} px statt 10 px`);
      if (h.kind === 'group' && differs(h.height, 32))
        out.push(`${tag}: Gruppenkopf "${h.text}" ist ${h.height} px hoch statt 32 px`);
      if (h.kind === 'stray') out.push(`${tag}: Überschrift "${h.text}" ohne Baustein (${h.at})`);
    }
  }
  return out;
}

// The desktop orb (owner 30.09.: "Orb verdeckt nichts"): at the end of every scroller nothing that
// can be read or clicked lies under it. `orb` = what measureOrb() found: { hits: ['Aktion a "Speichern"'] }.
export function orbFindings(results) {
  const out = [];
  for (const r of results) {
    if (!r.orb || r.orb.none) continue;
    for (const hit of r.orb.hits ?? [])
      out.push(`${r.theme}/${r.width} ${r.route}: der Orb verdeckt ${hit}`);
  }
  return out;
}
