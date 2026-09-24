import { HELENA_ANSI, ROW_BANDS } from './ansi';
import { BANDS, TILE } from './palette';

// The brand line at the top of Helena's mails. Mail clients drop SVG and often block
// remote images (and a LAN instance has no public URL to load them from), so the
// wordmark is text: the same ANSI Shadow rows Hermes prints in the terminal, in a
// monospace <pre> on the ink bar, one colour per row. Every mail font has the block and
// box-drawing characters (Courier New, Menlo, Consolas, Roboto Mono).
const PRE_STYLE =
  "margin:0;font-family:Menlo,Consolas,'Courier New',monospace;font-size:7px;line-height:7px;" +
  'letter-spacing:0;-webkit-text-size-adjust:none;text-size-adjust:none;white-space:pre';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function mailHeaderHtml(): string {
  const rows = HELENA_ANSI.map(
    (row, i) => `<span style="color:${BANDS.dark[ROW_BANDS[i] ?? 'bronze']}">${esc(row)}</span>`,
  ).join('\n');
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 16px">` +
    `<tr><td style="background:${TILE};border-radius:6px;padding:10px 14px" bgcolor="${TILE}">` +
    `<pre style="${PRE_STYLE}">${rows}</pre></td></tr></table>`
  );
}
