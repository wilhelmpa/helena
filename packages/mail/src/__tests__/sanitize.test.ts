import { describe, expect, it } from 'bun:test';
import { allowRemoteImages, plainTextHtml, resolveCidImages, sanitizeMailHtml } from '../sanitize';

describe('sanitizeMailHtml', () => {
  it('keeps formatting and tables', () => {
    const { html, hasRemoteImages } = sanitizeMailHtml(
      '<table width="100%" cellpadding="4"><tr><td bgcolor="#eee"><b>Fett</b> <font color="red">rot</font></td></tr></table>',
    );
    expect(hasRemoteImages).toBe(false);
    expect(html).toBe(
      '<table width="100%" cellpadding="4"><tr><td bgcolor="#eee"><b>Fett</b> <font color="red">rot</font></td></tr></table>',
    );
  });

  it('removes scripts, event handlers, frames, forms and dangerous links', () => {
    const { html } = sanitizeMailHtml(
      '<div onclick="x()">a</div><script>x()</script><iframe src="https://e"></iframe><form><input></form><a href="javascript:x()">b</a><object data="x"></object>',
    );
    expect(html).toBe('<div>a</div><a target="_blank" rel="noopener noreferrer">b</a>');
  });

  it('blocks remote images and CSS that loads from the network', () => {
    const { html, hasRemoteImages } = sanitizeMailHtml(
      '<img src="https://t.example/p.gif"><p style="color: blue; background: url(https://t.example/b.png)">x</p><img src="data:image/png;base64,AAAA">',
    );
    expect(hasRemoteImages).toBe(true);
    expect(html).toBe(
      '<img data-remote-src="https://t.example/p.gif" /><p style="color:blue">x</p><img src="data:image/png;base64,AAAA" />',
    );
  });

  it('keeps cid images for the api to resolve', () => {
    const { html } = sanitizeMailHtml('<img src="cid:logo@x" alt="Logo">');
    expect(html).toBe('<img alt="Logo" src="cid:logo@x" />');
  });
});

describe('allowRemoteImages', () => {
  it('restores the address of every blocked image', () => {
    const { html } = sanitizeMailHtml('<img alt="a" src="https://x.example/a.png" width="10">');
    expect(allowRemoteImages(html)).toBe(
      '<img alt="a" width="10" src="https://x.example/a.png" />',
    );
  });
});

describe('resolveCidImages', () => {
  it('points cid images at the given URL', () => {
    const { html } = sanitizeMailHtml('<img src="cid:a&amp;b@x"><img src="https://x/y.png">');
    const resolved = resolveCidImages(html, (cid) => `/parts/${encodeURIComponent(cid)}`);
    expect(resolved).toContain('src="/parts/a%26b%40x"');
    expect(resolved).toContain('data-remote-src="https://x/y.png"');
  });
});

describe('plainTextHtml', () => {
  it('escapes text and turns quote lines into a blockquote', () => {
    expect(plainTextHtml('Hi <b>\nthere\n\n> a\n> b')).toBe(
      '<p>Hi &lt;b&gt;<br>there</p><blockquote><p>a<br>b</p></blockquote>',
    );
    expect(plainTextHtml('Anna wrote:\n> a\n>\n> > b\nok')).toBe(
      '<p>Anna wrote:</p><blockquote><p>a</p><blockquote><p>b</p></blockquote></blockquote><p>ok</p>',
    );
  });
});
