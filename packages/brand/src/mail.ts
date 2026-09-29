import { ORB } from './palette';
import { orbBody } from './svg';

// A self-contained monochrome SVG on an ink bar: it stays legible when a mail client
// changes the message background. The adjacent text is the fallback in clients that
// remove inline SVG.
export function mailHeaderHtml(): string {
  const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="40" height="40" role="img" aria-label="Helena" style="color:${ORB.paper}">${orbBody('mono', 'regular')}</svg>`;
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 16px">` +
    `<tr><td bgcolor="${ORB.tileLight}" style="background:${ORB.tileLight};border-radius:8px;padding:8px 12px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="vertical-align:middle;line-height:0">${icon}</td>` +
    `<td style="vertical-align:middle;padding-left:10px;color:${ORB.paper};font-family:Arial,sans-serif;font-size:20px;font-weight:700">Helena</td>` +
    `</tr></table></td></tr></table>`
  );
}
