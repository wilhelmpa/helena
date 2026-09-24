import { HELENA_ANSI, ROW_BANDS } from './ansi';
import { BRAND_VARIANT, type BrandVariant } from './config';
import { BANDS, TILE } from './palette';

// The brand line at the top of Helena's mails. Mail clients drop SVG and often block
// remote images (and a LAN instance has no public URL to load them from), so the
// wordmark is text: the same ANSI Shadow rows Hermes prints in the terminal, in a
// monospace <pre> on the ink bar. Every mail font has the block and box-drawing
// characters (Courier New, Menlo, Consolas, Roboto Mono). The funke variant sets
// "Helena" as plain bold text instead.
const PRE_STYLE =
  "margin:0;font-family:Menlo,Consolas,'Courier New',monospace;font-size:7px;line-height:7px;" +
  'letter-spacing:0;-webkit-text-size-adjust:none;text-size-adjust:none;white-space:pre';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function mailHeaderHtml(variant: BrandVariant = BRAND_VARIANT): string {
  const inner =
    variant === 'funke'
      ? `<span style="font-family:'DM Sans',Arial,sans-serif;font-size:18px;font-weight:700;color:#F4EFE6">Helena</span>`
      : `<pre style="${PRE_STYLE}">${ansiRows(variant)}</pre>`;
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 16px">` +
    `<tr><td style="background:${TILE};border-radius:6px;padding:10px 14px" bgcolor="${TILE}">${inner}</td></tr></table>`
  );
}

function ansiRows(variant: BrandVariant): string {
  // The monogram variant shows the blocks alone, in one colour.
  const blocksOnly = variant === 'monogramm';
  const rows = blocksOnly
    ? HELENA_ANSI.filter((row) => row.includes('█')).map((row) => row.replace(/[^█]/g, ' '))
    : [...HELENA_ANSI];
  return rows
    .map((row, i) => {
      const color = blocksOnly ? BANDS.dark.gold : BANDS.dark[ROW_BANDS[i] ?? 'bronze'];
      return `<span style="color:${color}">${esc(row)}</span>`;
    })
    .join('\n');
}
