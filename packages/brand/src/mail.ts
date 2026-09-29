import { MAIL_ORB_PNG } from './mail-orb';
import { ORB } from './palette';

// The Orb travels with the message as an inline image (Content-ID): mail clients block
// remote images and data URIs, and the app's own URL sits behind the login. The mailer
// attaches every image here whose cid the HTML references.
export const MAIL_ORB_CID = 'ava-orb@volition';

export interface MailInlineImage {
  cid: string;
  filename: string;
  contentType: string;
  base64: string;
}

export const MAIL_INLINE_IMAGES: readonly MailInlineImage[] = [
  { cid: MAIL_ORB_CID, filename: 'ava-orb.png', contentType: 'image/png', base64: MAIL_ORB_PNG },
];

// An ink bar with the particle Orb and the wordmark as spaced light text, so it stays
// readable when a client changes the background or withholds the image.
export function mailHeaderHtml(displayName: string): string {
  const safeName = displayName
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 16px">` +
    `<tr><td bgcolor="${ORB.ink}" style="background:${ORB.ink};border-radius:8px;padding:8px 16px 8px 10px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="vertical-align:middle;line-height:0"><img src="cid:${MAIL_ORB_CID}" width="36" height="36" alt="" style="display:block;border:0"></td>` +
    `<td style="vertical-align:middle;padding-left:12px;color:${ORB.paper};font-family:Inter,'Helvetica Neue',Arial,sans-serif;font-size:18px;font-weight:300;letter-spacing:0.32em">${safeName}</td>` +
    `</tr></table></td></tr></table>`
  );
}
