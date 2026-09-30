/* eslint-disable no-restricted-syntax -- The frame is a document of its own: it cannot read the
   app's tokens, so it carries the plain colours a mail is written for and gets the app's
   surface passed in. */
// The document the reading pane shows a message's HTML in. The HTML is sanitized by
// the api; the frame adds a policy that loads images only from the api (the inline
// ones) and, once the owner allowed them, from the network, and opens links in a new
// tab. Relative image sources resolve against the api.
//
// A message is written for a white page. In the dark theme (`dark`) its colours are
// inverted and turned back in hue, and the frame's own surface (`surface`, the app's
// surface colour) is blended under it: white becomes the app's dark surface, dark text
// becomes light, photos and logos are turned back so they keep their colours. No white
// area stays behind (owner 29.09., O81).
export function mailFrameDocument(input: {
  html: string;
  apiBase: string;
  allowRemoteImages: boolean;
  dark?: boolean;
  surface?: string;
}): string {
  const apiOrigin = new URL(input.apiBase).origin;
  const images = ['data:', apiOrigin, ...(input.allowRemoteImages ? ['https:', 'http:'] : [])];
  const policy = `default-src 'none'; img-src ${images.join(' ')}; style-src 'unsafe-inline'; font-src data:`;
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
    `<base href="${input.apiBase}" target="_blank">`,
    '<style>body{margin:0;font:14px/1.5 system-ui,sans-serif;color:#111;overflow-wrap:anywhere}',
    'img{max-width:100%;height:auto}table{max-width:100%}',
    'blockquote{margin:0 0 0 .4em;padding-inline-start:.8em;border-inline-start:2px solid #ccc;color:#555}',
    input.dark ? darkStyle(input.surface) : '',
    '</style>',
    `</head><body>${input.html}</body></html>`,
  ].join('');
}

const INVERT = 'invert(1) hue-rotate(180deg)';

function darkStyle(surface = '#1a1820'): string {
  // Only a plain colour goes into the document: the value comes from the app's own CSS.
  const color = /^#[0-9a-f]{3,8}$/i.test(surface) ? surface : '#1a1820';
  return [
    `:root{color-scheme:dark;background:${color}}`,
    `body{background:transparent;filter:${INVERT};mix-blend-mode:lighten}`,
    `img,video,picture,svg,[style*="background-image"]{filter:${INVERT}}`,
  ].join('');
}
