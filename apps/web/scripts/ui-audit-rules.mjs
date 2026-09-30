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
    // The header itself: its first thing starts on the page's padding.
    if (differs(e.crumb, e.pad.x))
      out.push(`${tag}: Kopfzeile beginnt bei ${e.crumb} px statt ${e.pad.x} px`);
    if (e.headerHeight != null && !e.phone && differs(e.headerHeight, e.pad.header))
      out.push(`${tag}: Kopfzeile ${e.headerHeight} px hoch statt ${e.pad.header} px`);
    // On a phone the controls fold under the breadcrumb: the same left edge.
    if (e.bar != null && differs(e.bar, e.crumb))
      out.push(`${tag}: Werkzeugzeile beginnt bei ${e.bar} px, Kopfzeile bei ${e.crumb} px`);
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
      if (differs(c.w, 32) || differs(c.h, 32))
        out.push(`${tag}: Knopf ${c.c} ist ${c.w}×${c.h} px statt 32×32 px`);
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
