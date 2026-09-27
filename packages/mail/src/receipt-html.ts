import sanitizeHtml from 'sanitize-html';
import { htmlText } from './parse';
import { sanitizeMailHtml } from './sanitize';

/** Receipt-only text: never fetch links/images or promote hidden preheader content. */
export function receiptHtmlText(html: string): string | null {
  // Refuse oversized alternatives rather than accepting an apparently complete prefix.
  if (html.length > 1_000_000) return null;
  const safe = sanitizeMailHtml(html).html;
  const visible = sanitizeHtml(safe, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'center', 'font', 'big', 'strike'],
    allowedAttributes: false,
    nonBooleanAttributes: sanitizeHtml.defaults.nonBooleanAttributes.filter(
      (name) => name !== 'hidden',
    ),
    exclusiveFilter: ({ attribs }) =>
      'hidden' in attribs ||
      attribs['aria-hidden']?.toLowerCase() === 'true' ||
      /(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0(?:\D|$)|(?:font-size|max-height|height)\s*:\s*0(?:px|em|rem|%)?\s*(?:;|!|$)|mso-hide\s*:\s*all)/i.test(
        attribs.style ?? '',
      ),
  });
  const text = htmlText(visible);
  return text.length <= 200_000 ? text : null;
}
