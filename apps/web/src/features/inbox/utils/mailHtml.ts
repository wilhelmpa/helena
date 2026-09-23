// The document the reading pane shows a message's HTML in. The HTML is sanitized by
// the api; the frame adds a policy that loads images only from the api (the inline
// ones) and, once the owner allowed them, from the network, and opens links in a new
// tab. Relative image sources resolve against the api.
export function mailFrameDocument(input: {
  html: string;
  apiBase: string;
  allowRemoteImages: boolean;
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
    'blockquote{margin:0 0 0 .4em;padding-inline-start:.8em;border-inline-start:2px solid #ccc;color:#555}</style>',
    `</head><body>${input.html}</body></html>`,
  ].join('');
}
